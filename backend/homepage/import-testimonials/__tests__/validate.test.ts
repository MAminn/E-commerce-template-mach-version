import { describe, expect, it } from "vitest";
import { TESTIMONIAL_IMPORT_LIMITS, type TestimonialItem } from "../constants";
import { analyzeTestimonialCsv, testimonialKey } from "../validate";

const HEADER = "name,rating,review,nameAr,reviewAr";

const EXISTING: TestimonialItem[] = [
  { name: "Sarah Mitchell", rating: 5, review: "Absolutely love the quality!" },
];

describe("analyzeTestimonialCsv — file level", () => {
  it("rejects an empty file and a header-only file", () => {
    expect(analyzeTestimonialCsv("", []).fileErrors).toEqual(["The file is empty."]);
    expect(analyzeTestimonialCsv(`${HEADER}\n`, []).fileErrors[0]).toMatch(/no data rows/);
  });

  it("names missing required columns with their accepted aliases", () => {
    const r = analyzeTestimonialCsv("who,stars\nx,5\n", []);
    expect(r.fileErrors[0]).toMatch(/Missing required column "name" \(also accepted: "username", "customer"/);
    expect(r.fileErrors).toContainEqual(expect.stringMatching(/Missing required column "review"/));
    expect(r.fileErrors.at(-1)).toMatch(/Found columns: "who", "stars"/);
    expect(r.rows).toEqual([]);
  });

  it("accepts the product-review header (userName/comment) and ignores product columns with a clear note", () => {
    const r = analyzeTestimonialCsv(
      "\uFEFFproductId,productSlug,userName,rating,comment,createdAt\r\n,synt-aura,Ann,5,Loved it a lot,2026-03-15\r\n",
      [],
    );
    expect(r.fileErrors).toEqual([]);
    expect(r.warnings).toEqual([
      expect.stringMatching(/Ignored "productId", "productSlug", "createdAt" — homepage testimonials are not tied to products/),
    ]);
    expect(r.rows[0]).toMatchObject({ status: "valid", item: { name: "Ann", rating: 5, review: "Loved it a lot" } });
    expect((r.rows[0] as { item: TestimonialItem }).item).not.toHaveProperty("nameAr");
  });

  it("enforces row, byte and total-item limits", () => {
    const rows = Array.from({ length: TESTIMONIAL_IMPORT_LIMITS.maxRows + 1 }, (_, i) => `User ${i},5,Comment ${i}`);
    expect(analyzeTestimonialCsv(`name,rating,review\n${rows.join("\n")}\n`, []).fileErrors[0]).toMatch(/limit is 300/);

    const big = "ع".repeat(TESTIMONIAL_IMPORT_LIMITS.maxFileBytes / 2 + 10);
    expect(analyzeTestimonialCsv(`name,rating,review\nAnn,5,${big}\n`, []).fileErrors[0]).toMatch(/larger than 1 MB/);

    const existing = Array.from({ length: TESTIMONIAL_IMPORT_LIMITS.maxTotalItems }, (_, i) => ({
      name: `Existing ${i}`, rating: 5, review: `Existing review ${i}`,
    }));
    const r = analyzeTestimonialCsv("name,rating,review\nNew,5,Brand new quote\n", existing);
    expect(r.fileErrors[0]).toMatch(/would leave 301 testimonials/);
  });
});

describe("analyzeTestimonialCsv — rows", () => {
  it("keeps Arabic, multiline quoted text and escaped quotes intact (BOM + CRLF)", () => {
    const r = analyzeTestimonialCsv(
      `\uFEFF${HEADER}\r\nSara M.,5,"Great, ""really"" great.\r\nSecond line.",سارة م.,"منتج ممتاز،\r\nوالتوصيل سريع"\r\n`,
      [],
    );
    expect(r.rows[0]).toMatchObject({
      row: 2,
      status: "valid",
      item: {
        name: "Sara M.",
        rating: 5,
        review: 'Great, "really" great.\nSecond line.',
        nameAr: "سارة م.",
        reviewAr: "منتج ممتاز،\nوالتوصيل سريع",
      },
    });
  });

  it("collects every error on a row with Excel row numbers", () => {
    const r = analyzeTestimonialCsv(`${HEADER}\nA,7,hi,,\n,x,${"x".repeat(601)},,\n`, []);
    expect(r.rows[0]).toMatchObject({ row: 2, status: "invalid" });
    expect((r.rows[0] as { errors: string[] }).errors).toEqual([
      "name must be at least 2 characters.",
      "review must be at least 3 characters.",
      'rating must be a whole number from 1 to 5 (got "7").',
    ]);
    expect((r.rows[1] as { errors: string[] }).errors).toEqual([
      "name is required.",
      expect.stringMatching(/review is 601 characters; the limit is 600. Shorten it — text is never truncated/),
      'rating must be a whole number from 1 to 5 (got "x").',
    ]);
    expect(r.summary).toMatchObject({ total: 2, valid: 0, invalid: 2 });
  });

  it("rejects non-integer ratings and validates optional Arabic lengths", () => {
    const r = analyzeTestimonialCsv(`${HEADER}\nAnn,4.5,Solid product,${"ع".repeat(81)},\n`, []);
    expect((r.rows[0] as { errors: string[] }).errors).toEqual([
      "nameAr is 81 characters; the limit is 80. Shorten it — text is never truncated automatically.",
      'rating must be a whole number from 1 to 5 (got "4.5").',
    ]);
  });
});

describe("analyzeTestimonialCsv — duplicates", () => {
  it("keys on name + review, ignoring case and whitespace, not on rating or Arabic", () => {
    const a = testimonialKey({ name: "Sarah Mitchell", review: "Absolutely  love the quality!" });
    expect(a).toBe(testimonialKey({ name: " sarah mitchell ", review: "absolutely love the quality!" }));
    expect(a).not.toBe(testimonialKey({ name: "Sarah Mitchell", review: "Absolutely love the quality" }));
  });

  it("marks in-file repeats and rows already on the homepage, and counts the result", () => {
    const r = analyzeTestimonialCsv(
      `${HEADER}\nsarah mitchell,4,Absolutely love the quality!,,\nAnn,5,Loved it a lot,,\nann,5,Loved it a lot,,\nBen,3,Decent value,,\n`,
      EXISTING,
    );
    expect(r.rows.map((x) => x.status)).toEqual(["duplicate", "valid", "duplicate", "valid"]);
    expect(r.rows[0]).toMatchObject({ reason: "already-published" });
    expect(r.rows[2]).toMatchObject({ reason: "in-file", duplicateOfRow: 3 });
    expect(r.summary).toEqual({ total: 4, valid: 2, duplicate: 2, invalid: 0, existing: 1, afterImport: 3 });
  });
});
