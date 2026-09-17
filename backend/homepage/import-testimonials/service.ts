import { type DatabaseClient, query } from "#root/shared/database/drizzle/db";
import { homepageContent } from "#root/shared/database/drizzle/schema";
import { getStoreOwnerId } from "#root/shared/config/store";
import type { HomepageContent } from "#root/shared/types/homepage-content";
import { getTemplateSelectionRaw } from "#root/backend/settings/get-template-selection-raw";
import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { v7 } from "uuid";
import { z } from "zod";
import { TESTIMONIAL_IMPORT_LIMITS, type TestimonialItem } from "./constants";
import {
  type TestimonialImportAnalysis,
  analyzeTestimonialCsv,
  testimonialKey,
} from "./validate";
import { DEFAULT_HOMEPAGE_CONTENT } from "#root/shared/types/homepage-content";

/**
 * Admin-only CSV import of homepage testimonials.
 *
 * Writes ONLY `content.testimonials` of the homepage_content row that the
 * storefront reads for the target template — via jsonb_set inside a
 * transaction with the row locked — so hero copy, section order, product
 * shelves and every other homepage setting are left byte-for-byte alone,
 * even if an admin saves the homepage form at the same moment.
 *
 * Append semantics: existing testimonials stay, in their order; new ones go
 * on the end. Rows that match an existing testimonial (same name + quote,
 * case/whitespace-insensitive) are skipped, so re-uploading a file is a
 * no-op. The section is switched on because the admin clicked "Import and
 * publish" — that is the explicit act; nothing is published by preview.
 */

export const testimonialImportInputSchema = z.object({
  csvText: z.string().max(TESTIMONIAL_IMPORT_LIMITS.maxFileBytes * 2),
  /** Landing template whose homepage content receives the testimonials.
   * Defaults to the template the storefront currently renders. */
  templateId: z.string().min(1).max(100).optional(),
  /**
   * Discard the testimonials currently saved and keep only the uploaded
   * ones. Off by default (append). The dialog pre-ticks it only when every
   * saved entry is one of the template's shipped sample quotes, which must
   * never go live next to real customers.
   */
  replaceExisting: z.boolean().default(false),
});

/** What the admin is about to publish alongside (or instead of). */
export interface ExistingTestimonialsInfo {
  count: number;
  names: string[];
  /** True when every saved entry is verbatim one of the shipped samples
   * (DEFAULT_HOMEPAGE_CONTENT.testimonials) — placeholder copy, not customers. */
  shippedSamples: boolean;
  /** Whether the section is currently switched on. */
  enabled: boolean;
}

const SHIPPED_SAMPLE_KEYS = new Set(
  (DEFAULT_HOMEPAGE_CONTENT.testimonials?.items ?? []).map(testimonialKey),
);

function describeExisting(
  block: TestimonialsBlock | null,
  items: TestimonialItem[],
): ExistingTestimonialsInfo {
  return {
    count: items.length,
    names: items.map((i) => i.name),
    shippedSamples:
      items.length > 0 &&
      items.every((i) => SHIPPED_SAMPLE_KEYS.has(testimonialKey(i))),
    enabled: block?.enabled ?? false,
  };
}

type TestimonialsBlock = NonNullable<HomepageContent["testimonials"]>;

interface TargetRow {
  id: string | null;
  templateId: string;
  testimonials: TestimonialsBlock | null;
}

async function resolveTemplateId(db: DatabaseClient, requested?: string) {
  if (requested) return requested;
  const selection = await getTemplateSelectionRaw(db);
  return selection.landing ?? "landing-modern";
}

/**
 * The row the storefront reads: the template's own row, else the legacy
 * "default" row (mirrors getHomepageContentRaw's fallback chain). `id` is
 * null when neither exists yet. When `lock` is set the row is SELECT … FOR
 * UPDATE inside the caller's transaction.
 */
/** A database client or a transaction opened on one. */
type Queryable = DatabaseClient | Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

async function findTargetRow(
  db: Queryable,
  merchantId: string,
  templateId: string,
  lock = false,
): Promise<TargetRow> {
  const candidates =
    templateId === "default" ? ["default"] : [templateId, "default"];
  for (const candidate of candidates) {
    const q = db
      .select({ id: homepageContent.id, content: homepageContent.content })
      .from(homepageContent)
      .where(
        and(
          eq(homepageContent.merchantId, merchantId),
          eq(homepageContent.templateId, candidate),
        ),
      )
      .limit(1);
    const rows = lock ? await q.for("update").execute() : await q.execute();
    const row = rows[0];
    if (row?.content) {
      const content = row.content as Partial<HomepageContent>;
      return {
        id: row.id,
        templateId: candidate,
        testimonials: content.testimonials ?? null,
      };
    }
  }
  return { id: null, templateId, testimonials: null };
}

function existingItems(block: TestimonialsBlock | null): TestimonialItem[] {
  return (block?.items ?? []).filter(
    (i): i is TestimonialItem =>
      !!i && typeof i.name === "string" && typeof i.review === "string",
  );
}

export const previewTestimonialImport = (
  input: z.input<typeof testimonialImportInputSchema>,
) =>
  Effect.gen(function* ($) {
    return yield* $(
      query(
        async (
          db,
        ): Promise<
          TestimonialImportAnalysis & {
            templateId: string;
            existing: ExistingTestimonialsInfo;
            replaceExisting: boolean;
          }
        > => {
          const merchantId = getStoreOwnerId();
          const templateId = await resolveTemplateId(db, input.templateId);
          const target = await findTargetRow(db, merchantId, templateId);
          const current = existingItems(target.testimonials);
          return {
            ...analyzeTestimonialCsv(
              input.csvText,
              (input.replaceExisting ?? false) ? [] : current,
            ),
            templateId,
            existing: describeExisting(target.testimonials, current),
            replaceExisting: input.replaceExisting ?? false,
          };
        },
      ),
    );
  });

export interface ImportTestimonialsResult {
  analysis: TestimonialImportAnalysis;
  templateId: string;
  /** Appended to the homepage. */
  imported: number;
  /** In-file repeats or already on the homepage. */
  skipped: number;
  /** Failed validation. */
  failed: number;
  /** Testimonials on the homepage after this import. */
  totalAfter: number;
  /** Saved testimonials discarded because replaceExisting was set. */
  replaced: number;
}

export const importTestimonials = (
  input: z.input<typeof testimonialImportInputSchema>,
) =>
  Effect.gen(function* ($) {
    return yield* $(
      query(async (db): Promise<ImportTestimonialsResult> => {
        const merchantId = getStoreOwnerId();
        const templateId = await resolveTemplateId(db, input.templateId);

        return await db.transaction(async (tx) => {
          // Re-read under lock and re-validate from the raw text: a preview
          // the browser showed a minute ago is not what gets imported.
          const target = await findTargetRow(tx, merchantId, templateId, true);
          const current = existingItems(target.testimonials);
          const kept = (input.replaceExisting ?? false) ? [] : current;
          const analysis = analyzeTestimonialCsv(input.csvText, kept);

          const toAdd = analysis.rows.flatMap((r) =>
            r.status === "valid" ? [r.item] : [],
          );

          // A file the validator rejected outright (bad header, over the
          // limits) publishes nothing — not even the switch-on.
          if (analysis.fileErrors.length > 0) {
            return {
              analysis,
              templateId,
              imported: 0,
              skipped: 0,
              failed: 0,
              totalAfter: current.length,
              replaced: 0,
            };
          }

          const nextBlock: TestimonialsBlock = {
            ...(target.testimonials ?? {}),
            // "Import and publish" is the explicit switch-on.
            enabled: true,
            items: [...kept, ...toAdd],
          };

          const replaced = input.replaceExisting ? current.length : 0;
          if (toAdd.length > 0 || replaced > 0 || !target.testimonials?.enabled) {
            if (target.id) {
              await tx
                .update(homepageContent)
                .set({
                  content: sql`jsonb_set(${homepageContent.content}, '{testimonials}', ${JSON.stringify(nextBlock)}::jsonb, true)`,
                  updatedAt: new Date(),
                })
                .where(eq(homepageContent.id, target.id))
                .execute();
            } else {
              // No homepage row at all yet. Store only the testimonials; the
              // read path merges everything else from the shipped defaults,
              // exactly as it does today for a store that never saved.
              const now = new Date();
              await tx
                .insert(homepageContent)
                .values({
                  id: v7(),
                  merchantId,
                  templateId,
                  content: { testimonials: nextBlock } as unknown as HomepageContent,
                  createdAt: now,
                  updatedAt: now,
                })
                .execute();
            }
          }

          return {
            analysis,
            templateId,
            imported: toAdd.length,
            skipped: analysis.summary.duplicate,
            failed: analysis.summary.invalid,
            totalAfter: kept.length + toAdd.length,
            replaced,
          };
        });
      }),
    );
  });
