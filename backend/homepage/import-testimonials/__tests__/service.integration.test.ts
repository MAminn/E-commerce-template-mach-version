import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

// Real-Postgres integration test for the homepage-testimonials importer —
// see docs/MARKETING_SUITE_PLAN.md "Running the DB integration tests".
// Covers what validate.test.ts cannot: that the import appends to the row the
// storefront reads, touches nothing else in that row, enables the section,
// is a no-op on a repeat upload, and creates a minimal row when none exists.

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

describeIfDb("homepage testimonial import service (integration)", () => {
  let schema: typeof import("#root/shared/database/drizzle/schema");
  let db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema> & {
    $client: import("pg").Pool;
  };
  let service: typeof import("#root/backend/homepage/import-testimonials/service");
  let raw: typeof import("#root/backend/homepage/get-homepage-content/raw");
  let dbModule: typeof import("#root/shared/database/drizzle/db");
  let merchantId: string;

  const TEMPLATE = "landing-editorial"; // the Mach landing template id
  const run = <A, E>(
    effect: Effect.Effect<A, E, import("#root/shared/database/drizzle/db").DatabaseClientService>,
  ): Promise<A> =>
    Effect.runPromise(effect.pipe(Effect.provideService(dbModule.DatabaseClientService, db)));

  const csv = (...rows: string[]) => `\uFEFF${["name,rating,review,nameAr,reviewAr", ...rows].join("\r\n")}\r\n`;

  const storedRow = async () =>
    (
      await db
        .select()
        .from(schema.homepageContent)
        .where(and(eq(schema.homepageContent.merchantId, merchantId), eq(schema.homepageContent.templateId, TEMPLATE)))
    )[0];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    schema = await import("#root/shared/database/drizzle/schema");
    db = drizzle(TEST_DB_URL!, { schema });
    dbModule = await import("#root/shared/database/drizzle/db");
    service = await import("#root/backend/homepage/import-testimonials/service");
    raw = await import("#root/backend/homepage/get-homepage-content/raw");
    merchantId = (await import("#root/shared/config/store")).getStoreOwnerId();
  });

  beforeEach(async () => {
    await db
      .delete(schema.homepageContent)
      .where(and(eq(schema.homepageContent.merchantId, merchantId), eq(schema.homepageContent.templateId, TEMPLATE)));
  });

  afterAll(async () => {
    await db
      .delete(schema.homepageContent)
      .where(and(eq(schema.homepageContent.merchantId, merchantId), eq(schema.homepageContent.templateId, TEMPLATE)));
  });

  async function seedRow(testimonials: unknown) {
    const { v7 } = await import("uuid");
    await db.insert(schema.homepageContent).values({
      id: v7(),
      merchantId,
      templateId: TEMPLATE,
      content: {
        hero: { enabled: true, title: "KEEP ME", subtitle: "untouched", ctaText: "Shop", ctaLink: "/shop" },
        sectionOrder: ["heroMarquee", "whyMach", "footerCta"],
        newsletter: { enabled: false, title: "Newsletter" },
        testimonials,
      } as never,
    });
  }

  it("appends to the existing block, preserves order and every other homepage field, and enables the section", async () => {
    await seedRow({
      enabled: false,
      title: "Voices",
      titleAr: "آراء",
      items: [{ name: "Existing One", rating: 4, review: "Was here first" }],
    });

    const result = await run(
      service.importTestimonials({
        csvText: csv("Sara M.,5,Great products,سارة,منتجات ممتازة", "existing one,1,was here first,,"),
        templateId: TEMPLATE,
      }),
    );
    expect(result).toMatchObject({ imported: 1, skipped: 1, failed: 0, totalAfter: 2, templateId: TEMPLATE });

    const row = await storedRow();
    const content = row!.content as Record<string, unknown>;
    expect(content.hero).toEqual({ enabled: true, title: "KEEP ME", subtitle: "untouched", ctaText: "Shop", ctaLink: "/shop" });
    expect(content.sectionOrder).toEqual(["heroMarquee", "whyMach", "footerCta"]);
    expect(content.newsletter).toEqual({ enabled: false, title: "Newsletter" });
    expect(content.testimonials).toEqual({
      enabled: true,
      title: "Voices",
      titleAr: "آراء",
      items: [
        { name: "Existing One", rating: 4, review: "Was here first" },
        { name: "Sara M.", rating: 5, review: "Great products", nameAr: "سارة", reviewAr: "منتجات ممتازة" },
      ],
    });

    // What the storefront actually reads.
    const merged = await raw.getHomepageContentRaw(db, merchantId, TEMPLATE);
    expect(merged.testimonials?.enabled).toBe(true);
    expect(merged.testimonials?.items.map((i) => i.name)).toEqual(["Existing One", "Sara M."]);
    expect(merged.hero.title).toBe("KEEP ME");
  });

  it("a repeat upload of the same file adds nothing and the preview says so", async () => {
    await seedRow({ enabled: false, items: [] });
    const text = csv("Ann,5,Loved it a lot,,", "Ben,4,Solid product,,");

    const first = await run(service.importTestimonials({ csvText: text, templateId: TEMPLATE }));
    expect(first).toMatchObject({ imported: 2, skipped: 0, totalAfter: 2 });

    const preview = await run(service.previewTestimonialImport({ csvText: text, templateId: TEMPLATE }));
    expect(preview.rows.map((r) => r.status)).toEqual(["duplicate", "duplicate"]);
    expect(preview.summary).toMatchObject({ valid: 0, duplicate: 2, existing: 2, afterImport: 2 });

    const second = await run(service.importTestimonials({ csvText: text, templateId: TEMPLATE }));
    expect(second).toMatchObject({ imported: 0, skipped: 2, totalAfter: 2 });

    const items = ((await storedRow())!.content as { testimonials: { items: unknown[] } }).testimonials.items;
    expect(items).toHaveLength(2);
  });

  it("preview never writes, and a rejected file publishes nothing — not even the switch-on", async () => {
    await seedRow({ enabled: false, items: [] });

    await run(service.previewTestimonialImport({ csvText: csv("Ann,5,Loved it a lot,,"), templateId: TEMPLATE }));
    expect(((await storedRow())!.content as { testimonials: { enabled: boolean; items: unknown[] } }).testimonials).toEqual({
      enabled: false,
      items: [],
    });

    const bad = await run(service.importTestimonials({ csvText: "who,stars\nx,5\n", templateId: TEMPLATE }));
    expect(bad.analysis.fileErrors.length).toBeGreaterThan(0);
    expect(bad.imported).toBe(0);
    expect(((await storedRow())!.content as { testimonials: { enabled: boolean } }).testimonials.enabled).toBe(false);
  });

  it("creates a minimal row when the template has no homepage content yet, and the read path merges defaults around it", async () => {
    const result = await run(
      service.importTestimonials({ csvText: csv("Ann,5,Loved it a lot,,"), templateId: TEMPLATE }),
    );
    expect(result).toMatchObject({ imported: 1, totalAfter: 1 });

    const row = await storedRow();
    expect(Object.keys(row!.content as object)).toEqual(["testimonials"]);

    const merged = await raw.getHomepageContentRaw(db, merchantId, TEMPLATE);
    expect(merged.testimonials).toMatchObject({ enabled: true, items: [{ name: "Ann", rating: 5, review: "Loved it a lot" }] });
    expect(merged.hero).toBeDefined(); // defaults filled in
  });

  it("flags the template's shipped sample quotes and can replace them explicitly", async () => {
    const { DEFAULT_HOMEPAGE_CONTENT } = await import("#root/shared/types/homepage-content");
    const samples = DEFAULT_HOMEPAGE_CONTENT.testimonials!.items;
    await seedRow({ enabled: false, title: "Voices", items: samples });

    const text = csv("Real Customer,5,Actually bought it,,");
    const preview = await run(service.previewTestimonialImport({ csvText: text, templateId: TEMPLATE }));
    expect(preview.existing).toEqual({
      count: samples.length,
      names: samples.map((i) => i.name),
      shippedSamples: true,
      enabled: false,
    });
    expect(preview.summary.afterImport).toBe(samples.length + 1); // append by default

    const withReplace = await run(
      service.previewTestimonialImport({ csvText: text, templateId: TEMPLATE, replaceExisting: true }),
    );
    expect(withReplace.summary).toMatchObject({ existing: 0, afterImport: 1 });

    const result = await run(
      service.importTestimonials({ csvText: text, templateId: TEMPLATE, replaceExisting: true }),
    );
    expect(result).toMatchObject({ imported: 1, replaced: samples.length, totalAfter: 1 });
    const block = ((await storedRow())!.content as { testimonials: { enabled: boolean; title: string; items: { name: string }[] } }).testimonials;
    expect(block.enabled).toBe(true);
    expect(block.title).toBe("Voices"); // title/titleAr kept even when items are replaced
    expect(block.items.map((i) => i.name)).toEqual(["Real Customer"]);

    // A real customer entry means the section is no longer "just samples".
    const after = await run(service.previewTestimonialImport({ csvText: text, templateId: TEMPLATE }));
    expect(after.existing.shippedSamples).toBe(false);
  });

  it("never touches product_review", async () => {
    const before = (await db.select({ id: schema.productReview.id }).from(schema.productReview)).length;
    await seedRow({ enabled: false, items: [] });
    await run(service.importTestimonials({ csvText: csv("Ann,5,Loved it a lot,,"), templateId: TEMPLATE }));
    const after = (await db.select({ id: schema.productReview.id }).from(schema.productReview)).length;
    expect(after).toBe(before);
  });
});
