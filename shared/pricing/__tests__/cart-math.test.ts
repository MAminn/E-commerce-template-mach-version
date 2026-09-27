import { describe, expect, it } from "vitest";
import {
  computeLinePromoDiscount,
  computePromoDiscount,
  deriveEffectiveShipping,
} from "../cart-math";

describe("computePromoDiscount", () => {
  it("applies a percentage discount to the raw subtotal when no offer discount is active", () => {
    expect(computePromoDiscount("percentage", 5, 1950, 0)).toBeCloseTo(97.5);
  });

  it("applies a percentage discount to the subtotal AFTER offer discount, not the raw subtotal (regression: was stacking on raw subtotal)", () => {
    // Matches the client's reported case: 1950 subtotal, 650 offer savings,
    // 5% promo code — the 5% must land on 1300, not 1950.
    expect(computePromoDiscount("percentage", 5, 1950, 650)).toBeCloseTo(65);
    expect(computePromoDiscount("percentage", 5, 1950, 650)).not.toBeCloseTo(97.5);
  });

  it("applies a fixed-amount discount capped at the post-offer subtotal, not the raw one", () => {
    expect(computePromoDiscount("fixed_amount", 100, 1950, 650)).toBe(100);
    // Fixed discount larger than what's left after the offer discount should
    // cap at what's left, not at the raw subtotal.
    expect(computePromoDiscount("fixed_amount", 2000, 1950, 650)).toBe(1300);
  });

  it("never goes negative when the offer discount alone exceeds the subtotal", () => {
    expect(computePromoDiscount("percentage", 10, 100, 500)).toBe(0);
    expect(computePromoDiscount("fixed_amount", 50, 100, 500)).toBe(0);
  });
});

describe("deriveEffectiveShipping", () => {
  const baseFee = 80;

  it("returns the base shipping fee when no offer grants free shipping", () => {
    expect(deriveEffectiveShipping(baseFee, [])).toBe(baseFee);
    expect(deriveEffectiveShipping(baseFee, [{ freeShipping: false }])).toBe(baseFee);
  });

  it("returns 0 when an applied offer grants free shipping", () => {
    expect(deriveEffectiveShipping(baseFee, [{ freeShipping: true }])).toBe(0);
  });

  it("restores the base fee once the free-shipping offer no longer applies (regression: client's add/remove-item scenario)", () => {
    // 3 items — below whatever threshold the offer needs — no free shipping.
    let applied: { freeShipping: boolean }[] = [];
    expect(deriveEffectiveShipping(baseFee, applied)).toBe(baseFee);

    // 4th item added — threshold met, free shipping kicks in.
    applied = [{ freeShipping: true }];
    expect(deriveEffectiveShipping(baseFee, applied)).toBe(0);

    // Minus button pressed back down to 3 items — this is exactly the step
    // that used to stay stuck at 0 because shipping was toggled with a
    // one-way `setShipping(0)` and nothing ever set it back.
    applied = [];
    expect(deriveEffectiveShipping(baseFee, applied)).toBe(baseFee);
  });

  it("stays free across multiple re-evaluations while still above threshold", () => {
    const applied = [{ freeShipping: true }];
    expect(deriveEffectiveShipping(baseFee, applied)).toBe(0);
    expect(deriveEffectiveShipping(baseFee, applied)).toBe(0);
  });
});

describe("computeLinePromoDiscount — which lines a promo code discounts", () => {
  // Mirrors the Mach case: AGIZA20 (20%) restricted to one category.
  const straps = (quantity = 1) => ({ price: 399, quantity, eligible: true });
  const creatine = (quantity = 1) => ({ price: 600, quantity, eligible: false });

  describe("codes that apply to all products (unchanged behaviour)", () => {
    const all = [
      { price: 399, quantity: 1, eligible: true },
      { price: 600, quantity: 2, eligible: true },
    ];

    it("percentage discounts the whole cart", () => {
      const r = computeLinePromoDiscount("percentage", 20, all, []);
      expect(r.eligibleSubtotal).toBe(1599);
      expect(r.discount).toBeCloseTo(319.8);
    });

    it("fixed amount discounts the whole cart", () => {
      expect(computeLinePromoDiscount("fixed_amount", 1000, all, []).discount).toBe(1000);
      expect(computeLinePromoDiscount("fixed_amount", 5000, all, []).discount).toBe(1599);
    });

    it("is exactly computePromoDiscount(subtotal, total offer discount), offers included", () => {
      const offers = [
        { discountAmount: 150, reward: { type: "fixed_off" } },
        { discountAmount: 399, reward: { type: "free_items", quantity: 1, which: "cheapest" as const } },
      ];
      for (const [type, value] of [["percentage", 20], ["fixed_amount", 300]] as const) {
        expect(computeLinePromoDiscount(type, value, all, offers).discount).toBe(
          computePromoDiscount(type, value, 1599, 549),
        );
      }
    });
  });

  describe("restricted codes", () => {
    it("eligible item only: discounts that item", () => {
      const r = computeLinePromoDiscount("percentage", 20, [straps()], []);
      expect(r.eligibleSubtotal).toBe(399);
      expect(r.discount).toBeCloseTo(79.8);
    });

    it("ineligible item only: nothing to discount", () => {
      const r = computeLinePromoDiscount("percentage", 20, [creatine()], []);
      expect(r).toEqual({ eligibleSubtotal: 0, discount: 0 });
      expect(computeLinePromoDiscount("fixed_amount", 100, [creatine()], []).discount).toBe(0);
    });

    it("mixed cart: only the eligible subtotal is discounted (regression: was the whole 999)", () => {
      const r = computeLinePromoDiscount("percentage", 20, [straps(), creatine()], []);
      expect(r.eligibleSubtotal).toBe(399);
      expect(r.discount).toBeCloseTo(79.8);
      expect(r.discount).not.toBeCloseTo(199.8);
    });

    it("fixed discount larger than the eligible subtotal is capped at it", () => {
      const r = computeLinePromoDiscount("fixed_amount", 500, [straps(), creatine()], []);
      expect(r.discount).toBe(399);
    });

    it("fixed discount smaller than the eligible subtotal is taken in full", () => {
      expect(
        computeLinePromoDiscount("fixed_amount", 100, [straps(), creatine()], []).discount,
      ).toBe(100);
    });

    it("recalculates when quantities change", () => {
      expect(
        computeLinePromoDiscount("percentage", 20, [straps(2), creatine(3)], []).discount,
      ).toBeCloseTo(159.6);
      expect(
        computeLinePromoDiscount("percentage", 20, [straps(1), creatine(3)], []).discount,
      ).toBeCloseTo(79.8);
      // More of the ineligible item changes nothing.
      expect(
        computeLinePromoDiscount("percentage", 20, [straps(1), creatine(9)], []).discount,
      ).toBeCloseTo(79.8);
    });
  });

  describe("restricted codes with automatic offers (promo applies after offers)", () => {
    const cart = [straps(), creatine()]; // 399 eligible + 600 ineligible = 999

    it("percentage offer: eligible lines keep exactly their own share of it", () => {
      // 10% off the cart = 99.90, of which 39.90 was on the eligible line.
      const offers = [{ discountAmount: 99.9, reward: { type: "percentage_off" } }];
      const r = computeLinePromoDiscount("percentage", 20, cart, offers);
      expect(r.discount).toBeCloseTo((399 - 39.9) * 0.2);
    });

    it("fixed offer: attributed to lines in proportion to their value", () => {
      const offers = [{ discountAmount: 100, reward: { type: "fixed_off" } }];
      const r = computeLinePromoDiscount("percentage", 20, cart, offers);
      expect(r.discount).toBeCloseTo((399 - 100 * (399 / 999)) * 0.2);
    });

    it("free-item offer on an ineligible unit leaves the eligible base alone", () => {
      const offers = [
        { discountAmount: 600, reward: { type: "free_items", quantity: 1, which: "most_expensive" as const } },
      ];
      expect(computeLinePromoDiscount("percentage", 20, cart, offers).discount).toBeCloseTo(79.8);
    });

    it("free-item offer on an eligible unit comes off the eligible base", () => {
      const offers = [
        { discountAmount: 399, reward: { type: "free_items", quantity: 1, which: "cheapest" as const } },
      ];
      const twoStraps = [straps(2), creatine()];
      expect(computeLinePromoDiscount("percentage", 20, twoStraps, offers).discount).toBeCloseTo(79.8);
    });

    it("free shipping does not change the promo base", () => {
      const offers = [{ discountAmount: 0, reward: { type: "free_shipping" } }];
      expect(computeLinePromoDiscount("percentage", 20, cart, offers).discount).toBeCloseTo(79.8);
    });

    it("never goes negative when offers exceed the eligible lines", () => {
      const offers = [
        { discountAmount: 399, reward: { type: "free_items", quantity: 1, which: "cheapest" as const } },
      ];
      expect(computeLinePromoDiscount("fixed_amount", 50, cart, offers).discount).toBe(0);
    });
  });
});
