import { describe, expect, it } from "vitest";
import { LANDING_MAX_PRODUCTS } from "#root/shared/landing-page/config";
import {
  addProducts,
  moveProduct,
  removeProduct,
  replaceProduct,
} from "../product-list";

describe("Landing 2 product list operations", () => {
  it("moves a product up and down", () => {
    expect(moveProduct(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveProduct(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("ignores moves past either end", () => {
    expect(moveProduct(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveProduct(["a", "b"], 1, 2)).toEqual(["a", "b"]);
  });

  it("removes a product", () => {
    expect(removeProduct(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("replaces in place", () => {
    expect(replaceProduct(["a", "b", "c"], "b", "x")).toEqual(["a", "x", "c"]);
  });

  it("replacing with a product already listed moves it rather than duplicating it", () => {
    expect(replaceProduct(["a", "b", "c"], "a", "c")).toEqual(["c", "b"]);
  });

  it("adds at the end, skipping duplicates", () => {
    expect(addProducts(["a"], ["b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("stops at the product cap", () => {
    const full = Array.from({ length: LANDING_MAX_PRODUCTS - 1 }, (_, i) => `p${i}`);
    expect(addProducts(full, ["x", "y"])).toHaveLength(LANDING_MAX_PRODUCTS);
  });
});
