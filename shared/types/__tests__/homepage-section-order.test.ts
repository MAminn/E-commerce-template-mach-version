import { describe, it, expect } from "vitest";
import {
  CAMPAIGN_SECTION_PREFIX,
  DEFAULT_SECTION_ORDER,
  ORDERABLE_SECTION_KEYS,
  groupSectionKey,
  resolveSectionOrder,
} from "../homepage-content";

/**
 * `resolveSectionOrder` is the only thing standing between a client's saved
 * homepage composition and the page that ships. These tests pin the behaviour
 * that matters to them: an order they arranged is never quietly reset, and
 * sections that shipped after their last save still land in a sensible place.
 */

const CAMPAIGN_A = `${CAMPAIGN_SECTION_PREFIX}campaign-primary`;
const CAMPAIGN_B = `${CAMPAIGN_SECTION_PREFIX}campaign-secondary`;
const SEEDED_BANNERS = ["campaign-primary", "campaign-secondary"];

// The store's three broad groups, in the order the client selected them.
const SUPPLEMENTS = "01a06245-5bed-73ea-b81d-eebe1c7721a4";
const STACKS = "01a06cc1-36ba-75cb-8353-5968a3889e70";
const GYM_GEAR = "01a06cc1-55a5-759e-a04b-f25cdc6ad5ff";
const GROUPS = [SUPPLEMENTS, STACKS, GYM_GEAR];
const GROUP_SUPPLEMENTS = groupSectionKey(SUPPLEMENTS);
const GROUP_STACKS = groupSectionKey(STACKS);
const GROUP_GYM_GEAR = groupSectionKey(GYM_GEAR);

describe("resolveSectionOrder", () => {
  it("preserves a complete custom order exactly", () => {
    const custom = [
      "heroMarquee",
      "whyMach",
      "featuredProducts",
      GROUP_GYM_GEAR,
      "newsletter",
      "categories",
      GROUP_STACKS,
      "newArrivals",
      CAMPAIGN_A,
      "featuredShelf",
      GROUP_SUPPLEMENTS,
      "discountedProducts",
      CAMPAIGN_B,
      "certificates",
      "ugc",
      "footerCta",
    ];

    expect(resolveSectionOrder(custom, SEEDED_BANNERS, GROUPS)).toEqual(custom);
  });

  it("de-duplicates repeated keys, keeping the first position", () => {
    const saved = [
      "heroMarquee",
      "featuredProducts",
      "heroMarquee",
      "featuredProducts",
    ];

    const resolved = resolveSectionOrder(saved, []);

    expect(resolved.filter((k) => k === "heroMarquee")).toHaveLength(1);
    expect(resolved.filter((k) => k === "featuredProducts")).toHaveLength(1);
    expect(resolved.indexOf("heroMarquee")).toBeLessThan(
      resolved.indexOf("featuredProducts"),
    );
  });

  it("drops keys the storefront no longer renders", () => {
    const resolved = resolveSectionOrder(
      ["heroMarquee", "testimonialsCarousel", "featuredProducts"],
      [],
    );

    expect(resolved).not.toContain("testimonialsCarousel");
    expect(resolved).toContain("featuredProducts");
  });

  it("drops a reference to a campaign banner that was deleted", () => {
    const saved = [...DEFAULT_SECTION_ORDER];

    // Only the primary banner still exists in the CMS.
    const resolved = resolveSectionOrder(saved, ["campaign-primary"]);

    expect(resolved).toContain(CAMPAIGN_A);
    expect(resolved).not.toContain(CAMPAIGN_B);
  });

  it("inserts a newly added campaign banner before the closing CTA", () => {
    const saved = [...DEFAULT_SECTION_ORDER];

    const resolved = resolveSectionOrder(saved, [
      ...SEEDED_BANNERS,
      "banner-added-in-cms",
    ]);

    const added = `${CAMPAIGN_SECTION_PREFIX}banner-added-in-cms`;
    expect(resolved).toContain(added);
    expect(resolved.indexOf(added)).toBe(resolved.indexOf("footerCta") - 1);
    // Deterministic: resolving the same input twice gives the same page.
    expect(resolveSectionOrder(saved, [...SEEDED_BANNERS, "banner-added-in-cms"])).toEqual(
      resolved,
    );
  });

  it("adds sections an older saved order predates without disturbing it", () => {
    // A save from before the group rows, campaigns and trust blocks existed.
    const legacy = [
      "heroMarquee",
      "featuredProducts",
      "categories",
      "newsletter",
      "footerCta",
    ];

    const resolved = resolveSectionOrder(legacy, SEEDED_BANNERS);

    // Every section is present…
    for (const key of ORDERABLE_SECTION_KEYS) expect(resolved).toContain(key);
    expect(resolved).toContain(CAMPAIGN_A);

    // …and the client's own sequence — featured *before* categories, which is
    // the opposite of the default composition — survives intact.
    expect(resolved.filter((k) => legacy.includes(k))).toEqual(legacy);
  });

  it("falls through to the default composition when nothing is saved", () => {
    expect(resolveSectionOrder(undefined, SEEDED_BANNERS)).toEqual(
      DEFAULT_SECTION_ORDER,
    );
  });

  it("carries no group keys when the store has no broad groups", () => {
    // The shipped default cannot name category ids, so the group band is
    // simply absent until the catalogue supplies one.
    expect(DEFAULT_SECTION_ORDER.some((k) => k.startsWith("group:"))).toBe(
      false,
    );
  });
});

/**
 * Broad group sections are addressed dynamically, the way campaign banners
 * already were. These pin the part that is easy to get wrong: a client's saved
 * arrangement is theirs, and a group that appears later has to find a sensible
 * home in it without pushing anything else around.
 */
describe("resolveSectionOrder — dynamic group sections", () => {
  it("interleaves group keys with the static sections as saved", () => {
    const saved = [
      "heroMarquee",
      "categories",
      GROUP_SUPPLEMENTS,
      "featuredProducts",
      GROUP_STACKS,
      "newArrivals",
      "featuredShelf",
      GROUP_GYM_GEAR,
      "discountedProducts",
      "whyMach",
      "certificates",
      "ugc",
      "newsletter",
      "footerCta",
    ];

    expect(resolveSectionOrder(saved, [], GROUPS)).toEqual(saved);
  });

  it("places a newly added group beside the groups already on the page", () => {
    const saved = [
      "heroMarquee",
      "categories",
      GROUP_STACKS,
      "featuredProducts",
      GROUP_GYM_GEAR,
      "footerCta",
    ];

    const resolved = resolveSectionOrder(saved, [], GROUPS);

    // Supplements leads the broad-group selection, so it lands at the head of
    // the group band rather than at the bottom of the page.
    expect(resolved).toContain(GROUP_SUPPLEMENTS);
    expect(resolved.indexOf(GROUP_SUPPLEMENTS)).toBe(
      resolved.indexOf("categories") + 1,
    );
    // The client's own sequence is untouched.
    expect(resolved.filter((k) => saved.includes(k))).toEqual(saved);
  });

  it("inserts a new group deterministically", () => {
    const saved = ["heroMarquee", "categories", GROUP_STACKS, "footerCta"];

    expect(resolveSectionOrder(saved, [], GROUPS)).toEqual(
      resolveSectionOrder(saved, [], GROUPS),
    );
  });

  it("de-duplicates a repeated group key, keeping the first position", () => {
    const resolved = resolveSectionOrder(
      ["heroMarquee", GROUP_STACKS, "featuredProducts", GROUP_STACKS],
      [],
      GROUPS,
    );

    expect(resolved.filter((k) => k === GROUP_STACKS)).toHaveLength(1);
    expect(resolved.indexOf(GROUP_STACKS)).toBeLessThan(
      resolved.indexOf("featuredProducts"),
    );
  });

  it("drops a group key whose category is no longer a broad group", () => {
    const saved = ["heroMarquee", GROUP_STACKS, GROUP_GYM_GEAR, "footerCta"];

    // Gym Gear has been deleted, or taken out of the homepage selection.
    const resolved = resolveSectionOrder(saved, [], [SUPPLEMENTS, STACKS]);

    expect(resolved).not.toContain(GROUP_GYM_GEAR);
    expect(resolved).toContain(GROUP_STACKS);
    // Everything the client arranged around it keeps its relative order.
    expect(resolved.indexOf("heroMarquee")).toBeLessThan(
      resolved.indexOf(GROUP_STACKS),
    );
  });

  it("leaves the campaign banner keys working exactly as before", () => {
    const saved = [
      "heroMarquee",
      CAMPAIGN_A,
      GROUP_STACKS,
      CAMPAIGN_B,
      "footerCta",
    ];

    const resolved = resolveSectionOrder(saved, SEEDED_BANNERS, GROUPS);

    expect(resolved.filter((k) => saved.includes(k))).toEqual(saved);
  });

  it("keeps the four merchandising sections independent of the groups", () => {
    // Best Sellers, New Drops, Featured and Offers are not groups and do not
    // come or go with them.
    const resolved = resolveSectionOrder(undefined, [], []);

    for (const key of [
      "featuredProducts",
      "newArrivals",
      "featuredShelf",
      "discountedProducts",
    ]) {
      expect(resolved).toContain(key);
    }
  });

  it("never leaves the hero in the reorderable list", () => {
    const resolved = resolveSectionOrder(["hero", "heroMarquee"], []);
    expect(resolved).not.toContain("hero");
  });
});
