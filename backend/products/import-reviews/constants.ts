/**
 * Browser-safe constants for the review CSV importer. This file must stay
 * free of Node/DB imports — the dashboard dialog imports it to render the
 * instructions and build the template.
 */

export const REVIEW_IMPORT_LIMITS = {
  /** Hard cap on the uploaded file. 2 MB is ~4,000 maximal-length reviews. */
  maxFileBytes: 2 * 1024 * 1024,
  /** Data rows per upload (header excluded). Split larger files. */
  maxRows: 2000,
} as const;

export const REVIEW_IMPORT_COLUMNS = [
  "productId",
  "productSlug",
  "userName",
  "rating",
  "comment",
  "createdAt",
] as const;

export const CREATED_AT_FORMAT_HINT =
  "Use YYYY-MM-DD (e.g. 2026-03-15) or YYYY-MM-DD HH:MM[:SS] with an optional timezone (e.g. 2026-03-15 14:30 or 2026-03-15T14:30:00+02:00). A date alone is stored as 12:00 UTC; a time without a timezone is treated as UTC.";
