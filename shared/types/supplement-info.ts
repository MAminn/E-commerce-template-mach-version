/**
 * Supplement label data for a product.
 *
 * Persisted as the `product.supplement_info` JSONB column, so new optional
 * keys can be added here without a database migration. Every field is
 * optional: legacy (perfume-era) products carry none and require no backfill.
 */

/** One row of the Supplement Facts panel. */
export interface SupplementFactRow {
  /** Nutrient name — free text, never a fixed enum. */
  label: string;
  /** e.g. "120", "24 g", "120 mg". Optional: Calories has no unit. */
  amount?: string;
  /** e.g. "5%". Optional: many rows legitimately carry no %DV. */
  dailyValue?: string;
  /** Sub-nutrient nested under the row above it (e.g. Dietary Fiber). */
  indent?: boolean;
}

export interface SupplementInfo {
  /**
   * Short heading for the product-details section, distinct from the full
   * commerce product name. e.g. name "Mach Whey Blend - Vanilla - 30 Serve"
   * with detailsHeading "Whey Protein Blend".
   */
  detailsHeading?: string;
  netWeight?: string;
  servingSize?: string;
  servingsPerContainer?: string;
  ingredients?: string;
  directions?: string;
  warnings?: string;
  longDescription?: string;
  badges?: string[];
  supplementFacts?: SupplementFactRow[];
  /**
   * Manually curated "related products", in the admin's chosen order.
   * Stores product IDs only — name/price/image are always resolved live from
   * the referenced products, never duplicated here. Empty/unset falls back to
   * same-category products.
   */
  relatedProductIds?: string[];
}
