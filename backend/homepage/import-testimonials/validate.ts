import { type CsvRecord, parseCsv } from "#root/shared/utils/csv";
import {
  TESTIMONIAL_CSV_COLUMNS,
  TESTIMONIAL_IMPORT_LIMITS,
  TESTIMONIAL_LIMITS,
  type TestimonialItem,
} from "./constants";

/**
 * Pure validation for the homepage-testimonials CSV importer.
 *
 * A testimonial is a piece of homepage CMS copy — a name, a star rating and a
 * quote, optionally in Arabic too. It is NOT a product review: nothing here
 * resolves products, and nothing here writes to product_review.
 *
 * Preview and import both run this on the raw CSV text; the browser's
 * preview is never trusted at import time.
 */

type Column = (typeof TESTIMONIAL_CSV_COLUMNS)[number];

/** Header spellings accepted for each column (compared case-insensitively,
 * ignoring spaces, hyphens and underscores). The aliases let a file built
 * for the product-review importer be reused with its product columns
 * simply ignored. */
const HEADER_ALIASES: Record<Column, string[]> = {
  name: ["name", "username", "customer", "customername", "reviewer"],
  nameAr: ["namear", "arabicname", "namearabic"],
  rating: ["rating", "stars", "score"],
  review: ["review", "comment", "testimonial", "text", "quote"],
  reviewAr: ["reviewar", "commentar", "arabicreview", "reviewarabic", "testimonialar"],
};

const REQUIRED_COLUMNS: Column[] = ["name", "rating", "review"];

/** Columns the product-review importer uses; called out by name so the
 * warning explains why they were ignored instead of just listing them. */
const PRODUCT_REVIEW_COLUMNS = new Set([
  "productid",
  "productslug",
  "createdat",
]);

export type TestimonialRowResult = {
  /** Row number as Excel shows it (header = row 1, first data row = 2). */
  row: number;
  /** 1-based line in the raw file where the record starts. */
  line: number;
} & (
  | { status: "valid"; item: TestimonialItem }
  | {
      status: "duplicate";
      reason: "in-file" | "already-published";
      duplicateOfRow?: number;
      item: TestimonialItem;
    }
  | { status: "invalid"; errors: string[] }
);

export interface TestimonialImportAnalysis {
  /** Problems with the file as a whole. When non-empty, `rows` is empty. */
  fileErrors: string[];
  warnings: string[];
  rows: TestimonialRowResult[];
  summary: {
    total: number;
    /** Will be appended on import. */
    valid: number;
    duplicate: number;
    invalid: number;
    /** Testimonials already saved in the CMS before this import. */
    existing: number;
    /** existing + valid — what the section will hold after import. */
    afterImport: number;
  };
}

function normalizeHeader(name: string): string {
  return name
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

function columnForHeader(name: string): Column | null {
  const key = normalizeHeader(name);
  for (const col of TESTIMONIAL_CSV_COLUMNS) {
    if (HEADER_ALIASES[col].includes(key)) return col;
  }
  return null;
}

/** Whitespace/line-ending normalisation applied to every text cell. */
function cleanText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").trim();
}

/**
 * Identity of a testimonial for duplicate detection: the primary name and
 * quote, case-folded with whitespace collapsed. Two rows that differ only in
 * casing or spacing are the same testimonial; a different rating or a
 * different Arabic translation is not enough to make it a new one.
 */
export function testimonialKey(item: Pick<TestimonialItem, "name" | "review">): string {
  const fold = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  // A newline cannot occur in a folded string, so it is a safe separator.
  return `${fold(item.name)}\n${fold(item.review)}`;
}

function validateText(
  label: string,
  value: string,
  limits: { min: number; max: number },
  required: boolean,
  errors: string[],
): void {
  if (value.length === 0) {
    if (required) errors.push(`${label} is required.`);
    return;
  }
  if (value.length < limits.min)
    errors.push(`${label} must be at least ${limits.min} characters.`);
  else if (value.length > limits.max)
    errors.push(
      `${label} is ${value.length} characters; the limit is ${limits.max}. Shorten it — text is never truncated automatically.`,
    );
}

/**
 * Parse and validate a testimonials CSV against the testimonials already
 * saved in the CMS.
 */
export function analyzeTestimonialCsv(
  csvText: string,
  existingItems: TestimonialItem[],
): TestimonialImportAnalysis {
  const existing = existingItems.length;
  const empty = (
    fileErrors: string[],
    warnings: string[] = [],
  ): TestimonialImportAnalysis => ({
    fileErrors,
    warnings,
    rows: [],
    summary: {
      total: 0,
      valid: 0,
      duplicate: 0,
      invalid: 0,
      existing,
      afterImport: existing,
    },
  });

  if (
    Buffer.byteLength(csvText, "utf8") > TESTIMONIAL_IMPORT_LIMITS.maxFileBytes
  ) {
    return empty([
      `File is larger than ${TESTIMONIAL_IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB. Split it into smaller files.`,
    ]);
  }

  const parsed = parseCsv(csvText);
  if (parsed.errors.length > 0) {
    return empty(parsed.errors.map((e) => `Line ${e.line}: ${e.message}`));
  }
  if (parsed.records.length === 0) return empty(["The file is empty."]);

  // ── Header ──────────────────────────────────────────────────────────
  const header = parsed.records[0] as CsvRecord;
  const records = parsed.records.slice(1);
  const columnIndex = new Map<Column, number>();
  const warnings: string[] = [];
  const ignoredProductColumns: string[] = [];

  header.fields.forEach((name, idx) => {
    const col = columnForHeader(name);
    if (!col) {
      const trimmed = name.trim();
      if (trimmed === "") return;
      if (PRODUCT_REVIEW_COLUMNS.has(normalizeHeader(trimmed)))
        ignoredProductColumns.push(trimmed);
      else warnings.push(`Column "${trimmed}" is not used and was ignored.`);
      return;
    }
    if (columnIndex.has(col))
      warnings.push(
        `Column "${col}" appears more than once; the first one is used.`,
      );
    else columnIndex.set(col, idx);
  });
  if (ignoredProductColumns.length > 0) {
    warnings.push(
      `Ignored ${ignoredProductColumns.map((c) => `"${c}"`).join(", ")} — homepage testimonials are not tied to products, so no product identifier is needed.`,
    );
  }

  const fileErrors: string[] = [];
  for (const col of REQUIRED_COLUMNS) {
    if (!columnIndex.has(col)) {
      const aliases = HEADER_ALIASES[col]
        .slice(1)
        .map((a) => `"${a}"`)
        .join(", ");
      fileErrors.push(
        `Missing required column "${col}"${aliases ? ` (also accepted: ${aliases})` : ""}.`,
      );
    }
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
  if (records.length > TESTIMONIAL_IMPORT_LIMITS.maxRows) {
    return empty(
      [
        `The file has ${records.length} data rows; the limit is ${TESTIMONIAL_IMPORT_LIMITS.maxRows} per upload. Split it into smaller files.`,
      ],
      warnings,
    );
  }

  const cell = (rec: CsvRecord, col: Column): string => {
    const idx = columnIndex.get(col);
    return idx === undefined ? "" : (rec.fields[idx] ?? "");
  };

  // ── Rows ────────────────────────────────────────────────────────────
  const existingKeys = new Set(existingItems.map(testimonialKey));
  const seenKeys = new Map<string, number>();
  const rows: TestimonialRowResult[] = [];

  records.forEach((rec, idx) => {
    const row = idx + 2;
    const line = rec.line;
    const errors: string[] = [];

    const name = cleanText(cell(rec, "name"));
    const nameAr = cleanText(cell(rec, "nameAr"));
    const review = cleanText(cell(rec, "review"));
    const reviewAr = cleanText(cell(rec, "reviewAr"));
    const rawRating = cell(rec, "rating").trim();

    validateText("name", name, TESTIMONIAL_LIMITS.name, true, errors);
    validateText("nameAr", nameAr, TESTIMONIAL_LIMITS.name, false, errors);
    validateText("review", review, TESTIMONIAL_LIMITS.review, true, errors);
    validateText("reviewAr", reviewAr, TESTIMONIAL_LIMITS.review, false, errors);

    let rating = Number.NaN;
    if (rawRating.length === 0) errors.push("rating is required.");
    else if (!/^[1-5]$/.test(rawRating))
      errors.push(
        `rating must be a whole number from 1 to 5 (got "${rawRating}").`,
      );
    else rating = Number(rawRating);

    if (errors.length > 0) {
      rows.push({ row, line, status: "invalid", errors });
      return;
    }

    const item: TestimonialItem = {
      name,
      rating,
      review,
      ...(nameAr ? { nameAr } : {}),
      ...(reviewAr ? { reviewAr } : {}),
    };
    const key = testimonialKey(item);

    const earlier = seenKeys.get(key);
    if (earlier !== undefined) {
      rows.push({
        row,
        line,
        status: "duplicate",
        reason: "in-file",
        duplicateOfRow: earlier,
        item,
      });
      return;
    }
    seenKeys.set(key, row);
    if (existingKeys.has(key)) {
      rows.push({ row, line, status: "duplicate", reason: "already-published", item });
      return;
    }
    rows.push({ row, line, status: "valid", item });
  });

  const valid = rows.filter((r) => r.status === "valid").length;
  const afterImport = existing + valid;
  if (afterImport > TESTIMONIAL_IMPORT_LIMITS.maxTotalItems) {
    return empty(
      [
        `This import would leave ${afterImport} testimonials on the homepage; the limit is ${TESTIMONIAL_IMPORT_LIMITS.maxTotalItems}. Remove some existing testimonials or import fewer rows.`,
      ],
      warnings,
    );
  }

  return {
    fileErrors: [],
    warnings,
    rows,
    summary: {
      total: rows.length,
      valid,
      duplicate: rows.filter((r) => r.status === "duplicate").length,
      invalid: rows.filter((r) => r.status === "invalid").length,
      existing,
      afterImport,
    },
  };
}
