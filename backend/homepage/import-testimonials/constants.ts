/**
 * Browser-safe constants for the homepage-testimonials CSV importer. No
 * Node/DB imports — the dashboard dialog imports this for its instructions
 * and template.
 */

/** Matches the `testimonials.items[]` entry in shared/types/homepage-content. */
export interface TestimonialItem {
  name: string;
  nameAr?: string;
  rating: number;
  review: string;
  reviewAr?: string;
}

export const TESTIMONIAL_CSV_COLUMNS = [
  "name",
  "rating",
  "review",
  "nameAr",
  "reviewAr",
] as const;

export const TESTIMONIAL_LIMITS = {
  name: { min: 2, max: 80 },
  review: { min: 3, max: 600 },
} as const;

export const TESTIMONIAL_IMPORT_LIMITS = {
  /** Hard cap on the uploaded file. */
  maxFileBytes: 1024 * 1024,
  /** Data rows per upload (header excluded). */
  maxRows: 300,
  /** Testimonials the homepage section may hold in total — it is one JSON
   * blob rendered on every landing-page load, not a paginated list. */
  maxTotalItems: 300,
} as const;
