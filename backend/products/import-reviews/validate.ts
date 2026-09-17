import { createHash } from "node:crypto";
import { REVIEW_LIMITS } from "../create-review/service";
import {
  CREATED_AT_FORMAT_HINT,
  REVIEW_IMPORT_COLUMNS,
  REVIEW_IMPORT_LIMITS,
} from "./constants";
import { type CsvRecord, parseCsv } from "./csv";

/**
 * Pure validation for the review CSV importer.
 *
 * Everything here runs identically for the preview and for the actual
 * import — the server never trusts what the browser showed the admin; it
 * re-derives every row from the raw CSV text at import time.
 */

export {
  CREATED_AT_FORMAT_HINT,
  REVIEW_IMPORT_COLUMNS,
  REVIEW_IMPORT_LIMITS,
} from "./constants";

type Column = (typeof REVIEW_IMPORT_COLUMNS)[number];

const REQUIRED_COLUMNS: Column[] = ["userName", "rating", "comment"];

/** Accepted createdAt shapes — see docs/REVIEW_CSV_IMPORT.md. */
const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;

export interface ResolvedProduct {
  id: string;
  name: string;
  slug: string | null;
  deleted: boolean;
}

/** Lookup built from ONE product query per upload, keyed for O(1) resolution. */
export interface ProductLookup {
  byId: Map<string, ResolvedProduct>;
  /** Lower-cased slug → every non-deleted product carrying it. More than one
   * entry means the identifier is ambiguous and the row is rejected. */
  bySlug: Map<string, ResolvedProduct[]>;
}

export function buildProductLookup(products: ResolvedProduct[]): ProductLookup {
  const byId = new Map<string, ResolvedProduct>();
  const bySlug = new Map<string, ResolvedProduct[]>();
  for (const p of products) {
    byId.set(p.id.toLowerCase(), p);
    if (p.slug && !p.deleted) {
      const key = p.slug.trim().toLowerCase();
      const list = bySlug.get(key) ?? [];
      list.push(p);
      bySlug.set(key, list);
    }
  }
  return { byId, bySlug };
}

export interface ValidReview {
  productId: string;
  productName: string;
  userName: string;
  rating: number;
  comment: string;
  /** null → the importer stamps the import time. */
  createdAt: Date | null;
  importKey: string;
}

export type ImportRowResult = {
  /** Row number as Excel shows it (header = row 1, first data row = 2). */
  row: number;
  /** 1-based line in the raw file where the record starts. */
  line: number;
} & (
  | { status: "valid"; review: ValidReview }
  | {
      status: "duplicate";
      reason: "in-file" | "already-imported";
      /** Set for in-file duplicates: the earlier row this one repeats. */
      duplicateOfRow?: number;
      review: ValidReview;
    }
  | { status: "invalid"; errors: string[] }
);

export interface ImportAnalysis {
  /** Problems with the file as a whole. When non-empty, `rows` is empty. */
  fileErrors: string[];
  /** Non-fatal notes (ignored columns etc.). */
  warnings: string[];
  rows: ImportRowResult[];
  summary: {
    total: number;
    valid: number;
    duplicate: number;
    invalid: number;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Import identity — deliberately built from the SUPPLIED date string, not
 * the resolved Date, so a row with no date hashes the same on every retry
 * even though its stored createdAt is "now". */
export function computeImportKey(parts: {
  productId: string;
  userName: string;
  rating: number;
  comment: string;
  createdAtRaw: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        parts.productId.toLowerCase(),
        parts.userName.trim().toLowerCase(),
        parts.rating,
        parts.comment,
        parts.createdAtRaw.trim(),
      ]),
    )
    .digest("hex");
}

export function parseCreatedAt(
  raw: string,
  now: Date,
): { ok: true; date: Date } | { ok: false; error: string } {
  const value = raw.trim();
  const m = DATE_RE.exec(value);
  if (!m) {
    const looksLikeSlashDate = /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(value);
    return {
      ok: false,
      error: `createdAt "${value}" is not in an accepted format${
        looksLikeSlashDate
          ? " (slash dates like 3/15/2026 are ambiguous — Excel reformats dates unless the column is set to Text)"
          : ""
      }. ${CREATED_AT_FORMAT_HINT}`,
    };
  }
  const [, y, mo, d, hh, mm, ss, tz] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hasTime = hh !== undefined;
  const hour = hasTime ? Number(hh) : 12;
  const minute = hasTime ? Number(mm) : 0;
  const second = ss !== undefined ? Number(ss) : 0;

  let offsetMinutes = 0;
  if (tz && tz !== "Z") {
    const sign = tz[0] === "-" ? -1 : 1;
    const digits = tz.slice(1).replace(":", "");
    offsetMinutes =
      sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
  }

  const wallClockMs = Date.UTC(year, month - 1, day, hour, minute, second);
  // Round-trip check catches 2026-02-31, 25:00 etc. — Date.UTC silently rolls over.
  const check = new Date(wallClockMs);
  if (
    Number.isNaN(wallClockMs) ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return {
      ok: false,
      error: `createdAt "${value}" is not a real calendar date/time.`,
    };
  }
  const date = new Date(wallClockMs - offsetMinutes * 60_000);
  if (date.getTime() > now.getTime() + 5 * 60_000) {
    return { ok: false, error: `createdAt "${value}" is in the future.` };
  }
  if (year < 2000) {
    return {
      ok: false,
      error: `createdAt "${value}" is before the year 2000 — check the date.`,
    };
  }
  return { ok: true, date };
}

function normalizeHeader(name: string): Column | null {
  const key = name
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  for (const col of REVIEW_IMPORT_COLUMNS) {
    if (col.toLowerCase() === key) return col;
  }
  return null;
}

/** Accepts a bare slug or a product URL / path and returns the slug part. */
function extractSlug(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  return (lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed).trim();
}

export interface AnalyzeOptions {
  /** Import keys already present in product_review (from a previous upload). */
  lookupExistingImportKeys: (keys: string[]) => Promise<Set<string>>;
  now?: Date;
}

/**
 * Parse + validate a whole CSV. `resolveProducts` is called once with every
 * distinct id/slug in the file so the caller can do a single database query;
 * `lookupExistingImportKeys` likewise gets every candidate key at once.
 */
export async function analyzeReviewCsv(
  csvText: string,
  resolveProducts: (
    ids: string[],
    slugs: string[],
  ) => Promise<ResolvedProduct[]>,
  options: AnalyzeOptions,
): Promise<ImportAnalysis> {
  const now = options.now ?? new Date();
  const empty = (
    fileErrors: string[],
    warnings: string[] = [],
  ): ImportAnalysis => ({
    fileErrors,
    warnings,
    rows: [],
    summary: { total: 0, valid: 0, duplicate: 0, invalid: 0 },
  });

  if (Buffer.byteLength(csvText, "utf8") > REVIEW_IMPORT_LIMITS.maxFileBytes) {
    return empty([
      `File is larger than ${REVIEW_IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB. Split it into smaller files.`,
    ]);
  }

  const parsed = parseCsv(csvText);
  if (parsed.errors.length > 0) {
    return empty(parsed.errors.map((e) => `Line ${e.line}: ${e.message}`));
  }
  if (parsed.records.length === 0) {
    return empty(["The file is empty."]);
  }

  // ── Header ──────────────────────────────────────────────────────────
  const header = parsed.records[0] as CsvRecord;
  const records = parsed.records.slice(1);
  const columnIndex = new Map<Column, number>();
  const warnings: string[] = [];
  header.fields.forEach((name, idx) => {
    const col = normalizeHeader(name);
    if (!col) {
      if (name.trim() !== "")
        warnings.push(`Column "${name.trim()}" is not used and was ignored.`);
      return;
    }
    if (columnIndex.has(col))
      warnings.push(
        `Column "${col}" appears more than once; the first one is used.`,
      );
    else columnIndex.set(col, idx);
  });

  const fileErrors: string[] = [];
  for (const col of REQUIRED_COLUMNS) {
    if (!columnIndex.has(col))
      fileErrors.push(`Missing required column "${col}".`);
  }
  if (!columnIndex.has("productId") && !columnIndex.has("productSlug")) {
    fileErrors.push(
      'Missing product column — add "productId" or "productSlug".',
    );
  }
  if (fileErrors.length > 0) {
    fileErrors.push(
      `Found columns: ${
        header.fields.map((f) => `"${f.trim()}"`).join(", ") || "(none)"
      }. Download the template to get the exact header row.`,
    );
    return empty(fileErrors, warnings);
  }

  if (records.length === 0)
    return empty(["The file has a header row but no data rows."], warnings);
  if (records.length > REVIEW_IMPORT_LIMITS.maxRows) {
    return empty(
      [
        `The file has ${records.length} data rows; the limit is ${REVIEW_IMPORT_LIMITS.maxRows} per upload. Split it into smaller files.`,
      ],
      warnings,
    );
  }

  const cell = (rec: CsvRecord, col: Column): string => {
    const idx = columnIndex.get(col);
    return idx === undefined ? "" : (rec.fields[idx] ?? "");
  };

  // ── Product resolution: one query for the whole file ────────────────
  const wantedIds = new Set<string>();
  const wantedSlugs = new Set<string>();
  for (const rec of records) {
    const id = cell(rec, "productId").trim();
    if (UUID_RE.test(id)) wantedIds.add(id.toLowerCase());
    const slug = extractSlug(cell(rec, "productSlug"));
    if (slug) wantedSlugs.add(slug.toLowerCase());
  }
  const lookup = buildProductLookup(
    wantedIds.size + wantedSlugs.size > 0
      ? await resolveProducts([...wantedIds], [...wantedSlugs])
      : [],
  );

  // ── Row validation ──────────────────────────────────────────────────
  type Pending =
    | { row: number; line: number; status: "invalid"; errors: string[] }
    | { row: number; line: number; status: "candidate"; review: ValidReview; rawCreatedAt: string };
  const pending: Pending[] = [];

  records.forEach((rec, idx) => {
    const row = idx + 2; // Excel row: header is row 1
    const line = rec.line;
    const errors: string[] = [];

    // Product
    const rawId = cell(rec, "productId").trim();
    const rawSlug = extractSlug(cell(rec, "productSlug"));
    let product: ResolvedProduct | null = null;
    if (!rawId && !rawSlug) {
      errors.push("productId or productSlug is required.");
    }
    let byId: ResolvedProduct | null = null;
    if (rawId) {
      if (!UUID_RE.test(rawId)) {
        errors.push(
          `productId "${rawId}" is not a valid product ID (expected a UUID). Use productSlug if you only know the product URL.`,
        );
      } else {
        byId = lookup.byId.get(rawId.toLowerCase()) ?? null;
        if (!byId) errors.push(`No product with ID ${rawId}.`);
        else if (byId.deleted) {
          errors.push(`Product "${byId.name}" (${rawId}) is deleted.`);
          byId = null;
        }
      }
    }
    let bySlug: ResolvedProduct | null = null;
    if (rawSlug) {
      const matches = lookup.bySlug.get(rawSlug.toLowerCase()) ?? [];
      if (matches.length === 0) {
        errors.push(
          `No product with slug "${rawSlug}". Slugs are the last part of the product URL (e.g. /shop/synt-aura → synt-aura); product names are not matched.`,
        );
      } else if (matches.length > 1) {
        errors.push(
          `Slug "${rawSlug}" is ambiguous — it matches ${matches.length} products. Use productId instead.`,
        );
      } else {
        bySlug = matches[0] ?? null;
      }
    }
    if (byId && bySlug && byId.id !== bySlug.id) {
      errors.push(
        `productId (${byId.name}) and productSlug (${bySlug.name}) refer to different products.`,
      );
    } else {
      product = byId ?? bySlug;
    }

    // userName
    const userName = cell(rec, "userName").trim();
    if (userName.length === 0) errors.push("userName is required.");
    else if (userName.length < REVIEW_LIMITS.userName.min)
      errors.push(
        `userName must be at least ${REVIEW_LIMITS.userName.min} characters.`,
      );
    else if (userName.length > REVIEW_LIMITS.userName.max)
      errors.push(
        `userName is ${userName.length} characters; the limit is ${REVIEW_LIMITS.userName.max}.`,
      );

    // rating
    const rawRating = cell(rec, "rating").trim();
    let rating = Number.NaN;
    if (rawRating.length === 0) errors.push("rating is required.");
    else if (!/^[1-5]$/.test(rawRating))
      errors.push(
        `rating must be a whole number from ${REVIEW_LIMITS.rating.min} to ${REVIEW_LIMITS.rating.max} (got "${rawRating}").`,
      );
    else rating = Number(rawRating);

    // comment — line endings normalised so CRLF vs LF exports hash the same
    const comment = cell(rec, "comment").replace(/\r\n?/g, "\n").trim();
    if (comment.length === 0) errors.push("comment is required.");
    else if (comment.length < REVIEW_LIMITS.comment.min)
      errors.push(
        `comment must be at least ${REVIEW_LIMITS.comment.min} characters.`,
      );
    else if (comment.length > REVIEW_LIMITS.comment.max)
      errors.push(
        `comment is ${comment.length} characters; the limit is ${REVIEW_LIMITS.comment.max}. Shorten it — comments are never truncated automatically.`,
      );

    // createdAt
    const rawCreatedAt = cell(rec, "createdAt").trim();
    let createdAt: Date | null = null;
    if (rawCreatedAt.length > 0) {
      const r = parseCreatedAt(rawCreatedAt, now);
      if (r.ok) createdAt = r.date;
      else errors.push(r.error);
    }

    if (errors.length > 0 || !product) {
      pending.push({ row, line, status: "invalid", errors });
      return;
    }

    pending.push({
      row,
      line,
      status: "candidate",
      rawCreatedAt,
      review: {
        productId: product.id,
        productName: product.name,
        userName,
        rating,
        comment,
        createdAt,
        importKey: computeImportKey({
          productId: product.id,
          userName,
          rating,
          comment,
          createdAtRaw: rawCreatedAt,
        }),
      },
    });
  });

  // ── Duplicates: within the file, then against previous imports ──────
  const candidateKeys = [
    ...new Set(
      pending.flatMap((p) =>
        p.status === "candidate" ? [p.review.importKey] : [],
      ),
    ),
  ];
  const existing =
    candidateKeys.length > 0
      ? await options.lookupExistingImportKeys(candidateKeys)
      : new Set<string>();

  const seenKeys = new Map<string, number>();
  const rows: ImportRowResult[] = pending.map((p) => {
    if (p.status === "invalid") return p;
    const { row, line, review } = p;
    const earlier = seenKeys.get(review.importKey);
    if (earlier !== undefined) {
      return {
        row,
        line,
        status: "duplicate",
        reason: "in-file",
        duplicateOfRow: earlier,
        review,
      };
    }
    seenKeys.set(review.importKey, row);
    if (existing.has(review.importKey)) {
      return { row, line, status: "duplicate", reason: "already-imported", review };
    }
    return { row, line, status: "valid", review };
  });

  return {
    fileErrors: [],
    warnings,
    rows,
    summary: {
      total: rows.length,
      valid: rows.filter((r) => r.status === "valid").length,
      duplicate: rows.filter((r) => r.status === "duplicate").length,
      invalid: rows.filter((r) => r.status === "invalid").length,
    },
  };
}
