import { describe, it, expect } from "vitest";
import {
  buildGroupProductRequests,
  groupSearchInput,
} from "../homepage-products";
import {
  normalizeGroupSections,
  resolveGroupSections,
  type BroadGroupCategory,
} from "#root/shared/types/homepage-group-sections";
import type {
  HomepageContent,
  HomepageProductGroupContent,
} from "#root/shared/types/homepage-content";

/**
 * What the homepage actually asks the database for on behalf of a group.
 *
 * A group section *is* its category, so the query has one source and no
 * branches. The bug these pin: a group could be pinned to a hand-picked list
 * of product ids, which meant a product the client added to the category never
 * reached the homepage until they went back into Homepage Admin and re-picked
 * — republishing something they had already published.
 *
 * Asserted through the pure request builder the hook itself calls, so these
 * are statements about the real query rather than about a mock of it.
 */

const SUPPLEMENTS = "01a06245-5bed-73ea-b81d-eebe1c7721a4";
const STACKS = "01a06cc1-36ba-75cb-8353-5968a3889e70";
const GYM_GEAR = "01a06cc1-55a5-759e-a04b-f25cdc6ad5ff";

const GROUPS: BroadGroupCategory[] = [
  { id: SUPPLEMENTS, name: "Supplements", slug: "supplements" },
  { id: STACKS, name: "Stacks & Bundles", slug: "stacks-bundles" },
  { id: GYM_GEAR, name: "Gym Gear", slug: "gym-gear" },
];

type GroupContent = Pick<
  HomepageContent,
  "groupSections" | "stacks" | "gymGear"
>;

/** A legacy group row carrying a hand-picked selection, as production may. */
const legacyGroup = (
  categoryId: string,
  productIds: string[],
): HomepageProductGroupContent => ({
  enabled: true,
  title: "GROUP",
  viewAllText: "VIEW ALL",
  viewAllLink: "/shop",
  categoryIds: [categoryId],
  productIds,
  limit: 4,
});

const sectionsFor = (content: GroupContent) =>
  resolveGroupSections(content, GROUPS);

describe("group product requests", () => {
  it("queries an enabled group by its category id", () => {
    const sections = sectionsFor({
      groupSections: [{ categoryId: SUPPLEMENTS, enabled: true, limit: 4 }],
    });

    const [request] = buildGroupProductRequests(sections);

    expect(request).toEqual({ categoryId: SUPPLEMENTS, limit: 4 });
    expect(groupSearchInput(request!)).toEqual({
      limit: 4,
      includeOutOfStock: true,
      categoryIds: [SUPPLEMENTS],
    });
  });

  it("respects the group's limit", () => {
    const sections = sectionsFor({
      groupSections: [{ categoryId: SUPPLEMENTS, enabled: true, limit: 12 }],
    });

    expect(groupSearchInput(buildGroupProductRequests(sections)[0]!).limit).toBe(
      12,
    );
  });

  it("still queries by category when old content carries productIds", () => {
    // Saved before the override was removed. The section's source is its
    // category either way.
    const sections = sectionsFor({
      groupSections: [
        {
          categoryId: SUPPLEMENTS,
          enabled: true,
          limit: 4,
          productIds: ["stale-1", "stale-2"],
        },
      ],
    });

    expect(groupSearchInput(buildGroupProductRequests(sections)[0]!)).toEqual({
      limit: 4,
      includeOutOfStock: true,
      categoryIds: [SUPPLEMENTS],
    });
  });

  it("never sends productIds to product.search for a group", () => {
    const sections = sectionsFor({
      groupSections: [
        {
          categoryId: SUPPLEMENTS,
          enabled: true,
          productIds: ["stale-1", "stale-2"],
        },
      ],
      stacks: legacyGroup(STACKS, ["legacy-1"]),
      gymGear: legacyGroup(GYM_GEAR, ["legacy-2"]),
    });

    for (const request of buildGroupProductRequests(sections)) {
      const input = groupSearchInput(request);
      expect("productIds" in input).toBe(false);
      expect(JSON.stringify(input)).not.toContain("stale-");
      expect(JSON.stringify(input)).not.toContain("legacy-");
    }
  });

  it("asks only for the category, so a product added to it is eligible", () => {
    // The guarantee behind "add a product in Dashboard → Products and it shows
    // up": the homepage names no product, so whatever the category returns is
    // what the section carries. Nothing here can go stale.
    const sections = sectionsFor({
      groupSections: [{ categoryId: SUPPLEMENTS, enabled: true, limit: 4 }],
    });

    const input = groupSearchInput(buildGroupProductRequests(sections)[0]!);

    expect(Object.keys(input).sort()).toEqual([
      "categoryIds",
      "includeOutOfStock",
      "limit",
    ]);
  });

  it("does not query a disabled group", () => {
    const sections = sectionsFor({
      groupSections: [
        { categoryId: SUPPLEMENTS, enabled: false },
        { categoryId: STACKS, enabled: true },
      ],
    });

    const requests = buildGroupProductRequests(sections);

    expect(requests.map((r) => r.categoryId)).toEqual([STACKS]);
  });

  it("gives each of several groups its own category query", () => {
    const sections = sectionsFor({
      groupSections: [
        { categoryId: SUPPLEMENTS, enabled: true, limit: 4 },
        { categoryId: STACKS, enabled: true, limit: 2 },
        { categoryId: GYM_GEAR, enabled: true, limit: 6 },
      ],
    });

    expect(buildGroupProductRequests(sections).map(groupSearchInput)).toEqual([
      { limit: 4, includeOutOfStock: true, categoryIds: [SUPPLEMENTS] },
      { limit: 2, includeOutOfStock: true, categoryIds: [STACKS] },
      { limit: 6, includeOutOfStock: true, categoryIds: [GYM_GEAR] },
    ]);
  });
});

describe("legacy hand-picked selections", () => {
  it("does not let legacy stacks productIds become a live override", () => {
    const content: GroupContent = {
      stacks: legacyGroup(STACKS, ["legacy-stack-1", "legacy-stack-2"]),
    };

    const stacks = sectionsFor(content).find(
      (s) => s.category.id === STACKS,
    )!;
    const request = buildGroupProductRequests([stacks])[0]!;

    expect(groupSearchInput(request).categoryIds).toEqual([STACKS]);
    expect(normalizeGroupSections(content)[0]!.productIds).toBeUndefined();
  });

  it("does not let legacy gymGear productIds become a live override", () => {
    const content: GroupContent = {
      gymGear: legacyGroup(GYM_GEAR, ["legacy-gear-1"]),
    };

    const gym = sectionsFor(content).find((s) => s.category.id === GYM_GEAR)!;
    const request = buildGroupProductRequests([gym])[0]!;

    expect(groupSearchInput(request).categoryIds).toEqual([GYM_GEAR]);
    expect(normalizeGroupSections(content)[0]!.productIds).toBeUndefined();
  });

  it("keeps everything about the legacy rows that still describes them", () => {
    // Only the product list is dropped. The section itself is untouched, so
    // the client's configuration and both visual treatments survive.
    const content: GroupContent = {
      stacks: {
        ...legacyGroup(STACKS, ["legacy-1"]),
        title: "STACKS & BUNDLES",
        subtitle: "Built to work together.",
        limit: 3,
      },
      gymGear: legacyGroup(GYM_GEAR, ["legacy-2"]),
    };

    const sections = sectionsFor(content);
    const stacks = sections.find((s) => s.category.id === STACKS)!;
    const gym = sections.find((s) => s.category.id === GYM_GEAR)!;

    expect(stacks).toMatchObject({
      enabled: true,
      heading: "STACKS & BUNDLES",
      subtitle: "Built to work together.",
      limit: 3,
      presentation: "feature",
    });
    expect(gym).toMatchObject({ enabled: true, presentation: "shelf" });
  });

  it("keeps the group's identity and view-all unchanged", () => {
    // Removing the override is a change to the product source, nothing else.
    const gym = sectionsFor({
      gymGear: legacyGroup(GYM_GEAR, ["legacy-1"]),
    }).find((s) => s.category.id === GYM_GEAR)!;

    expect(gym.key).toBe(`group:${GYM_GEAR}`);
    expect(gym.viewAllLink).toBe("/shop");
  });

  it("routes an unconfigured group's view-all to its category page", () => {
    const supplements = sectionsFor({}).find(
      (s) => s.category.id === SUPPLEMENTS,
    )!;

    expect(supplements.key).toBe(`group:${SUPPLEMENTS}`);
    expect(supplements.viewAllLink).toBe("/categories/supplements");
  });
});

describe("normalization cannot reintroduce a manual override", () => {
  it("strips productIds from saved group sections", () => {
    const [section] = normalizeGroupSections({
      groupSections: [
        { categoryId: SUPPLEMENTS, enabled: true, productIds: ["stale-1"] },
      ],
    });

    expect("productIds" in section!).toBe(false);
  });

  it("is idempotent — re-normalising never puts one back", () => {
    const once = normalizeGroupSections({
      groupSections: [
        { categoryId: SUPPLEMENTS, enabled: true, productIds: ["stale-1"] },
      ],
      stacks: legacyGroup(STACKS, ["legacy-1"]),
    });
    const twice = normalizeGroupSections({ groupSections: once });

    expect(twice).toEqual(once);
    for (const section of twice) {
      expect("productIds" in section).toBe(false);
    }
  });

  it("carries no product source on the resolved section at all", () => {
    // The shape itself is the guarantee: there is no field a caller could read
    // to reintroduce a hand-picked group, and no source picker to set one.
    const section = sectionsFor({
      groupSections: [
        { categoryId: SUPPLEMENTS, enabled: true, productIds: ["stale-1"] },
      ],
    })[0]!;

    expect("productIds" in section).toBe(false);
    expect("categoryIds" in section).toBe(false);
    expect(section.category.id).toBe(SUPPLEMENTS);
  });
});
