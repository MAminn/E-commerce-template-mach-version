import { describe, expect, it } from "vitest";
import {
  computeLinePromoDiscount,
  computePromoDiscount,
  deriveEffectiveShipping,
} from "../cart-math";

/**
 * Free Shipping codes in the shared cart math (used by the cart preview and
 * by order creation): no product discount, ever; shipping 0 only when the
 * caller says the code was validated.
 */

describe("free shipping promo — product discount", () => {
  it("takes nothing off products, whatever value is stored", () => {
    expect(computePromoDiscount("free_shipping", 0, 1000, 0)).toBe(0);
    expect(computePromoDiscount("free_shipping", 50, 1000, 100)).toBe(0);
  });

  it("takes nothing off restricted or mixed carts either", () => {
    const lines = [
      { price: 300, quantity: 1, eligible: true },
      { price: 500, quantity: 2, eligible: false },
    ];
    expect(computeLinePromoDiscount("free_shipping", 0, lines, [])).toEqual({
      eligibleSubtotal: 300,
      discount: 0,
    });
    expect(
      computeLinePromoDiscount("free_shipping", 0, lines.map((l) => ({ ...l, eligible: true })), []),
    ).toEqual({ eligibleSubtotal: 1300, discount: 0 });
  });

  it("leaves percentage and fixed codes exactly as they were", () => {
    expect(computePromoDiscount("percentage", 10, 1000, 100)).toBe(90);
    expect(computePromoDiscount("fixed_amount", 50, 1000, 0)).toBe(50);
    expect(computePromoDiscount("fixed_amount", 5000, 1000, 0)).toBe(1000);
  });
});

describe("free shipping promo — shipping charge", () => {
  it("charges the store fee when nothing makes shipping free", () => {
    expect(deriveEffectiveShipping(85, [])).toBe(85);
    expect(deriveEffectiveShipping(85, [], false)).toBe(85);
  });

  it("charges 0 for a validated free-shipping code", () => {
    expect(deriveEffectiveShipping(85, [], true)).toBe(0);
  });

  it("charges 0 for a free-shipping offer, with or without the code (never negative)", () => {
    expect(deriveEffectiveShipping(85, [{ freeShipping: true }])).toBe(0);
    expect(deriveEffectiveShipping(85, [{ freeShipping: true }], true)).toBe(0);
    expect(deriveEffectiveShipping(85, [{ freeShipping: false }], false)).toBe(85);
  });
});
