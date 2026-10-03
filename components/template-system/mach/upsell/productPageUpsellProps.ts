import type { FeaturedProduct } from "../../home/HomeFeaturedProducts";
import type { UpsellSource } from "#root/shared/upsell/select";
import type { ProductUpsells } from "./types";

/** The shape `upsell.forProduct` answers with (see backend/upsells/service.ts). */
export interface UpsellResponse {
  enabled: boolean;
  productPage: boolean;
  postAdd: boolean;
  limit: number;
  source: UpsellSource;
  items: FeaturedProduct[];
}

/**
 * Decides, from the resolver's answer, what the product page renders.
 *
 *  - Upsells ON  → the upsell block / post-add sheet, and no legacy add-ons
 *    strip (the same curated list is the manual upsell list, so drawing the
 *    strip as well would show it twice).
 *  - Upsells OFF, or the request failed (`null`) → no upsells at all, and the
 *    legacy add-ons strip exactly as before the feature existed.
 */
export function productPageUpsellProps(
  response: UpsellResponse | null,
  curatedAddOns: FeaturedProduct[],
): { upsells: ProductUpsells | undefined; crossSellProducts: FeaturedProduct[] } {
  if (!response?.enabled) {
    return { upsells: undefined, crossSellProducts: curatedAddOns };
  }
  return {
    upsells: {
      items: response.items,
      limit: response.limit,
      productPage: response.productPage,
      postAdd: response.postAdd,
      source: response.source,
    },
    crossSellProducts: [],
  };
}
