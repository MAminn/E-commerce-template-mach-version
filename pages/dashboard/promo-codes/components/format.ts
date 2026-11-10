import {
  FREE_SHIPPING_LABEL,
  type PromoDiscountType,
} from "#root/shared/promo-codes/discount-types";

/** The promo list's Discount column: "10%", "50 (fixed)" or "Free shipping". */
export function formatPromoDiscountCell(promo: {
  discountType: PromoDiscountType;
  discountValue: number;
}): string {
  if (promo.discountType === "free_shipping") return FREE_SHIPPING_LABEL;
  return promo.discountType === "percentage"
    ? `${promo.discountValue}%`
    : `${promo.discountValue} (fixed)`;
}
