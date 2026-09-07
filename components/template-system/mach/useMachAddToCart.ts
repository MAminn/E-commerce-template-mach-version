import { useCallback, useEffect, useRef, useState } from "react";
import { useCart } from "#root/lib/context/CartContext";
import { useTracking } from "#root/frontend/contexts/TrackingContext";
import { trackAddToCartEvent } from "#root/frontend/tracking/add-to-cart-event";
import { showMachCartToast } from "./MachCartFeedback";

/**
 * The single add-to-cart path for the Mach storefront.
 *
 * There is no second cart here: this calls the same `CartContext.addItem`
 * every other surface calls, so stock checks, line merging by selected
 * options, offer re-evaluation and pricing are the existing system's, not a
 * parallel implementation. What it adds is the two things every Mach surface
 * needs to do identically — fire the existing add-to-cart tracking event, and
 * produce Mach's confirmation feedback (a button that confirms in place plus
 * the monochrome toast) instead of the inherited amber cart bar.
 *
 * `confirmed` is the button's own state, cleared after a short beat. Consumers
 * render it as "Added"; the navbar bag count updates on its own from context.
 */

const CONFIRM_MS = 1600;

export interface MachAddToCartInput {
  id: string;
  name: string;
  /** Unit price to charge — pass the discounted price where one applies. */
  price: number;
  /** Undiscounted price, so the cart can strike it through. */
  originalPrice?: number;
  stock: number;
  available?: boolean;
  imageUrl?: string | null;
  categoryName?: string | null;
  quantity?: number;
  /** Chosen variant values. `{}` only for products with no option groups. */
  selectedOptions?: Record<string, string>;
}

export function useMachAddToCart() {
  const { addItem } = useCart();
  const { trackEvent } = useTracking();
  const [confirmed, setConfirmed] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const add = useCallback(
    (input: MachAddToCartInput): boolean => {
      const quantity = Math.max(1, Math.floor(input.quantity ?? 1));

      // `addItem` is the stock gate: it returns false when the request cannot
      // be satisfied, and this never works around that.
      const ok = addItem(
        {
          id: input.id,
          name: input.name,
          price: input.price,
          originalPrice: input.originalPrice,
          stock: input.stock,
          available: input.available,
          imageUrl: input.imageUrl ?? undefined,
          categoryName: input.categoryName ?? undefined,
        },
        quantity,
        input.selectedOptions ?? {},
      );

      if (!ok) return false;

      trackAddToCartEvent(trackEvent, {
        id: input.id,
        name: input.name,
        price: input.price,
        quantity,
        categoryName: input.categoryName,
      });

      showMachCartToast({
        name: input.name,
        price: input.price,
        quantity,
        imageUrl: input.imageUrl,
      });

      setConfirmed(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setConfirmed(false), CONFIRM_MS);

      return true;
    },
    [addItem, trackEvent],
  );

  return { add, confirmed };
}
