import { type DatabaseClient, query } from "#root/shared/database/drizzle/db";
import { product, productReview } from "#root/shared/database/drizzle/schema";
import { inArray, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import {
  type ImportAnalysis,
  type ImportRowResult,
  REVIEW_IMPORT_LIMITS,
  analyzeReviewCsv,
} from "./validate";

/**
 * Admin-only CSV import of product reviews.
 *
 * Both procedures take the raw CSV text. `previewReviewImport` only reports;
 * `importReviews` re-runs the exact same analysis (the browser's preview is
 * never trusted) and inserts the valid rows.
 *
 * Insert semantics — one transaction for the whole file:
 *   - every "valid" row is inserted with ON CONFLICT (import_key) DO NOTHING,
 *     so a retried / double-clicked / re-uploaded import cannot create a
 *     second copy — the unique index is the source of truth, not the preview;
 *   - if any statement fails (connection drop, constraint violation) the
 *     transaction rolls back and NOTHING from this upload is stored; the
 *     admin sees an error and can simply retry;
 *   - "invalid" rows are reported as failed and never block the valid ones —
 *     the admin saw the exact list in the preview before clicking Import.
 *
 * Imported rows carry no userId and no image; they are ordinary reviews that
 * happen to have an import_key. Public visibility is unchanged: only
 * status = 'approved' rows are ever shown on a product page.
 */

export const reviewImportInputSchema = z.object({
  // z.string().max counts UTF-16 units; the byte limit is enforced again in
  // analyzeReviewCsv. This cap just stops absurd payloads before parsing.
  csvText: z.string().max(REVIEW_IMPORT_LIMITS.maxFileBytes * 2),
});

export const reviewImportSchema = reviewImportInputSchema.extend({
  /** Admin opt-in. Defaults to pending — the same state a storefront review
   * starts in — so nothing goes public without a deliberate choice. */
  publishImmediately: z.boolean().default(false),
});

const INSERT_CHUNK = 500;

/** One query for every product the file references, deleted ones included
 * so the row error can say "deleted" rather than "not found". */
async function resolveProducts(db: DatabaseClient, ids: string[], slugs: string[]) {
  const conditions = [];
  if (ids.length > 0) conditions.push(inArray(product.id, ids));
  if (slugs.length > 0) conditions.push(inArray(sql`lower(${product.slug})`, slugs));
  if (conditions.length === 0) return [];
  return db
    .select({
      id: product.id,
      name: product.name,
      slug: product.slug,
      deleted: product.deleted,
    })
    .from(product)
    .where(or(...conditions))
    .execute();
}

async function lookupExistingImportKeys(db: DatabaseClient, keys: string[]) {
  const found = new Set<string>();
  for (let i = 0; i < keys.length; i += INSERT_CHUNK) {
    const rows = await db
      .select({ importKey: productReview.importKey })
      .from(productReview)
      .where(inArray(productReview.importKey, keys.slice(i, i + INSERT_CHUNK)))
      .execute();
    for (const r of rows) if (r.importKey) found.add(r.importKey);
  }
  return found;
}

export function analyzeWithDb(db: DatabaseClient, csvText: string) {
  return analyzeReviewCsv(
    csvText,
    (ids, slugs) => resolveProducts(db, ids, slugs),
    { lookupExistingImportKeys: (keys) => lookupExistingImportKeys(db, keys) },
  );
}

/** Rows are returned for display; the Date inside ValidReview survives
 * superjson so the client can show the resolved createdAt. */
export const previewReviewImport = (
  input: z.infer<typeof reviewImportInputSchema>,
) =>
  Effect.gen(function* ($) {
    return yield* $(
      query(async (db): Promise<ImportAnalysis> => analyzeWithDb(db, input.csvText)),
    );
  });

export interface ImportReviewsResult {
  analysis: ImportAnalysis;
  imported: number;
  /** Duplicates: inside the file, previously imported, or lost the race to a
   * concurrent identical import. */
  skipped: number;
  /** Rows that failed validation and were not inserted. */
  failed: number;
  status: "pending" | "approved";
}

export const importReviews = (input: z.infer<typeof reviewImportSchema>) =>
  Effect.gen(function* ($) {
    return yield* $(
      query(async (db): Promise<ImportReviewsResult> => {
        const analysis = await analyzeWithDb(db, input.csvText);
        const status = input.publishImmediately
          ? ("approved" as const)
          : ("pending" as const);
        const importedAt = new Date();

        const valid = analysis.rows.filter(
          (r): r is Extract<ImportRowResult, { status: "valid" }> =>
            r.status === "valid",
        );

        let imported = 0;
        if (valid.length > 0) {
          await db.transaction(async (tx) => {
            for (let i = 0; i < valid.length; i += INSERT_CHUNK) {
              const chunk = valid.slice(i, i + INSERT_CHUNK);
              const inserted = await tx
                .insert(productReview)
                .values(
                  chunk.map(({ review }) => ({
                    productId: review.productId,
                    // No account link and no image: an imported review is
                    // attributed by name only, never presented as verified.
                    userId: null,
                    imageId: null,
                    userName: review.userName,
                    rating: review.rating,
                    comment: review.comment,
                    status,
                    importKey: review.importKey,
                    createdAt: review.createdAt ?? importedAt,
                  })),
                )
                .onConflictDoNothing({ target: productReview.importKey })
                .returning({ id: productReview.id })
                .execute();
              imported += inserted.length;
            }
          });
        }

        // Anything valid that did not insert lost to a concurrent identical
        // import — count it as skipped, exactly like a preview duplicate.
        const raced = valid.length - imported;
        return {
          analysis,
          imported,
          skipped: analysis.summary.duplicate + raced,
          failed: analysis.summary.invalid,
          status,
        };
      }),
    );
  });
