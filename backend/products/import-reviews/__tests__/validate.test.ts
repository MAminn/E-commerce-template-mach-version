import { describe, expect, it } from "vitest";
import {
  REVIEW_IMPORT_LIMITS,
  type ResolvedProduct,
  analyzeReviewCsv,
  computeImportKey,
  parseCreatedAt,
} from "../validate";

const P1: ResolvedProduct = {
  id: "0195c3a0-0000-7000-8000-000000000001",
  name: "Synt Aura",
  slug: "synt-aura",
  deleted: false,
};
const P2: ResolvedProduct = {
  id: "0195c3a0-0000-7000-8000-000000000002",
  name: "Mach Whey",
  slug: "mach-whey",
  deleted: false,
};
const GONE: ResolvedProduct = {
  id: "0195c3a0-0000-7000-8000-000000000009",
  name: "Old Product",
  slug: "old-product",
  deleted: true,
};

const NOW = new Date("2026-09-17T12:00:00Z");

function analyze(
  csv: string,
  opts: { products?: ResolvedProduct[]; existing?: string[] } = {},
) {
  const products = opts.products ?? [P1, P2, GONE];
  const calls: { ids: string[]; slugs: string[] }[] = [];
  const keyCalls: string[][] = [];
  const run = analyzeReviewCsv(
    csv,
    async (ids, slugs) => {
      calls.push({ ids, slugs });
      return products.filter(
        (p) =>
          ids.includes(p.id.toLowerCase()) ||
          (p.slug !== null && slugs.includes(p.slug.toLowerCase())),
      );
    },
    {
      now: NOW,
      lookupExistingImportKeys: async (keys) => {
        keyCalls.push(keys);
        return new Set((opts.existing ?? []).filter((k) => keys.includes(k)));
      },
    },
  );
  return run.then((result) => ({ result, calls, keyCalls }));
}

const HEADER = "productId,productSlug,userName,rating,comment,createdAt";

describe("analyzeReviewCsv — file level", () => {
  it("rejects an empty file", async () => {
    const { result } = await analyze("");
    expect(result.fileErrors).toEqual(["The file is empty."]);
  });

  it("rejects a header-only file", async () => {
    const { result } = await analyze(`${HEADER}\n`);
    expect(result.fileErrors[0]).toMatch(/no data rows/);
  });

  it("names every missing required column and lists what it found", async () => {
    const { result } = await analyze("name,stars\nx,5\n");
    expect(result.fileErrors).toEqual([
      'Missing required column "userName".',
      'Missing required column "rating".',
      'Missing required column "comment".',
      'Missing product column — add "productId" or "productSlug".',
      expect.stringContaining('Found columns: "name", "stars"'),
    ]);
    expect(result.rows).toEqual([]);
  });

  it("accepts a productSlug-only header and ignores unknown columns with a warning", async () => {
    const { result } = await analyze(
      "productSlug,userName,rating,comment,email\nsynt-aura,Sara,5,Great stuff,x@y.z\n",
    );
    expect(result.fileErrors).toEqual([]);
    expect(result.warnings).toEqual(['Column "email" is not used and was ignored.']);
    expect(result.summary).toEqual({ total: 1, valid: 1, duplicate: 0, invalid: 0 });
  });

  it("matches headers case-insensitively and with a BOM", async () => {
    const { result } = await analyze(
      "\uFEFFProduct Slug,USERNAME,Rating,Comment\nsynt-aura,Sara,5,Great stuff\n",
    );
    expect(result.fileErrors).toEqual([]);
    expect(result.summary.valid).toBe(1);
  });

  it("enforces the row limit", async () => {
    const rows = Array.from(
      { length: REVIEW_IMPORT_LIMITS.maxRows + 1 },
      (_, i) => `,synt-aura,User ${i},5,Comment number ${i}`,
    ).join("\n");
    const { result } = await analyze(`${HEADER}\n${rows}\n`);
    expect(result.fileErrors[0]).toMatch(/limit is 2000/);
  });

  it("enforces the byte limit (Arabic counts by bytes, not characters)", async () => {
    const big = "ع".repeat(REVIEW_IMPORT_LIMITS.maxFileBytes / 2 + 10); // 2 bytes each
    const { result } = await analyze(`${HEADER}\n,synt-aura,Sara,5,${big}\n`);
    expect(result.fileErrors[0]).toMatch(/larger than 2 MB/);
  });

  it("reports a CSV structure error with its line", async () => {
    const { result } = await analyze(`${HEADER}\n,synt-aura,Sara,5,"unterminated\n`);
    expect(result.fileErrors[0]).toMatch(/^Line 2: Unterminated quoted field/);
  });
});

describe("analyzeReviewCsv — product resolution", () => {
  it("resolves by id, by slug, and by product URL, with ONE lookup call", async () => {
    const { result, calls } = await analyze(
      `${HEADER}\n${P1.id},,Ann,5,Loved it a lot,\n,mach-whey,Ben,4,Solid product,\n,https://machsupplements.com/shop/synt-aura?ref=x,Cid,3,It was fine,\n`,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ ids: [P1.id], slugs: ["mach-whey", "synt-aura"] });
    expect(result.rows.map((r) => r.status)).toEqual(["valid", "valid", "valid"]);
    expect(
      result.rows.map((r) => (r.status === "valid" ? r.review.productName : null)),
    ).toEqual(["Synt Aura", "Mach Whey", "Synt Aura"]);
  });

  it("rejects unknown ids, unknown slugs, non-UUID ids, deleted products and a row with neither", async () => {
    const { result } = await analyze(
      [
        HEADER,
        "0195c3a0-0000-7000-8000-0000000000ff,,Ann,5,Loved it a lot,",
        ",no-such-slug,Ben,5,Loved it a lot,",
        "not-a-uuid,,Cid,5,Loved it a lot,",
        `${GONE.id},,Dee,5,Loved it a lot,`,
        ",,Eve,5,Loved it a lot,",
      ].join("\n"),
    );
    const errs = result.rows.map((r) => (r.status === "invalid" ? r.errors : []));
    expect(errs[0]).toEqual([expect.stringMatching(/^No product with ID 0195c3a0/)]);
    expect(errs[1]).toEqual([expect.stringMatching(/^No product with slug "no-such-slug"/)]);
    expect(errs[2]).toEqual([expect.stringMatching(/not a valid product ID/)]);
    expect(errs[3]).toEqual([expect.stringMatching(/is deleted/)]);
    expect(errs[4]).toEqual(["productId or productSlug is required."]);
    expect(result.summary.invalid).toBe(5);
  });

  it("never matches product names", async () => {
    const { result } = await analyze(`${HEADER}\n,Synt Aura,Ann,5,Loved it a lot,\n`);
    expect(result.rows[0]?.status).toBe("invalid");
    expect((result.rows[0] as { errors: string[] }).errors[0]).toMatch(/product names are not matched/);
  });

  it("rejects an ambiguous slug", async () => {
    const dup: ResolvedProduct = { ...P2, id: "0195c3a0-0000-7000-8000-000000000003", slug: "Synt-Aura" };
    const { result } = await analyze(`${HEADER}\n,synt-aura,Ann,5,Loved it a lot,\n`, {
      products: [P1, dup],
    });
    expect(result.rows[0]?.status).toBe("invalid");
    expect((result.rows[0] as { errors: string[] }).errors[0]).toMatch(/ambiguous — it matches 2 products/);
  });

  it("rejects a row whose productId and productSlug disagree", async () => {
    const { result } = await analyze(`${HEADER}\n${P1.id},mach-whey,Ann,5,Loved it a lot,\n`);
    expect((result.rows[0] as { errors: string[] }).errors[0]).toMatch(/refer to different products/);
  });
});

describe("analyzeReviewCsv — field validation", () => {
  it("collects every error on a row with Excel row numbers and file lines", async () => {
    const { result } = await analyze(
      `${HEADER}\n,synt-aura,"Ann, ok",5,"first\nline",\n,synt-aura,A,7,hi,3/15/2026\n`,
    );
    expect(result.rows[0]).toMatchObject({ row: 2, line: 2, status: "valid" });
    const bad = result.rows[1];
    expect(bad).toMatchObject({ row: 3, line: 4, status: "invalid" });
    expect((bad as { errors: string[] }).errors).toEqual([
      "userName must be at least 2 characters.",
      'rating must be a whole number from 1 to 5 (got "7").',
      "comment must be at least 3 characters.",
      expect.stringMatching(/createdAt "3\/15\/2026" is not in an accepted format \(slash dates/),
    ]);
  });

  it("rejects non-integer ratings", async () => {
    const { result } = await analyze(`${HEADER}\n,synt-aura,Ann,4.5,Loved it a lot,\n`);
    expect((result.rows[0] as { errors: string[] }).errors).toEqual([
      'rating must be a whole number from 1 to 5 (got "4.5").',
    ]);
  });

  it("refuses over-long comments instead of truncating", async () => {
    const { result } = await analyze(`${HEADER}\n,synt-aura,Ann,5,${"x".repeat(501)},\n`);
    expect((result.rows[0] as { errors: string[] }).errors[0]).toMatch(
      /comment is 501 characters; the limit is 500\. Shorten it — comments are never truncated/,
    );
  });

  it("keeps Arabic multi-line comments intact and normalises CRLF inside them", async () => {
    const { result } = await analyze(
      `\uFEFF${HEADER}\r\n,synt-aura,أحمد محمد,5,"منتج ممتاز،\r\nوالتوصيل سريع",2026-03-15\r\n`,
    );
    expect(result.rows[0]?.status).toBe("valid");
    const review = (result.rows[0] as { review: { userName: string; comment: string } }).review;
    expect(review.userName).toBe("أحمد محمد");
    expect(review.comment).toBe("منتج ممتاز،\nوالتوصيل سريع");
  });
});

describe("parseCreatedAt", () => {
  const ok = (s: string) => {
    const r = parseCreatedAt(s, NOW);
    if (!r.ok) throw new Error(r.error);
    return r.date.toISOString();
  };
  const err = (s: string) => {
    const r = parseCreatedAt(s, NOW);
    return r.ok ? null : r.error;
  };

  it("stores a bare date as noon UTC so it reads as that day everywhere", () => {
    expect(ok("2026-03-15")).toBe("2026-03-15T12:00:00.000Z");
  });

  it("treats times without a zone as UTC and honours explicit offsets", () => {
    expect(ok("2026-03-15 14:30")).toBe("2026-03-15T14:30:00.000Z");
    expect(ok("2026-03-15T14:30:15")).toBe("2026-03-15T14:30:15.000Z");
    expect(ok("2026-03-15T14:30:00+02:00")).toBe("2026-03-15T12:30:00.000Z");
    expect(ok("2026-03-15T14:30:00Z")).toBe("2026-03-15T14:30:00.000Z");
    expect(ok("2026-03-15 14:30:00 -0500")).toBe("2026-03-15T19:30:00.000Z");
  });

  it("rejects ambiguous, impossible, future and ancient dates", () => {
    expect(err("15/03/2026")).toMatch(/slash dates/);
    expect(err("2026-02-30")).toMatch(/not a real calendar date/);
    expect(err("2026-03-15 25:00")).toMatch(/not a real calendar date/);
    expect(err("2026-09-18")).toMatch(/in the future/);
    expect(err("1999-12-31")).toMatch(/before the year 2000/);
    expect(err("March 15, 2026")).toMatch(/not in an accepted format/);
  });
});

describe("analyzeReviewCsv — duplicates & import keys", () => {
  it("is deterministic and independent of casing/whitespace of the name", () => {
    const base = { productId: P1.id, userName: "Ann", rating: 5, comment: "Loved it", createdAtRaw: "" };
    expect(computeImportKey(base)).toBe(computeImportKey({ ...base, userName: "  ann " }));
    expect(computeImportKey(base)).not.toBe(computeImportKey({ ...base, rating: 4 }));
    expect(computeImportKey(base)).not.toBe(computeImportKey({ ...base, createdAtRaw: "2026-01-01" }));
    expect(computeImportKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("marks later in-file repeats as duplicates of the first row", async () => {
    const { result } = await analyze(
      `${HEADER}\n,synt-aura,Ann,5,Loved it a lot,\n,synt-aura,Ben,5,Loved it a lot,\n${P1.id},,ann,5,Loved it a lot,\n`,
    );
    expect(result.rows.map((r) => r.status)).toEqual(["valid", "valid", "duplicate"]);
    expect(result.rows[2]).toMatchObject({ row: 4, reason: "in-file", duplicateOfRow: 2 });
    expect(result.summary).toEqual({ total: 3, valid: 2, duplicate: 1, invalid: 0 });
  });

  it("marks rows already in the database as duplicates via one key lookup", async () => {
    const key = computeImportKey({ productId: P1.id, userName: "Ann", rating: 5, comment: "Loved it a lot", createdAtRaw: "" });
    const { result, keyCalls } = await analyze(
      `${HEADER}\n,synt-aura,Ann,5,Loved it a lot,\n,synt-aura,Ben,4,Solid product,\n`,
      { existing: [key] },
    );
    expect(keyCalls).toHaveLength(1);
    expect(keyCalls[0]).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ status: "duplicate", reason: "already-imported" });
    expect(result.rows[1]?.status).toBe("valid");
  });

  it("does not query keys when nothing is valid", async () => {
    const { keyCalls } = await analyze(`${HEADER}\n,nope,Ann,5,Loved it a lot,\n`);
    expect(keyCalls).toEqual([]);
  });
});
