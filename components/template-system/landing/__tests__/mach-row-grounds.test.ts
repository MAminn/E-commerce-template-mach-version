import { describe, it, expect } from "vitest";
import {
  resolveRowGrounds,
  type MachRowRenderState,
} from "../mach-row-grounds";

const ALL_VISIBLE: MachRowRenderState = {
  stacks: true,
  newArrivals: true,
  featuredProducts: true,
  gymGear: true,
};

const ORDER = [
  "heroMarquee",
  "categories",
  "stacks",
  "newArrivals",
  "featuredProducts",
  "gymGear",
  "discountedProducts",
  "footerCta",
];

describe("resolveRowGrounds", () => {
  it("alternates paper and white across the merchandising rows", () => {
    const grounds = resolveRowGrounds(ORDER, ALL_VISIBLE);

    expect(grounds.get("stacks")).toBe("paper");
    expect(grounds.get("newArrivals")).toBe("white");
    expect(grounds.get("featuredProducts")).toBe("paper");
    expect(grounds.get("gymGear")).toBe("white");
  });

  it("does not let a hidden row consume an alternation slot", () => {
    // The regression: Stacks sits between two visible rows but renders
    // nothing, so it must not take a turn in the rhythm.
    const grounds = resolveRowGrounds(ORDER, {
      ...ALL_VISIBLE,
      newArrivals: false,
    });

    expect(grounds.has("newArrivals")).toBe(false);
    expect(grounds.get("stacks")).toBe("paper");
    expect(grounds.get("featuredProducts")).toBe("white");
    expect(grounds.get("gymGear")).toBe("paper");
  });

  it("keeps two visible rows separated by a hidden one alternating", () => {
    const grounds = resolveRowGrounds(
      ["featuredProducts", "stacks", "newArrivals"],
      { ...ALL_VISIBLE, stacks: false },
    );

    expect(grounds.get("featuredProducts")).toBe("paper");
    expect(grounds.get("newArrivals")).toBe("white");
    expect(grounds.get("featuredProducts")).not.toBe(grounds.get("newArrivals"));
  });

  it("follows the client's order rather than a fixed per-section ground", () => {
    const moved = resolveRowGrounds(
      ["gymGear", "featuredProducts", "newArrivals", "stacks"],
      ALL_VISIBLE,
    );

    expect(moved.get("gymGear")).toBe("paper");
    expect(moved.get("stacks")).toBe("white");
  });

  it("ignores rows that are not part of the rhythm", () => {
    const grounds = resolveRowGrounds(ORDER, ALL_VISIBLE);

    expect(grounds.has("discountedProducts")).toBe(false);
    expect(grounds.has("categories")).toBe(false);
    expect(grounds.has("heroMarquee")).toBe(false);
  });

  it("assigns nothing when no merchandising row renders", () => {
    expect(
      resolveRowGrounds(ORDER, {
        stacks: false,
        newArrivals: false,
        featuredProducts: false,
        gymGear: false,
      }).size,
    ).toBe(0);
  });
});
