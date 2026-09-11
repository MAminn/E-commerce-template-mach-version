import { describe, it, expect } from "vitest";
import {
  broadGroupsFor,
  groupCategoryIds,
  legacyGroupCategoryId,
  migrateLegacySectionOrder,
  normalizeGroupSections,
  resolveBroadGroups,
  resolveGroupSections,
  type CategoryRecord,
} from "../homepage-group-sections";
import {
  DEFAULT_GROUP_SECTION_LIMIT,
  groupSectionKey,
  type HomepageContent,
  type HomepageProductGroupContent,
} from "../homepage-content";

/**
 * The homepage used to know the store's product groups by name, two of them,
 * written into the type. These tests pin the replacement: the groups come from
 * the catalogue, the sections follow them, and the client's existing Stacks &
 * Bundles and Gym Gear configuration survives the change intact.
 *
 * Almost every assertion here is really the same assertion from a different
 * angle — **a section is its category, not its name**. That is what lets a
 * group be renamed, reordered, added or deleted without a deploy, and it is
 * the thing most easily lost the next time someone reaches for a string.
 */

const SUPPLEMENTS = "01a06245-5bed-73ea-b81d-eebe1c7721a4";
const STACKS = "01a06cc1-36ba-75cb-8353-5968a3889e70";
const GYM_GEAR = "01a06cc1-55a5-759e-a04b-f25cdc6ad5ff";
const NEW_GROUP = "01a07000-0000-7000-8000-000000000001";

const CATEGORIES: CategoryRecord[] = [
  { id: SUPPLEMENTS, name: "Supplements", slug: "supplements" },
  { id: STACKS, name: "Stacks & Bundles", slug: "stacks-bundles" },
  { id: GYM_GEAR, name: "Gym Gear", slug: "gym-gear" },
];

/** The store's real saved Stacks row, before this change. */
const LEGACY_STACKS: HomepageProductGroupContent = {
  enabled: true,
  title: "STACKS & BUNDLES",
  subtitle: "Built to work together. Priced to move as one.",
  viewAllText: "VIEW ALL",
  viewAllLink: "/shop",
  categoryIds: [STACKS],
  productIds: [],
  limit: 4,
};

/** The store's real saved Gym Gear row, before this change. */
const LEGACY_GYM_GEAR: HomepageProductGroupContent = {
  enabled: true,
  title: "GYM GEAR",
  subtitle: "The kit that goes in the bag.",
  viewAllText: "VIEW ALL",
  viewAllLink: "/shop",
  categoryIds: [GYM_GEAR],
  productIds: [],
  limit: 4,
};

type GroupContent = Pick<
  HomepageContent,
  "groupSections" | "stacks" | "gymGear"
>;

const LEGACY_ONLY: GroupContent = {
  stacks: LEGACY_STACKS,
  gymGear: LEGACY_GYM_GEAR,
};

/* ------------------------------------------------------------------ */
/*  Broad groups                                                      */
/* ------------------------------------------------------------------ */

describe("resolveBroadGroups", () => {
  it("takes the client's homepage selection, in their order", () => {
    const groups = resolveBroadGroups(CATEGORIES, [
      GYM_GEAR,
      SUPPLEMENTS,
      STACKS,
    ]);

    expect(groups.map((g) => g.name)).toEqual([
      "Gym Gear",
      "Supplements",
      "Stacks & Bundles",
    ]);
  });

  it("falls back to every category flagged for the landing page", () => {
    const groups = resolveBroadGroups(
      [
        ...CATEGORIES,
        { id: "deep-1", name: "Creatine", slug: "creatine", showOnLanding: false },
      ],
      undefined,
    );

    expect(groups.map((g) => g.id)).toEqual([SUPPLEMENTS, STACKS, GYM_GEAR]);
  });

  it("never treats a deleted category as a group, even when selected", () => {
    // The store carries a deleted duplicate of Supplements. A homepage section
    // for it would be a section for a category the client cannot see.
    const groups = resolveBroadGroups(
      [
        ...CATEGORIES,
        { id: "dupe", name: "Supplements", slug: "supplements", deleted: true },
      ],
      [SUPPLEMENTS, "dupe", STACKS],
    );

    expect(groups.map((g) => g.id)).toEqual([SUPPLEMENTS, STACKS]);
  });

  it("is unaffected by the Shop by group band being switched off", () => {
    // The band's visibility and the group sections are independent. The band's
    // *selection* defines the store's groups; its switch does not.
    const off = broadGroupsFor(
      { categories: { enabled: false, categoryIds: [SUPPLEMENTS, STACKS] } as never },
      CATEGORIES,
    );
    const on = broadGroupsFor(
      { categories: { enabled: true, categoryIds: [SUPPLEMENTS, STACKS] } as never },
      CATEGORIES,
    );

    expect(off).toEqual(on);
    expect(off.map((g) => g.id)).toEqual([SUPPLEMENTS, STACKS]);
  });
});

/* ------------------------------------------------------------------ */
/*  Reconciliation                                                    */
/* ------------------------------------------------------------------ */

describe("resolveGroupSections", () => {
  const groups = resolveBroadGroups(CATEGORIES, [
    SUPPLEMENTS,
    STACKS,
    GYM_GEAR,
  ]);

  it("gives every broad group a section, in broad-group order", () => {
    const sections = resolveGroupSections(LEGACY_ONLY, groups);

    expect(sections).toHaveLength(3);
    expect(sections.map((s) => s.category.name)).toEqual([
      "Supplements",
      "Stacks & Bundles",
      "Gym Gear",
    ]);
  });

  it("gives Supplements a section without a 'supplements' key anywhere", () => {
    const sections = resolveGroupSections(LEGACY_ONLY, groups);
    const supplements = sections.find((s) => s.category.id === SUPPLEMENTS);

    expect(supplements).toBeDefined();
    // Its identity is the category id, and its order key is derived from it.
    // Nothing in the content model names this group.
    expect(supplements!.key).toBe(`group:${SUPPLEMENTS}`);
    expect(Object.keys(LEGACY_ONLY)).not.toContain("supplements");
  });

  it("produces a section for a broad group added later, with no code change", () => {
    const withNewGroup = resolveGroupSections(
      LEGACY_ONLY,
      resolveBroadGroups(
        [...CATEGORIES, { id: NEW_GROUP, name: "Apparel", slug: "apparel" }],
        [SUPPLEMENTS, STACKS, GYM_GEAR, NEW_GROUP],
      ),
    );

    expect(withNewGroup).toHaveLength(4);
    expect(withNewGroup.at(-1)!.category.name).toBe("Apparel");
  });

  it("defaults a group nobody has configured to off", () => {
    const sections = resolveGroupSections(LEGACY_ONLY, groups);
    const supplements = sections.find((s) => s.category.id === SUPPLEMENTS)!;

    // Opening a catalogue group must not change the live homepage by itself.
    expect(supplements.enabled).toBe(false);
    expect(supplements.presentation).toBe("shelf");
    expect(supplements.limit).toBe(DEFAULT_GROUP_SECTION_LIMIT);
    expect(supplements.productIds).toEqual([]);
  });

  it("names an unconfigured group after its category", () => {
    const sections = resolveGroupSections(LEGACY_ONLY, groups);
    const supplements = sections.find((s) => s.category.id === SUPPLEMENTS)!;

    expect(supplements.heading).toBe("Supplements");
    expect(supplements.headingOverride).toBeUndefined();
    expect(supplements.viewAllLink).toBe("/categories/supplements");
  });

  it("keys a section on the category id, not the category name", () => {
    const sections = resolveGroupSections(
      { groupSections: [{ categoryId: GYM_GEAR, enabled: true }] },
      groups,
    );
    const gym = sections.find((s) => s.category.id === GYM_GEAR)!;

    expect(gym.key).toBe(`group:${GYM_GEAR}`);
    expect(gym.key).not.toContain("Gym");
    expect(gym.key).not.toContain("gym-gear");
  });

  it("survives the client renaming the category", () => {
    const config: GroupContent = {
      groupSections: [
        { categoryId: GYM_GEAR, enabled: true, limit: 8, presentation: "shelf" },
      ],
    };

    const before = resolveGroupSections(config, groups);
    const after = resolveGroupSections(
      config,
      resolveBroadGroups(
        CATEGORIES.map((c) =>
          c.id === GYM_GEAR ? { ...c, name: "Equipment", slug: "equipment" } : c,
        ),
        [SUPPLEMENTS, STACKS, GYM_GEAR],
      ),
    );

    const gymBefore = before.find((s) => s.category.id === GYM_GEAR)!;
    const gymAfter = after.find((s) => s.category.id === GYM_GEAR)!;

    // Same section, same order key, same configuration — new name.
    expect(gymAfter.key).toBe(gymBefore.key);
    expect(gymAfter.enabled).toBe(true);
    expect(gymAfter.limit).toBe(8);
    expect(gymAfter.heading).toBe("Equipment");
  });

  it("drops a section whose category is no longer a broad group", () => {
    const sections = resolveGroupSections(
      LEGACY_ONLY,
      resolveBroadGroups(CATEGORIES, [SUPPLEMENTS, STACKS]),
    );

    expect(sections.map((s) => s.category.id)).toEqual([SUPPLEMENTS, STACKS]);
    expect(sections.some((s) => s.category.id === GYM_GEAR)).toBe(false);
  });

  it("treats a heading override as copy, never as identity", () => {
    const sections = resolveGroupSections(
      {
        groupSections: [
          { categoryId: STACKS, enabled: true, title: "BUNDLE SHOP" },
        ],
      },
      groups,
    );
    const stacks = sections.find((s) => s.category.id === STACKS)!;

    expect(stacks.category.name).toBe("Stacks & Bundles");
    expect(stacks.heading).toBe("BUNDLE SHOP");
    expect(stacks.headingOverride).toBe("BUNDLE SHOP");
    expect(stacks.key).toBe(`group:${STACKS}`);
  });

  it("does not call the shipped caps heading a rename", () => {
    // "STACKS & BUNDLES" against "Stacks & Bundles" is house style, not a
    // client decision — reporting it would bury the renames that matter.
    const sections = resolveGroupSections(LEGACY_ONLY, groups);
    const stacks = sections.find((s) => s.category.id === STACKS)!;

    expect(stacks.heading).toBe("STACKS & BUNDLES");
    expect(stacks.headingOverride).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Legacy compatibility                                              */
/* ------------------------------------------------------------------ */

describe("normalizeGroupSections", () => {
  it("converts the legacy Stacks row into its category's section", () => {
    const sections = normalizeGroupSections(LEGACY_ONLY);
    const stacks = sections.find((s) => s.categoryId === STACKS)!;

    expect(stacks).toBeDefined();
    expect(stacks.enabled).toBe(true);
    expect(stacks.title).toBe("STACKS & BUNDLES");
    expect(stacks.subtitle).toBe(
      "Built to work together. Priced to move as one.",
    );
    expect(stacks.viewAllLink).toBe("/shop");
    expect(stacks.limit).toBe(4);
  });

  it("converts the legacy Gym Gear row into its category's section", () => {
    const gym = normalizeGroupSections(LEGACY_ONLY).find(
      (s) => s.categoryId === GYM_GEAR,
    )!;

    expect(gym).toBeDefined();
    expect(gym.title).toBe("GYM GEAR");
    expect(gym.subtitle).toBe("The kit that goes in the bag.");
  });

  it("preserves the legacy enabled state either way", () => {
    const sections = normalizeGroupSections({
      stacks: { ...LEGACY_STACKS, enabled: false },
      gymGear: LEGACY_GYM_GEAR,
    });

    expect(sections.find((s) => s.categoryId === STACKS)!.enabled).toBe(false);
    expect(sections.find((s) => s.categoryId === GYM_GEAR)!.enabled).toBe(true);
  });

  it("preserves a hand-picked legacy selection and its limit", () => {
    const picked = ["p-1", "p-2", "p-3"];
    const sections = normalizeGroupSections({
      stacks: { ...LEGACY_STACKS, productIds: picked, limit: 9 },
    });
    const stacks = sections.find((s) => s.categoryId === STACKS)!;

    expect(stacks.productIds).toEqual(picked);
    expect(stacks.limit).toBe(9);
  });

  it("keeps the Stacks feature treatment and the Gym Gear shelf", () => {
    // The two rows did not look the same before and must not start to. This is
    // the one place the legacy key still carries meaning, and only once.
    const sections = normalizeGroupSections(LEGACY_ONLY);

    expect(sections.find((s) => s.categoryId === STACKS)!.presentation).toBe(
      "feature",
    );
    expect(sections.find((s) => s.categoryId === GYM_GEAR)!.presentation).toBe(
      "shelf",
    );
  });

  it("lets a saved group section win over the legacy row it replaced", () => {
    // Runs on every load, so it has to be idempotent: without this the
    // client's first save would be undone by the stale legacy copy beside it.
    const sections = normalizeGroupSections({
      groupSections: [
        { categoryId: STACKS, enabled: false, title: "BUNDLES" },
      ],
      stacks: LEGACY_STACKS,
      gymGear: LEGACY_GYM_GEAR,
    });
    const stacks = sections.filter((s) => s.categoryId === STACKS);

    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.enabled).toBe(false);
    expect(stacks[0]!.title).toBe("BUNDLES");
  });

  it("ignores a legacy row that was never pointed at a category", () => {
    // Nothing to lose: with no source it resolved to no products and rendered
    // nothing before this change either.
    expect(
      normalizeGroupSections({ stacks: { ...LEGACY_STACKS, categoryIds: [] } }),
    ).toEqual([]);
    expect(legacyGroupCategoryId({ ...LEGACY_STACKS, categoryIds: [] })).toBeUndefined();
  });

  it("de-duplicates repeated categories in saved content", () => {
    const sections = normalizeGroupSections({
      groupSections: [
        { categoryId: STACKS, enabled: true },
        { categoryId: STACKS, enabled: false },
      ],
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]!.enabled).toBe(true);
  });
});

describe("migrateLegacySectionOrder", () => {
  it("rewrites the legacy keys in place, keeping the client's arrangement", () => {
    // The store's real saved order, which is not the default composition.
    const saved = [
      "heroMarquee",
      "categories",
      "featuredProducts",
      "stacks",
      "newArrivals",
      "campaign:campaign-primary",
      "gymGear",
      "discountedProducts",
      "footerCta",
    ];

    expect(migrateLegacySectionOrder(saved, LEGACY_ONLY)).toEqual([
      "heroMarquee",
      "categories",
      "featuredProducts",
      groupSectionKey(STACKS),
      "newArrivals",
      "campaign:campaign-primary",
      groupSectionKey(GYM_GEAR),
      "discountedProducts",
      "footerCta",
    ]);
  });

  it("keeps Stacks exactly where the client put it", () => {
    const saved = ["footerCta", "stacks", "heroMarquee"];
    const migrated = migrateLegacySectionOrder(saved, LEGACY_ONLY)!;

    expect(migrated.indexOf(groupSectionKey(STACKS))).toBe(1);
  });

  it("leaves an unsaved order alone", () => {
    expect(migrateLegacySectionOrder(undefined, LEGACY_ONLY)).toBeUndefined();
  });

  it("leaves a legacy key with no category to map to", () => {
    const saved = ["stacks", "gymGear"];
    const migrated = migrateLegacySectionOrder(saved, {
      stacks: { ...LEGACY_STACKS, categoryIds: [] },
      gymGear: LEGACY_GYM_GEAR,
    })!;

    // Unmappable, so it stays as it is and `resolveSectionOrder` drops it —
    // rather than being rewritten to a key pointing at nothing.
    expect(migrated).toEqual(["stacks", groupSectionKey(GYM_GEAR)]);
  });
});

describe("groupCategoryIds", () => {
  it("returns the broad groups in order, for the section-order resolver", () => {
    expect(
      groupCategoryIds(resolveBroadGroups(CATEGORIES, [GYM_GEAR, SUPPLEMENTS])),
    ).toEqual([GYM_GEAR, SUPPLEMENTS]);
  });
});
