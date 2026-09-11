import { describe, it, expect } from "vitest";
import {
  CAMPAIGN_SECTION_PREFIX,
  DEFAULT_SECTION_ORDER,
  ORDERABLE_SECTION_KEYS,
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

describe("resolveSectionOrder", () => {
  it("preserves a complete custom order exactly", () => {
    const custom = [
      "heroMarquee",
      "whyMach",
      "featuredProducts",
      "gymGear",
      "newsletter",
      "categories",
      "stacks",
      "newArrivals",
      CAMPAIGN_A,
      "discountedProducts",
      CAMPAIGN_B,
      "certificates",
      "ugc",
      "footerCta",
    ];

    expect(resolveSectionOrder(custom, SEEDED_BANNERS)).toEqual(custom);
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

  it("never leaves the hero in the reorderable list", () => {
    const resolved = resolveSectionOrder(["hero", "heroMarquee"], []);
    expect(resolved).not.toContain("hero");
  });
});
