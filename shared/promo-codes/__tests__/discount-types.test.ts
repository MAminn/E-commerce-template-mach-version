import { describe, expect, it } from "vitest";
import {
  PROMO_DISCOUNT_TYPES,
  describePromoDiscount,
  isFreeShippingPromo,
  promoTypeHasValue,
} from "../discount-types";

describe("promo discount types", () => {
  it("adds free_shipping next to the existing types", () => {
    expect(PROMO_DISCOUNT_TYPES).toEqual(["percentage", "fixed_amount", "free_shipping"]);
  });

  it("labels each type the way the storefront shows it", () => {
    expect(describePromoDiscount("percentage", 10)).toBe("10% off");
    expect(describePromoDiscount("fixed_amount", 50)).toBe("50.00 EGP off");
    expect(describePromoDiscount("free_shipping", 0)).toBe("Free shipping");
  });

  it("only free shipping goes without a discount value", () => {
    expect(promoTypeHasValue("percentage")).toBe(true);
    expect(promoTypeHasValue("fixed_amount")).toBe(true);
    expect(promoTypeHasValue("free_shipping")).toBe(false);
    expect(isFreeShippingPromo("free_shipping")).toBe(true);
    expect(isFreeShippingPromo("percentage")).toBe(false);
    expect(isFreeShippingPromo(undefined)).toBe(false);
  });
});
