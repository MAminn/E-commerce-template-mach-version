import type { FeaturedProduct } from "../../home/HomeFeaturedProducts";
import type { UpsellSource } from "#root/shared/upsell/select";

/**
 * One product page's upsell answer, as resolved by the server
 * (`upsell.forProduct`). Both the product-page block and the post-add sheet
 * draw from this one object — neither surface decides eligibility itself.
 */
export interface ProductUpsells {
  /** Server-ordered pool; may hold more than `limit` as replacements. */
  items: FeaturedProduct[];
  /** How many each surface shows. */
  limit: number;
  productPage: boolean;
  postAdd: boolean;
  source: UpsellSource;
}

/** What the post-add sheet repeats back about the product just added. */
export interface PostAddMainItem {
  id: string;
  name: string;
  /** Unit price actually charged. */
  price: number;
  quantity: number;
  imageUrl?: string | null;
  selectedOptions?: Record<string, string>;
}
