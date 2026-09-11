import { describe, it, expect } from "vitest";
import {
  DEFAULT_PRODUCT_SECTION_DISPLAY_MODE,
  resolveProductSectionDisplayMode,
  resolveSectionOrder,
  type HomepageContent,
  type ProductSectionDisplayMode,
} from "../homepage-content";
import {
  normalizeGroupSections,
  resolveGroupSections,
} from "../homepage-group-sections";
import { describeSectionRows } from "../homepage-section-rows";

/**
 * Grid or carousel, as a property of saved content.
 *
 * The rule this whole feature stands on is that the display mode changes how a
 * section is arranged and *nothing else* — not which products it shows, not
 * their order, not its identity in Section Order, and not what a section that
 * predates the field looks like. All four of those are decided by pure
 * functions, so they are asserted here rather than read off a browser.
 */

const SUPPLEMENTS = "01a06cc1-1111-75cb-8353-5968a3889e70";
const STACKS = "01a06cc1-36ba-75cb-8353-5968a3889e70";
const GYM_GEAR = "01a06cc1-55a5-759e-a04b-f25cdc6ad5ff";

const GROUPS = [
  { id: SUPPLEMENTS, name: "Supplements", slug: "supplements" },
  { id: STACKS, name: "Stacks & Bundles", slug: "stacks-bundles" },
  { id: GYM_GEAR, name: "Gym Gear", slug: "gym-gear" },
];

/** A merchandising shelf as it was saved before display modes existed. */
function legacyShelf(productIds: string[]) {
  return {
    enabled: true,
    title: "BEST SELLERS",
    subtitle: "",
    viewAllText: "VIEW ALL",
    viewAllLink: "/shop",
    productIds,
  };
}

/* ------------------------------------------------------------------ */
/*  Default / compatibility                                           */
/* ------------------------------------------------------------------ */

describe("resolveProductSectionDisplayMode", () => {
  it("defaults to the grid", () => {
    expect(DEFAULT_PRODUCT_SECTION_DISPLAY_MODE).toBe("grid");
  });

  it("reads a missing mode as the grid", () => {
    // Every section saved before this field existed. None of them may change
    // appearance because the field was deployed.
    expect(resolveProductSectionDisplayMode(undefined)).toBe("grid");
  });

  it("reads a cleared mode as the grid", () => {
    // The CMS sends `null` for optional fields it has cleared.
    expect(resolveProductSectionDisplayMode(null)).toBe("grid");
  });

  it("keeps an explicit choice", () => {
    expect(resolveProductSectionDisplayMode("grid")).toBe("grid");
    expect(resolveProductSectionDisplayMode("carousel")).toBe("carousel");
  });

  it("falls back to the grid for a value it does not recognise", () => {
    expect(
      resolveProductSectionDisplayMode(
        "slider" as unknown as ProductSectionDisplayMode,
      ),
    ).toBe("grid");
  });
});

describe("existing content", () => {
  it("resolves an old merchandising shelf to the grid", () => {
    const shelf = legacyShelf(["p-1", "p-2"]);
    expect("displayMode" in shelf).toBe(false);
    expect(resolveProductSectionDisplayMode(undefined)).toBe("grid");
  });

  it("resolves an old group section to the grid", () => {
    const [supplements] = resolveGroupSections(
      {
        groupSections: [
          // Saved before the field existed: no `displayMode` key at all.
          { categoryId: SUPPLEMENTS, enabled: true, presentation: "shelf" },
        ],
      },
      [GROUPS[0]!],
    );

    expect(supplements!.displayMode).toBe("grid");
  });

  it("resolves a legacy Stacks row to the grid", () => {
    const [stacks] = resolveGroupSections(
      {
        stacks: {
          enabled: true,
          title: "STACKS & BUNDLES",
          viewAllText: "VIEW ALL",
          viewAllLink: "/shop",
          categoryIds: [STACKS],
        },
      },
      [GROUPS[1]!],
    );

    expect(stacks!.displayMode).toBe("grid");
    // …and keeps the feature treatment the row shipped with.
    expect(stacks!.presentation).toBe("feature");
  });

  it("gives a group nobody has configured the grid", () => {
    // A category opened in Dashboard → Categories this morning.
    const [group] = resolveGroupSections({}, [
      { id: "new-group", name: "Recovery", slug: "recovery" },
    ]);

    expect(group!.displayMode).toBe("grid");
  });
});

/* ------------------------------------------------------------------ */
/*  Merchandising                                                     */
/* ------------------------------------------------------------------ */

describe("merchandising sections", () => {
  const SHELVES = [
    "featuredProducts",
    "newArrivals",
    "featuredShelf",
    "discountedProducts",
  ] as const;

  for (const key of SHELVES) {
    for (const mode of ["grid", "carousel"] as const) {
      it(`${key} supports ${mode}`, () => {
        const content = {
          [key]: { ...legacyShelf(["p-1"]), displayMode: mode },
        } as unknown as HomepageContent;

        const section = content[key] as { displayMode?: ProductSectionDisplayMode };
        expect(resolveProductSectionDisplayMode(section.displayMode)).toBe(mode);
      });
    }
  }
});

/* ------------------------------------------------------------------ */
/*  Product source safety                                             */
/* ------------------------------------------------------------------ */

describe("the display mode never touches the products", () => {
  const PICKED = ["p-a", "p-b", "p-c", "p-d"];

  it("keeps the selected product ids when the mode changes", () => {
    const grid = { ...legacyShelf(PICKED), displayMode: "grid" as const };
    const carousel = { ...grid, displayMode: "carousel" as const };

    expect(carousel.productIds).toEqual(grid.productIds);
  });

  it("keeps the selected order exactly", () => {
    const grid = { ...legacyShelf(PICKED), displayMode: "grid" as const };
    const carousel = { ...grid, displayMode: "carousel" as const };

    // A, B, C, D in both arrangements — not sorted, not reversed, not grouped.
    expect(carousel.productIds).toEqual(["p-a", "p-b", "p-c", "p-d"]);
    expect(grid.productIds).toEqual(["p-a", "p-b", "p-c", "p-d"]);
  });

  it("leaves an empty manual section empty in either mode", () => {
    // Nothing picked means nothing rendered, which the storefront enforces by
    // refusing to render a section with no products. A carousel does not
    // reintroduce a fallback that would fill it.
    for (const mode of ["grid", "carousel"] as const) {
      const shelf = { ...legacyShelf([]), displayMode: mode };
      expect(shelf.productIds).toEqual([]);
    }
  });

  it("brings back no automatic fallback for a curated shelf", () => {
    const rows = describeSectionRows(
      ["featuredProducts", "newArrivals", "featuredShelf", "discountedProducts"],
      {
        featuredProducts: { ...legacyShelf([]), displayMode: "carousel" },
        newArrivals: { ...legacyShelf([]), displayMode: "carousel" },
        featuredShelf: { ...legacyShelf([]), displayMode: "carousel" },
        discountedProducts: { ...legacyShelf([]), displayMode: "carousel" },
      } as unknown as HomepageContent,
    );

    // "No source", not "Enabled": a carousel with nothing picked is still a
    // section that will not be on the site.
    expect(rows.map((r) => r.status)).toEqual([
      "no-source",
      "no-source",
      "no-source",
      "no-source",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/*  Group safety                                                      */
/* ------------------------------------------------------------------ */

describe("group sections", () => {
  it("still sells from its category in grid mode", () => {
    const [group] = resolveGroupSections(
      {
        groupSections: [
          { categoryId: SUPPLEMENTS, enabled: true, displayMode: "grid" },
        ],
      },
      [GROUPS[0]!],
    );

    expect(group!.category.id).toBe(SUPPLEMENTS);
  });

  it("still sells from the same category in carousel mode", () => {
    const [group] = resolveGroupSections(
      {
        groupSections: [
          { categoryId: SUPPLEMENTS, enabled: true, displayMode: "carousel" },
        ],
      },
      [GROUPS[0]!],
    );

    expect(group!.category.id).toBe(SUPPLEMENTS);
    expect(group!.displayMode).toBe("carousel");
    // The resolved shape carries no product list in either mode, which is what
    // makes a manual override structurally impossible for a group.
    expect(group).not.toHaveProperty("productIds");
  });

  it("gives a carousel group no product picker", () => {
    // A stale hand-picked list saved under the old model is stripped on load,
    // and switching to a carousel does not resurrect it.
    const [normalized] = normalizeGroupSections({
      groupSections: [
        {
          categoryId: SUPPLEMENTS,
          enabled: true,
          displayMode: "carousel",
          productIds: ["p-1", "p-2"],
        },
      ],
    });

    expect(normalized).not.toHaveProperty("productIds");
    expect(normalized!.displayMode).toBe("carousel");
  });

  it("gives a group added later the choice automatically", () => {
    // Nothing about the display mode is keyed on a category name, so a group
    // the client opens next month arrives with the setting, on the grid.
    const [future] = resolveGroupSections({}, [
      { id: "future", name: "Whatever Comes Next", slug: "next" },
    ]);

    expect(future!.displayMode).toBe("grid");

    const [configured] = resolveGroupSections(
      {
        groupSections: [
          { categoryId: "future", enabled: true, displayMode: "carousel" },
        ],
      },
      [{ id: "future", name: "Whatever Comes Next", slug: "next" }],
    );

    expect(configured!.displayMode).toBe("carousel");
  });

  it("keeps the presentation stored while the section is a carousel", () => {
    // Switching to a carousel must not erase the treatment Grid goes back to.
    const [stacks] = resolveGroupSections(
      {
        groupSections: [
          {
            categoryId: STACKS,
            enabled: true,
            presentation: "feature",
            displayMode: "carousel",
          },
        ],
      },
      [GROUPS[1]!],
    );

    expect(stacks!.presentation).toBe("feature");
    expect(stacks!.config?.presentation).toBe("feature");
  });
});

/* ------------------------------------------------------------------ */
/*  Section order                                                     */
/* ------------------------------------------------------------------ */

describe("section order", () => {
  const content = (mode: ProductSectionDisplayMode): HomepageContent =>
    ({
      featuredProducts: { ...legacyShelf(["p-1"]), displayMode: mode },
      newArrivals: { ...legacyShelf(["p-2"]), displayMode: mode },
      groupSections: [
        { categoryId: STACKS, enabled: true, displayMode: mode },
      ],
      sectionOrder: [
        "featuredProducts",
        `group:${STACKS}`,
        "newArrivals",
      ],
    }) as unknown as HomepageContent;

  it("does not change a section's key", () => {
    // One section, one row, whichever arrangement it is in — there is no
    // "Best Sellers Carousel" beside "Best Sellers Grid".
    const grid = describeSectionRows(
      content("grid").sectionOrder!,
      content("grid"),
      resolveGroupSections(content("grid"), [GROUPS[1]!]),
    );
    const carousel = describeSectionRows(
      content("carousel").sectionOrder!,
      content("carousel"),
      resolveGroupSections(content("carousel"), [GROUPS[1]!]),
    );

    expect(carousel.map((r) => r.key)).toEqual(grid.map((r) => r.key));
    expect(carousel.map((r) => r.label)).toEqual(grid.map((r) => r.label));
  });

  it("does not change the saved order", () => {
    const banners: string[] = [];
    const grid = resolveSectionOrder(
      content("grid").sectionOrder,
      banners,
      [STACKS],
    );
    const carousel = resolveSectionOrder(
      content("carousel").sectionOrder,
      banners,
      [STACKS],
    );

    // Identical entry for entry, including the sections `resolveSectionOrder`
    // splices in around the ones the client arranged.
    expect(carousel).toEqual(grid);

    // And the three the client did arrange are still in that order.
    const arranged = (order: string[]) =>
      order.filter((key) =>
        ["featuredProducts", `group:${STACKS}`, "newArrivals"].includes(key),
      );
    expect(arranged(carousel)).toEqual([
      "featuredProducts",
      `group:${STACKS}`,
      "newArrivals",
    ]);
  });
});
