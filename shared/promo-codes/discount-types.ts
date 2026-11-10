/**
 * Promo code discount types. Who may manage promo codes is unchanged: the
 * promo routes stay admin/superadmin only (adminProcedure), for every type.
 *
 * `free_shipping` takes nothing off product prices: it sets the shopper's
 * shipping charge to 0 when the code is valid for the cart. It never changes
 * the shipment itself — the order is still dispatched to the courier, and the
 * courier's own fee to the store is untouched (Bosta collects `order.total`,
 * which simply no longer includes shipping).
 *
 * Kept free of server imports so the dashboard, the storefront and the
 * backend all read the same rules.
 */

export const PROMO_DISCOUNT_TYPES = [
  "percentage",
  "fixed_amount",
  "free_shipping",
] as const;

export type PromoDiscountType = (typeof PROMO_DISCOUNT_TYPES)[number];

export const FREE_SHIPPING_LABEL = "Free shipping";

export function isFreeShippingPromo(
  discountType: string | null | undefined,
): discountType is "free_shipping" {
  return discountType === "free_shipping";
}

/**
 * Whether the type carries a monetary/percentage value. Free shipping does
 * not: its stored `discount_value` is always 0.
 */
export function promoTypeHasValue(discountType: PromoDiscountType): boolean {
  return !isFreeShippingPromo(discountType);
}

/** "10% off" / "50.00 EGP off" / "Free shipping" — the storefront's wording. */
export function describePromoDiscount(
  discountType: PromoDiscountType,
  discountValue: number,
  currency = "EGP",
): string {
  if (discountType === "percentage") return `${discountValue}% off`;
  if (discountType === "fixed_amount") {
    return `${discountValue.toFixed(2)} ${currency} off`;
  }
  return FREE_SHIPPING_LABEL;
}

