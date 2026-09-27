/**
 * Single source of truth for how promo codes and automatic cart offers stack.
 * Used by both the client-side cart preview (CartContext) and the
 * server-side authoritative calculation (create-order/service.ts) — kept
 * here specifically so the two can't drift out of sync the way they did
 * before (promo discount was computed from the raw subtotal on both sides,
 * ignoring the automatic offer discount entirely).
 */

export type PromoDiscountType = "percentage" | "fixed_amount";

/**
 * A promo code's discount always applies to what's left *after* automatic
 * offer discounts, not the raw subtotal — so a 5% code doesn't overcharge
 * on top of e.g. a "Buy 2 Get 1" offer that's already reduced the total.
 */
export function computePromoDiscount(
  discountType: PromoDiscountType,
  discountValue: number,
  subtotal: number,
  offerDiscount: number,
): number {
  const base = Math.max(0, subtotal - offerDiscount);
  if (discountType === "percentage") {
    return base * (discountValue / 100);
  }
  return Math.min(discountValue, base);
}

/** A cart line as promo pricing sees it. `eligible` is decided server-side. */
export interface PromoPricingLine {
  price: number;
  quantity: number;
  eligible: boolean;
}

interface PromoPricingOffer extends FreeItemsOffer {
  discountAmount: number;
}

/**
 * The promo discount for a cart, counting only the lines the code applies to.
 *
 * A restricted code (products/categories) discounts the eligible lines'
 * subtotal, less the share of automatic-offer savings that landed on those
 * lines — never the whole cart. Offer savings are attributed per line:
 * free-item units by the exact unit the offer gives away (same pick as
 * computeFreeItemQuantities); percentage and fixed-amount offers in
 * proportion to line value (for a percentage offer that is exact).
 *
 * `lines` and `appliedOffers` must be the same cart, in the same order, that
 * was sent to offer evaluation. When every line is eligible this reduces to
 * computePromoDiscount(subtotal, total offer discount) — unchanged
 * whole-cart behaviour for codes that apply to all products.
 */
export function computeLinePromoDiscount(
  discountType: PromoDiscountType,
  discountValue: number,
  lines: readonly PromoPricingLine[],
  appliedOffers: readonly PromoPricingOffer[],
): { eligibleSubtotal: number; discount: number } {
  const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const offerDiscount = appliedOffers.reduce((s, o) => s + o.discountAmount, 0);

  if (lines.every((l) => l.eligible)) {
    return {
      eligibleSubtotal: subtotal,
      discount: computePromoDiscount(discountType, discountValue, subtotal, offerDiscount),
    };
  }

  const eligibleSubtotal = lines.reduce(
    (s, l) => (l.eligible ? s + l.price * l.quantity : s),
    0,
  );
  if (eligibleSubtotal <= 0) return { eligibleSubtotal: 0, discount: 0 };

  const freeByIndex = computeFreeItemQuantities(lines, appliedOffers);
  let eligibleOfferDiscount = lines.reduce(
    (s, l, i) => (l.eligible ? s + freeByIndex[i]! * l.price : s),
    0,
  );
  for (const offer of appliedOffers) {
    if (offer.reward.type === "free_items") continue;
    eligibleOfferDiscount += offer.discountAmount * (eligibleSubtotal / subtotal);
  }

  return {
    eligibleSubtotal,
    discount: computePromoDiscount(
      discountType,
      discountValue,
      eligibleSubtotal,
      eligibleOfferDiscount,
    ),
  };
}

/**
 * Shipping is derived fresh from current offer state rather than toggled
 * imperatively — that's what caused it to get stuck at 0 after a
 * free-shipping offer stopped applying (e.g. removing a cart item that had
 * pushed the total over a free-shipping threshold).
 */
export function deriveEffectiveShipping(
  baseShippingFee: number,
  appliedOffers: readonly { freeShipping: boolean }[],
): number {
  return appliedOffers.some((o) => o.freeShipping) ? 0 : baseShippingFee;
}

interface FreeQuantityCartItem {
  price: number;
  quantity: number;
}

interface FreeItemsOffer {
  reward: {
    type: string;
    quantity?: number;
    which?: "cheapest" | "most_expensive";
  };
}

/**
 * Mirrors backend/offers/service.ts's computeDiscount "free_items" case, but
 * tracks WHICH cart line each free unit lands on (by array index) instead of
 * just a flat discount total — lets the cart/checkout UI show a "FREE" badge
 * on the exact item(s) an offer gave away. Must be called with the same
 * items array (same order) that was sent to the offer-evaluation endpoint,
 * so index positions line up.
 */
export function computeFreeItemQuantities(
  items: readonly FreeQuantityCartItem[],
  appliedOffers: readonly FreeItemsOffer[],
): number[] {
  const freeByIndex = new Array(items.length).fill(0) as number[];

  for (const offer of appliedOffers) {
    if (offer.reward.type !== "free_items") continue;
    const quantity = offer.reward.quantity ?? 0;
    const which = offer.reward.which ?? "cheapest";

    const units: { index: number; price: number }[] = [];
    items.forEach((item, index) => {
      for (let i = 0; i < item.quantity; i++) {
        units.push({ index, price: item.price });
      }
    });

    units.sort((a, b) =>
      which === "cheapest" ? a.price - b.price : b.price - a.price,
    );

    for (const unit of units.slice(0, quantity)) {
      freeByIndex[unit.index]! += 1;
    }
  }

  return freeByIndex;
}
