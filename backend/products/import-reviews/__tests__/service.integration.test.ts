import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, isNotNull, sql } from "drizzle-orm";
import { Effect } from "effect";

// Real-Postgres integration test for the review CSV importer — see
// docs/MARKETING_SUITE_PLAN.md "Running the DB integration tests". Covers
// what the pure validate.test.ts cannot: the transaction, the unique index
// under a concurrent identical import, pending-vs-approved public visibility
// and admin pagination past 100 rows.

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

describeIfDb("review CSV import service (integration)", () => {
  let schema: typeof import("#root/shared/database/drizzle/schema");
  let db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema> & {
    $client: import("pg").Pool;
  };
  let service: typeof import("#root/backend/products/import-reviews/service");
  let viewReviews: typeof import("#root/backend/products/view-reviews/service");
  let dbModule: typeof import("#root/shared/database/drizzle/db");

  let fileId: string;
  let categoryId: string;
  let vendorId: string;
  let productA: string;
  let productB: string;

  // Mirrors provideDatabase() from shared/trpc/server for a bare Effect.
  const run = <A, E>(
    effect: Effect.Effect<A, E, import("#root/shared/database/drizzle/db").DatabaseClientService>,
  ): Promise<A> =>
    Effect.runPromise(
      effect.pipe(Effect.provideService(dbModule.DatabaseClientService, db)),
    );

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    schema = await import("#root/shared/database/drizzle/schema");
    db = drizzle(TEST_DB_URL!, { schema });
    dbModule = await import("#root/shared/database/drizzle/db");
    service = await import("#root/backend/products/import-reviews/service");
    viewReviews = await import("#root/backend/products/view-reviews/service");

    const { v7 } = await import("uuid");
    fileId = v7();
    await db.insert(schema.file).values({ id: fileId, diskname: "review-import-test.jpg" });
    categoryId = v7();
    await db
      .insert(schema.category)
      .values({ id: categoryId, name: "Review Import Cat", slug: "review-import-cat" });
    vendorId = v7();
    await db.insert(schema.vendor).values({ id: vendorId, name: "Review Import Vendor" });

    productA = v7();
    productB = v7();
    await db.insert(schema.product).values([
      {
        id: productA,
        name: "Import Product A",
        slug: "import-product-a",
        description: "d",
        price: "10.00",
        imageId: fileId,
        categoryId,
        vendorId,
      },
      {
        id: productB,
        name: "Import Product B",
        slug: "import-product-b",
        description: "d",
        price: "10.00",
        imageId: fileId,
        categoryId,
        vendorId,
      },
    ]);
  });

  beforeEach(async () => {
    await db.delete(schema.productReview).where(isNotNull(schema.productReview.importKey));
    await db.delete(schema.productReview).where(eq(schema.productReview.productId, productA));
    await db.delete(schema.productReview).where(eq(schema.productReview.productId, productB));
  });

  afterAll(async () => {
    await db.delete(schema.productReview).where(eq(schema.productReview.productId, productA));
    await db.delete(schema.productReview).where(eq(schema.productReview.productId, productB));
    await db.delete(schema.product).where(eq(schema.product.id, productA));
    await db.delete(schema.product).where(eq(schema.product.id, productB));
    await db.delete(schema.vendor).where(eq(schema.vendor.id, vendorId));
    await db.delete(schema.category).where(eq(schema.category.id, categoryId));
    await db.delete(schema.file).where(eq(schema.file.id, fileId));
  });

  const HEADER = "productId,productSlug,userName,rating,comment,createdAt";
  const csv = (...rows: string[]) => `\uFEFF${[HEADER, ...rows].join("\r\n")}\r\n`;

  it("resolves products from the database with one query and previews without inserting", async () => {
    const text = csv(
      `${productA},,Ann,5,Loved it a lot,2026-03-15`,
      ",import-product-b,Ben,4,Solid product,",
      ",Import Product B,Cid,4,Solid product,", // name, not slug → rejected
    );
    const preview = await run(service.previewReviewImport({ csvText: text }));
    expect(preview.fileErrors).toEqual([]);
    expect(preview.summary).toEqual({ total: 3, valid: 2, duplicate: 0, invalid: 1 });
    expect(preview.rows[0]).toMatchObject({ status: "valid", review: { productName: "Import Product A" } });
    expect(preview.rows[1]).toMatchObject({ status: "valid", review: { productName: "Import Product B" } });

    const stored = await db.select().from(schema.productReview).where(isNotNull(schema.productReview.importKey));
    expect(stored).toHaveLength(0);
  });

  it("imports valid rows as pending by default, preserves dates, and keeps them off the public list", async () => {
    const text = csv(
      `${productA},,Ann,5,Loved it a lot,2026-03-15`,
      `${productA},,Ben,4,Solid product,`,
      `${productA},,Cid,9,bad rating,`,
    );
    const result = await run(service.importReviews({ csvText: text, publishImmediately: false }));
    expect(result).toMatchObject({ imported: 2, skipped: 0, failed: 1, status: "pending" });

    const stored = await db
      .select()
      .from(schema.productReview)
      .where(eq(schema.productReview.productId, productA))
      .orderBy(schema.productReview.userName);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ userName: "Ann", rating: 5, status: "pending", userId: null, imageId: null });
    expect(stored[0]!.createdAt.toISOString()).toBe("2026-03-15T12:00:00.000Z");
    expect(stored[1]!.userName).toBe("Ben");
    // Omitted date → import time (within the last minute)
    expect(Date.now() - stored[1]!.createdAt.getTime()).toBeLessThan(60_000);
    expect(stored[1]!.importKey).toMatch(/^[0-9a-f]{64}$/);

    const pub = await run(viewReviews.viewReviews({ productId: productA }));
    expect(pub.totalReviews).toBe(0);
  });

  it("publishes immediately only when explicitly asked, and those become publicly visible", async () => {
    const text = csv(`${productB},,Dee,5,Public right away,2026-05-01 10:00`);
    const result = await run(service.importReviews({ csvText: text, publishImmediately: true }));
    expect(result).toMatchObject({ imported: 1, status: "approved" });

    const pub = await run(viewReviews.viewReviews({ productId: productB }));
    expect(pub.totalReviews).toBe(1);
    expect(pub.reviews[0]).toMatchObject({ userName: "Dee", rating: 5 });
    expect(pub.averageRating).toBe(5);
  });

  it("skips in-file duplicates and previously imported rows on a repeat upload", async () => {
    const text = csv(
      `${productA},,Ann,5,Loved it a lot,2026-03-15`,
      `${productA},,ann,5,Loved it a lot,2026-03-15`, // same review, different casing
      `${productA},,Ben,4,Solid product,`,
    );
    const first = await run(service.importReviews({ csvText: text, publishImmediately: false }));
    expect(first).toMatchObject({ imported: 2, skipped: 1, failed: 0 });

    const preview = await run(service.previewReviewImport({ csvText: text }));
    expect(preview.rows.map((r) => r.status)).toEqual(["duplicate", "duplicate", "duplicate"]);
    expect(preview.rows[0]).toMatchObject({ reason: "already-imported" });
    expect(preview.rows[1]).toMatchObject({ reason: "in-file", duplicateOfRow: 2 });

    const second = await run(service.importReviews({ csvText: text, publishImmediately: true }));
    expect(second).toMatchObject({ imported: 0, skipped: 3, failed: 0 });

    const stored = await db.select().from(schema.productReview).where(eq(schema.productReview.productId, productA));
    expect(stored).toHaveLength(2);
    // The retry with publishImmediately must not flip the existing rows.
    expect(stored.every((r) => r.status === "pending")).toBe(true);
  });

  it("survives a concurrent identical import (double-click): exactly one copy of each row", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => `${productB},,User ${i},${(i % 5) + 1},Concurrent comment number ${i},`);
    const text = csv(...rows);

    const [a, b, c] = await Promise.all([
      run(service.importReviews({ csvText: text, publishImmediately: false })),
      run(service.importReviews({ csvText: text, publishImmediately: false })),
      run(service.importReviews({ csvText: text, publishImmediately: false })),
    ]);
    expect(a.imported + b.imported + c.imported).toBe(40);
    expect(a.imported + a.skipped).toBe(40);
    expect(b.imported + b.skipped).toBe(40);
    expect(c.imported + c.skipped).toBe(40);

    const stored = await db.select().from(schema.productReview).where(eq(schema.productReview.productId, productB));
    expect(stored).toHaveLength(40);
  });

  it("the unique index rejects a duplicate import_key at the database level", async () => {
    const key = "f".repeat(64);
    await db.insert(schema.productReview).values({
      productId: productA, userName: "X1", rating: 5, comment: "one", importKey: key,
    });
    const err = await db
      .insert(schema.productReview)
      .values({ productId: productA, userName: "X2", rating: 5, comment: "two", importKey: key })
      .then(() => null, (e: unknown) => e as { cause?: { code?: string; constraint?: string } });
    expect(err).not.toBeNull();
    // 23505 = unique_violation
    expect(err?.cause?.code).toBe("23505");
    expect(err?.cause?.constraint).toBe("product_review_import_key_idx");
  });

  it("admin list paginates past 100 with a stable total", async () => {
    const rows = Array.from({ length: 130 }, (_, i) => `${productA},,Reviewer ${i},5,Pagination comment ${i},2026-01-01`);
    const result = await run(service.importReviews({ csvText: csv(...rows), publishImmediately: false }));
    expect(result.imported).toBe(130);

    const page1 = await run(viewReviews.viewAllReviews({ limit: 100, offset: 0 }));
    const page2 = await run(viewReviews.viewAllReviews({ limit: 100, offset: 100 }));
    const mine = (r: { productId: string }) => r.productId === productA;
    expect(page1.total).toBeGreaterThanOrEqual(130);
    expect(page2.total).toBe(page1.total);
    expect(page1.reviews).toHaveLength(100);
    expect(page1.reviews.every((r) => r.imported === true || !mine(r))).toBe(true);

    const ids = new Set([...page1.reviews, ...page2.reviews].filter(mine).map((r) => r.id));
    expect(ids.size).toBe(130);
  });

  it("rolls the whole upload back when a later insert chunk fails", async () => {
    // The importer inserts in chunks of 500 inside one transaction. A CHECK
    // constraint that only row 501 violates makes the SECOND statement fail,
    // so this proves the first chunk is rolled back too — not just that a
    // single failing statement inserts nothing.
    await db.execute(
      sql`ALTER TABLE product_review ADD CONSTRAINT tmp_review_import_rollback CHECK (user_name <> 'Rollback')`,
    );
    try {
      const rows = Array.from({ length: 500 }, (_, i) => `${productA},,Reviewer ${i},5,Rollback comment ${i},`);
      rows.push(`${productA},,Rollback,5,This row violates the temporary check,`);
      const text = csv(...rows);

      const preview = await run(service.previewReviewImport({ csvText: text }));
      expect(preview.summary.valid).toBe(501);

      await expect(
        run(service.importReviews({ csvText: text, publishImmediately: false })),
      ).rejects.toThrow();

      const stored = await db
        .select()
        .from(schema.productReview)
        .where(eq(schema.productReview.productId, productA));
      expect(stored).toHaveLength(0);
    } finally {
      await db.execute(sql`ALTER TABLE product_review DROP CONSTRAINT tmp_review_import_rollback`);
    }
  });
});
