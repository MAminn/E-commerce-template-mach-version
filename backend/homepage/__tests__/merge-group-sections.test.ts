import { describe, it, expect } from "vitest";
import { mergeHomepageContentWithDefaults } from "../merge-homepage-content";
import {
  groupSectionKey,
  resolveSectionOrder,
  type HomepageContent,
} from "#root/shared/types/homepage-content";
import {
  groupCategoryIds,
  resolveBroadGroups,
  resolveGroupSections,
  type CategoryRecord,
} from "#root/shared/types/homepage-group-sections";

/**
 * The read path, against the content this store actually has saved.
 *
 * Everything else about group sections is tested as a pure function; this is
 * the test that says the client's existing homepage still works. The blob
 * below is the real stored `landing-editorial` content — two hard-coded group
 * rows pointed at two categories, and a section order the client arranged by
 * hand, which is deliberately *not* the default composition.
 *
 * The promise being kept is narrow and worth stating: nobody edits the
 * database, nothing they configured is lost, and nothing moves on the page
 * that they did not move.
 */

const SUPPLEMENTS = "01a06245-5bed-73ea-b81d-eebe1c7721a4";
const STACKS = "01a06cc1-36ba-75cb-8353-5968a3889e70";
const GYM_GEAR = "01a06cc1-55a5-759e-a04b-f25cdc6ad5ff";

const CATEGORIES: CategoryRecord[] = [
  { id: SUPPLEMENTS, name: "Supplements", slug: "supplements" },
  // The store carries a deleted duplicate of Supplements from an early import.
  {
    id: "01a06247-c68b-7530-85e5-726e4cb1a603",
    name: "Supplements",
    slug: "supplements",
    deleted: true,
  },
  { id: STACKS, name: "Stacks & Bundles", slug: "stacks-bundles" },
  { id: GYM_GEAR, name: "Gym Gear", slug: "gym-gear" },
];

/** The store's stored content, as saved before this change. */
const STORED: Partial<HomepageContent> = {
  categories: {
    enabled: true,
    title: "",
    subtitle: "",
    ctaText: "SHOP ALL",
    ctaLink: "/shop",
    categoryIds: [SUPPLEMENTS, STACKS, GYM_GEAR],
    layoutVariant: "tiles-4",
  },
  stacks: {
    enabled: true,
    title: "STACKS & BUNDLES",
    subtitle: "Built to work together. Priced to move as one.",
    viewAllText: "VIEW ALL",
    viewAllLink: "/shop",
    categoryIds: [STACKS],
    productIds: [],
    limit: 4,
  },
  gymGear: {
    enabled: true,
    title: "GYM GEAR",
    subtitle: "The kit that goes in the bag.",
    viewAllText: "VIEW ALL",
    viewAllLink: "/shop",
    categoryIds: [GYM_GEAR],
    productIds: [],
    limit: 4,
  },
  sectionOrder: [
    "heroMarquee",
    "categories",
    "featuredProducts",
    "stacks",
    "newArrivals",
    "campaign:campaign-primary",
    "gymGear",
    "discountedProducts",
    "ugc",
    "certificates",
    "whyMach",
    "campaign:campaign-secondary",
    "newsletter",
    "footerCta",
  ],
};

const merged = mergeHomepageContentWithDefaults(STORED);
const broadGroups = resolveBroadGroups(
  CATEGORIES,
  merged.categories.categoryIds,
);
const sections = resolveGroupSections(merged, broadGroups);
const order = resolveSectionOrder(
  merged.sectionOrder,
  (merged.campaignBanners ?? []).map((b) => b.id),
  groupCategoryIds(broadGroups),
);

describe("merge — legacy group content", () => {
  it("turns the two hard-coded rows into their categories' sections", () => {
    expect(merged.groupSections?.map((s) => s.categoryId)).toEqual([
      STACKS,
      GYM_GEAR,
    ]);
  });

  it("keeps every setting the client had configured", () => {
    const stacks = merged.groupSections!.find((s) => s.categoryId === STACKS)!;

    expect(stacks).toMatchObject({
      enabled: true,
      title: "STACKS & BUNDLES",
      subtitle: "Built to work together. Priced to move as one.",
      viewAllText: "VIEW ALL",
      viewAllLink: "/shop",
      limit: 4,
      presentation: "feature",
    });
  });

  it("drops the deprecated manual override from every group", () => {
    // Read path, real stored content. A group's products come from its
    // category, so a hand-picked list must not survive the merge.
    for (const section of merged.groupSections ?? []) {
      expect("productIds" in section).toBe(false);
    }
  });

  it("drops a hand-picked list saved against a group section", () => {
    const withOverride = mergeHomepageContentWithDefaults({
      ...STORED,
      groupSections: [
        { categoryId: STACKS, enabled: true, productIds: ["stale-1"] },
      ],
    });
    const stacks = withOverride.groupSections!.find(
      (s) => s.categoryId === STACKS,
    )!;

    expect("productIds" in stacks).toBe(false);
    expect(stacks.enabled).toBe(true);
  });

  it("leaves the deprecated fields in place rather than deleting them", () => {
    // Read-compatibility, not a rewrite. Nothing that still reads the old
    // shape breaks on the first load after this deploys.
    expect(merged.stacks?.categoryIds).toEqual([STACKS]);
    expect(merged.gymGear?.categoryIds).toEqual([GYM_GEAR]);
  });

  it("is idempotent — a saved section wins over the legacy row beside it", () => {
    // The load after the client's first save. Without this, the stale legacy
    // copy would quietly undo whatever they just changed.
    const resaved = mergeHomepageContentWithDefaults({
      ...STORED,
      groupSections: [
        { categoryId: STACKS, enabled: false, title: "BUNDLES" },
      ],
    });
    const stacks = resaved.groupSections!.filter(
      (s) => s.categoryId === STACKS,
    );

    expect(stacks).toHaveLength(1);
    expect(stacks[0]).toMatchObject({ enabled: false, title: "BUNDLES" });
  });
});

describe("merge — the store's three broad groups", () => {
  it("finds all three, ignoring the deleted duplicate", () => {
    expect(sections.map((s) => s.category.name)).toEqual([
      "Supplements",
      "Stacks & Bundles",
      "Gym Gear",
    ]);
  });

  it("gives Supplements a real section it never had", () => {
    const supplements = sections.find((s) => s.category.id === SUPPLEMENTS)!;

    expect(supplements.key).toBe(groupSectionKey(SUPPLEMENTS));
    // Off, because nobody has configured it. Deploying this must not put a new
    // row on the live storefront by itself.
    expect(supplements.enabled).toBe(false);
    expect(supplements.heading).toBe("Supplements");
    expect(supplements.viewAllLink).toBe("/categories/supplements");
  });

  it("keeps Stacks and Gym Gear switched on, as they were", () => {
    expect(sections.find((s) => s.category.id === STACKS)!.enabled).toBe(true);
    expect(sections.find((s) => s.category.id === GYM_GEAR)!.enabled).toBe(
      true,
    );
  });

  it("keeps the Stacks feature treatment and the Gym Gear shelf", () => {
    expect(sections.find((s) => s.category.id === STACKS)!.presentation).toBe(
      "feature",
    );
    expect(sections.find((s) => s.category.id === GYM_GEAR)!.presentation).toBe(
      "shelf",
    );
  });
});

describe("merge — the client's saved section order", () => {
  it("rewrites the legacy keys without moving anything", () => {
    expect(order).toEqual([
      "heroMarquee",
      "categories",
      groupSectionKey(SUPPLEMENTS),
      "featuredProducts",
      groupSectionKey(STACKS),
      "newArrivals",
      "featuredShelf",
      "campaign:campaign-primary",
      groupSectionKey(GYM_GEAR),
      "discountedProducts",
      "ugc",
      "certificates",
      "whyMach",
      "campaign:campaign-secondary",
      "newsletter",
      "footerCta",
    ]);
  });

  it("preserves the client's arrangement as an exact subsequence", () => {
    // Their order was not the default — Best Sellers before Stacks, Community
    // before Certificates before Why Mach. All of it survives.
    const theirs = STORED.sectionOrder!.map((key) =>
      key === "stacks"
        ? groupSectionKey(STACKS)
        : key === "gymGear"
          ? groupSectionKey(GYM_GEAR)
          : key,
    );

    expect(order.filter((k) => theirs.includes(k))).toEqual(theirs);
  });

  it("lands the two new sections beside the sections they belong with", () => {
    // Supplements joins the group band at the top; Featured joins the
    // merchandising run rather than being dumped under the closing CTA.
    expect(order.indexOf(groupSectionKey(SUPPLEMENTS))).toBe(
      order.indexOf("categories") + 1,
    );
    expect(order.indexOf("featuredShelf")).toBe(
      order.indexOf("newArrivals") + 1,
    );
    expect(order.indexOf("footerCta")).toBe(order.length - 1);
  });

  it("ships Featured off, so the live page does not change on deploy", () => {
    expect(merged.featuredShelf?.enabled).toBe(false);
    expect(merged.featuredShelf?.productIds).toEqual([]);
    expect(merged.featuredShelf?.title).toBe("FEATURED");
  });

  it("keeps Featured hand-picked while groups are category-driven", () => {
    // The two are opposites on purpose. Featured is a list somebody chose;
    // a group is a part of the shop. Stripping the override from groups must
    // not touch the one section whose whole point is that it has one.
    const curated = mergeHomepageContentWithDefaults({
      ...STORED,
      featuredShelf: {
        enabled: true,
        title: "FEATURED",
        viewAllText: "VIEW ALL",
        viewAllLink: "/shop",
        productIds: ["picked-2", "picked-1", "picked-3"],
      },
      groupSections: [
        { categoryId: STACKS, enabled: true, productIds: ["stale-1"] },
      ],
    });

    // Featured keeps its selection, in the order the client chose.
    expect(curated.featuredShelf?.productIds).toEqual([
      "picked-2",
      "picked-1",
      "picked-3",
    ]);
    // The group next to it does not.
    expect(
      "productIds" in curated.groupSections!.find((s) => s.categoryId === STACKS)!,
    ).toBe(false);
  });

  it("leaves an unsaved order to the default composition", () => {
    const fresh = mergeHomepageContentWithDefaults({});
    expect(fresh.sectionOrder).toBeUndefined();
  });
});

describe("merge — independence", () => {
  it("does not tie group sections to the Shop by group band", () => {
    // Turning the navigation band off must not switch off the merchandising
    // sections. They share the group *selection*, nothing else.
    const bandOff = mergeHomepageContentWithDefaults({
      ...STORED,
      categories: { ...STORED.categories!, enabled: false },
    });

    const withBandOff = resolveGroupSections(
      bandOff,
      resolveBroadGroups(CATEGORIES, bandOff.categories.categoryIds),
    );

    expect(withBandOff.map((s) => s.category.id)).toEqual(
      sections.map((s) => s.category.id),
    );
    expect(withBandOff.map((s) => s.enabled)).toEqual(
      sections.map((s) => s.enabled),
    );
  });

  it("drops a group the client removes, leaving the rest of the order alone", () => {
    const withoutGymGear = resolveSectionOrder(
      merged.sectionOrder,
      (merged.campaignBanners ?? []).map((b) => b.id),
      [SUPPLEMENTS, STACKS],
    );

    expect(withoutGymGear).not.toContain(groupSectionKey(GYM_GEAR));
    expect(withoutGymGear).toContain(groupSectionKey(STACKS));
    expect(withoutGymGear.indexOf("featuredProducts")).toBeLessThan(
      withoutGymGear.indexOf(groupSectionKey(STACKS)),
    );
  });

  it("adds a fourth group automatically, with no code change", () => {
    const APPAREL = "01a07000-0000-7000-8000-000000000001";
    const withApparel = mergeHomepageContentWithDefaults({
      ...STORED,
      categories: {
        ...STORED.categories!,
        categoryIds: [SUPPLEMENTS, STACKS, GYM_GEAR, APPAREL],
      },
    });
    const groups = resolveBroadGroups(
      [...CATEGORIES, { id: APPAREL, name: "Apparel", slug: "apparel" }],
      withApparel.categories.categoryIds,
    );

    const resolved = resolveGroupSections(withApparel, groups);
    expect(resolved).toHaveLength(4);
    expect(resolved.at(-1)).toMatchObject({
      enabled: false,
      heading: "Apparel",
      presentation: "shelf",
    });

    const withApparelOrder = resolveSectionOrder(
      withApparel.sectionOrder,
      [],
      groupCategoryIds(groups),
    );
    expect(withApparelOrder).toContain(groupSectionKey(APPAREL));
  });
});
