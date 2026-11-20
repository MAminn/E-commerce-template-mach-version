import { describe, expect, it } from "vitest";
import { applyServerPrices } from "../CartContext";

const line = (id: string, price: number, originalPrice?: number) => ({
  id,
  name: id,
  price,
  originalPrice,
  quantity: 1,
  selectedOptions: {},
});

describe("applyServerPrices (bag saved before a sale ended)", () => {
  it("replaces a stale sale price with the server's current price", () => {
    const items = [line("whey", 1400, 2700), line("bars", 480, 960)];
    const next = applyServerPrices(items, [
      { id: "whey", price: 2700, discountPrice: 2500 },
      { id: "bars", price: 960, discountPrice: null },
    ]);
    expect(next).toEqual([
      expect.objectContaining({ id: "whey", price: 2500, originalPrice: 2700 }),
      expect.objectContaining({ id: "bars", price: 960, originalPrice: undefined }),
    ]);
  });

  it("returns the same array when nothing changed (no needless re-render)", () => {
    const items = [line("whey", 1400, 2700)];
    expect(applyServerPrices(items, [{ id: "whey", price: 2700, discountPrice: 1400 }])).toBe(items);
  });

  it("leaves lines the server didn't return alone", () => {
    const items = [line("gone", 100)];
    expect(applyServerPrices(items, [])).toBe(items);
  });
});
