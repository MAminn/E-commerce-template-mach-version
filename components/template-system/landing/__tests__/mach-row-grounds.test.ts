import { describe, it, expect } from "vitest";
import {
  isAlternatingRowKey,
  resolveRowGrounds,
  type MachRowRenderState,
} from "../mach-row-grounds";
import { groupSectionKey } from "#root/shared/types/homepage-content";

const SUPPLEMENTS = groupSectionKey("01a06245-5bed-73ea-b81d-eebe1c7721a4");
const STACKS = groupSectionKey("01a06cc1-36ba-75cb-8353-5968a3889e70");
const GYM_GEAR = groupSectionKey("01a06cc1-55a5-759e-a04b-f25cdc6ad5ff");

const ALL_VISIBLE: MachRowRenderState = {
  [SUPPLEMENTS]: true,
  [STACKS]: true,
  newArrivals: true,
  featuredProducts: true,
  featuredShelf: true,
  [GYM_GEAR]: true,
};

const ORDER = [
  "heroMarquee",
  "categories",
  SUPPLEMENTS,
  STACKS,
  "newArrivals",
  "featuredProducts",
  GYM_GEAR,
  "discountedProducts",
  "footerCta",
];

describe("isAlternatingRowKey", () => {
  it("includes every broad group, whatever its category id", () => {
    expect(isAlternatingRowKey(SUPPLEMENTS)).toBe(true);
    expect(isAlternatingRowKey(groupSectionKey("a-group-added-today"))).toBe(
      true,
    );
  });

  it("includes the merchandising shelves that share the rhythm", () => {
    expect(isAlternatingRowKey("featuredProducts")).toBe(true);
    expect(isAlternatingRowKey("newArrivals")).toBe(true);
    expect(isAlternatingRowKey("featuredShelf")).toBe(true);
  });

  it("leaves Offers out of it — ink is its own anchor", () => {
    expect(isAlternatingRowKey("discountedProducts")).toBe(false);
  });

  it("ignores everything that is not a merchandising row", () => {
    expect(isAlternatingRowKey("heroMarquee")).toBe(false);
    expect(isAlternatingRowKey("categories")).toBe(false);
    expect(isAlternatingRowKey("campaign:campaign-primary")).toBe(false);
  });
});

describe("resolveRowGrounds", () => {
  it("alternates paper and white across the merchandising rows", () => {
    const grounds = resolveRowGrounds(ORDER, ALL_VISIBLE);

    expect(grounds.get(SUPPLEMENTS)).toBe("paper");
    expect(grounds.get(STACKS)).toBe("white");
    expect(grounds.get("newArrivals")).toBe("paper");
    expect(grounds.get("featuredProducts")).toBe("white");
    expect(grounds.get(GYM_GEAR)).toBe("paper");
  });

  it("does not let a hidden row consume an alternation slot", () => {
    // The regression: a row that renders nothing must not take a turn in the
    // rhythm, or the two visible rows around it get the same ground.
    const grounds = resolveRowGrounds(ORDER, {
      ...ALL_VISIBLE,
      [STACKS]: false,
    });

    expect(grounds.has(STACKS)).toBe(false);
    expect(grounds.get(SUPPLEMENTS)).toBe("paper");
    expect(grounds.get("newArrivals")).toBe("white");
    expect(grounds.get("featuredProducts")).toBe("paper");
  });

  it("gives a group that is off, new or empty no ground at all", () => {
    // All three states arrive here the same way — `false` from the one
    // predicate the render branch uses — so one assertion covers them.
    const grounds = resolveRowGrounds(ORDER, {
      ...ALL_VISIBLE,
      [SUPPLEMENTS]: false,
      [GYM_GEAR]: false,
    });

    expect(grounds.has(SUPPLEMENTS)).toBe(false);
    expect(grounds.has(GYM_GEAR)).toBe(false);
    expect(grounds.get(STACKS)).toBe("paper");
  });

  it("keeps two visible rows separated by a hidden group alternating", () => {
    const grounds = resolveRowGrounds(
      ["featuredProducts", SUPPLEMENTS, "newArrivals"],
      { ...ALL_VISIBLE, [SUPPLEMENTS]: false },
    );

    expect(grounds.get("featuredProducts")).toBe("paper");
    expect(grounds.get("newArrivals")).toBe("white");
    expect(grounds.get("featuredProducts")).not.toBe(grounds.get("newArrivals"));
  });

  it("keeps Featured in the rhythm alongside Best Sellers and New Drops", () => {
    const grounds = resolveRowGrounds(
      ["featuredProducts", "newArrivals", "featuredShelf"],
      ALL_VISIBLE,
    );

    expect(grounds.get("featuredProducts")).toBe("paper");
    expect(grounds.get("newArrivals")).toBe("white");
    expect(grounds.get("featuredShelf")).toBe("paper");
  });

  it("follows the client's order rather than a fixed per-section ground", () => {
    const moved = resolveRowGrounds(
      [GYM_GEAR, "featuredProducts", "newArrivals", STACKS],
      ALL_VISIBLE,
    );

    expect(moved.get(GYM_GEAR)).toBe("paper");
    expect(moved.get(STACKS)).toBe("white");
  });

  it("ignores rows that are not part of the rhythm", () => {
    const grounds = resolveRowGrounds(ORDER, ALL_VISIBLE);

    expect(grounds.has("heroMarquee")).toBe(false);
    expect(grounds.has("categories")).toBe(false);
    // Offers keeps its ink whatever it lands next to.
    expect(grounds.has("discountedProducts")).toBe(false);
  });

  it("gives a group the same ground its position earns, not its identity", () => {
    // A group added later is not special: it takes the turn its place gives
    // it, exactly like every row that was already there.
    const added = groupSectionKey("added-today");
    const grounds = resolveRowGrounds(
      ["featuredProducts", added, "newArrivals"],
      { ...ALL_VISIBLE, [added]: true },
    );

    expect(grounds.get(added)).toBe("white");
    expect(grounds.get("newArrivals")).toBe("paper");
  });
});
