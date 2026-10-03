import { useCallback, useMemo, useRef, useState } from "react";
import { useCart } from "#root/lib/context/CartContext";
import { pickUpsells } from "#root/shared/upsell/select";
import type { FeaturedProduct } from "../../home/HomeFeaturedProducts";
import type { PostAddMainItem, ProductUpsells } from "./types";

/**
 * Turns one server-resolved upsell pool into what a product page shows.
 *
 * Stability is the point of this hook:
 *
 *  - The product-page block is chosen once, when the pool arrives, against the
 *    bag as it was then. Adding one of those items afterwards marks it
 *    "Added" in place; it does not vanish and pull a new product up under the
 *    shopper's thumb.
 *  - The post-add sheet is chosen once per main add-to-cart, at that moment,
 *    against the bag *including* anything just taken from the block — so an
 *    upsell the shopper already added is never offered again, and the next one
 *    in the server's order takes its place.
 *  - Nothing reopens the sheet except `openAfterAdd`, which only the main
 *    product's successful add calls. Other cart changes cannot trigger it.
 */
export function useProductUpsells(upsells: ProductUpsells | undefined) {
  const { items } = useCart();

  // Read at decision time, never a dependency: the bag changing must not
  // recompute (and reshuffle) what is already on screen.
  const cartIds = useRef<string[]>([]);
  cartIds.current = items.map((i) => i.id);

  const blockItems = useMemo<FeaturedProduct[]>(
    () =>
      upsells?.productPage
        ? pickUpsells(upsells.items, cartIds.current, upsells.limit)
        : [],
    [upsells],
  );

  const [sheet, setSheet] = useState<{
    main: PostAddMainItem;
    items: FeaturedProduct[];
  } | null>(null);

  /**
   * Call only after the main product was accepted by the cart. Returns true
   * when the sheet opened; false means there was nothing worth showing and
   * the caller should confirm the add the usual way instead.
   */
  const openAfterAdd = useCallback(
    (main: PostAddMainItem): boolean => {
      if (!upsells?.postAdd) return false;
      const picks = pickUpsells(
        upsells.items,
        [...cartIds.current, main.id],
        upsells.limit,
      );
      if (picks.length === 0) return false;
      setSheet({ main, items: picks });
      return true;
    },
    [upsells],
  );

  const closeSheet = useCallback(() => setSheet(null), []);

  return { blockItems, sheet, openAfterAdd, closeSheet };
}
