import { describe, it, expect } from "vitest";
import {
  CAMPAIGN_SECTION_PREFIX,
  DEFAULT_HOMEPAGE_CONTENT,
  type CampaignBannerContent,
  type HomepageContent,
} from "../homepage-content";
import { describeSectionRows } from "../homepage-section-rows";

/**
 * The reorder list is the client's only view of the page composition, so what
 * it says about a section has to be what the storefront does with it.
 */

/** A content blob built from the shipped defaults, patched for one case. */
function content(patch: Partial<HomepageContent> = {}): HomepageContent {
  return { ...DEFAULT_HOMEPAGE_CONTENT, ...patch } as HomepageContent;
}

function row(key: string, c: HomepageContent) {
  const found = describeSectionRows([key], c)[0];
  if (!found) throw new Error(`no row for ${key}`);
  return found;
}

function banner(patch: Partial<CampaignBannerContent>): CampaignBannerContent {
  return {
    id: "banner-1",
    enabled: true,
    title: "",
    media: { kind: "image", desktopUrl: "", mobileUrl: "" },
    ...patch,
  };
}

describe("describeSectionRows — labels", () => {
  it("names a row after the heading on the storefront", () => {
    const renamed = content({
      featuredProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
        title: "BUNDLES & STACKS",
      },
    });

    expect(row("featuredProducts", renamed)).toMatchObject({
      label: "BUNDLES & STACKS",
      meta: "Best Sellers section",
    });
  });

  it("omits the internal reminder when the heading was not renamed", () => {
    const untouched = content({
      featuredProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
        title: "Best Sellers",
      },
    });

    expect(row("featuredProducts", untouched).meta).toBeUndefined();
  });

  it("does not treat the shipped all-caps headings as renames", () => {
    // DEFAULT_HOMEPAGE_CONTENT ships "NEW DROPS" against the internal "New
    // Drops"; a reminder line on every row would bury the real renames.
    const shipped = content();

    expect(row("newArrivals", shipped)).toMatchObject({
      label: "NEW DROPS",
      meta: undefined,
    });
  });

  it("falls back to the internal name when the heading is blank", () => {
    const blank = content({
      newArrivals: { ...DEFAULT_HOMEPAGE_CONTENT.newArrivals!, title: "  " },
    });

    expect(row("newArrivals", blank).label).toBe("New Drops");
  });

  it("keeps the promotional strip concise and previews its text", () => {
    const strip = content({
      heroMarquee: {
        ...DEFAULT_HOMEPAGE_CONTENT.heroMarquee!,
        text: "FREE SHIPPING OVER 1500 EGP",
      },
    });

    expect(row("heroMarquee", strip)).toMatchObject({
      label: "Promotional strip",
      meta: "FREE SHIPPING OVER 1500 EGP",
    });
  });

  it("numbers untitled campaign banners so they are tellable apart", () => {
    const c = content({
      campaignBanners: [
        banner({ id: "a" }),
        banner({ id: "b" }),
        banner({ id: "c", title: "Ramadan drop" }),
      ],
    });

    const rows = describeSectionRows(
      ["a", "b", "c"].map((id) => `${CAMPAIGN_SECTION_PREFIX}${id}`),
      c,
    );

    expect(rows.map((r) => r.label)).toEqual([
      "Campaign banner 1",
      "Campaign banner 2",
      "Ramadan drop",
    ]);
    expect(rows[2]?.meta).toBe("Campaign banner");
  });
});

describe("describeSectionRows — status", () => {
  it("reports a disabled section as Off", () => {
    const off = content({
      whyMach: { ...DEFAULT_HOMEPAGE_CONTENT.whyMach!, enabled: false },
    });

    expect(row("whyMach", off).status).toBe("off");
  });

  it("reports an enabled campaign with no artwork as Missing media", () => {
    const c = content({ campaignBanners: [banner({ id: "a" })] });

    expect(row(`${CAMPAIGN_SECTION_PREFIX}a`, c).status).toBe("missing-media");
  });

  it("reports an enabled campaign with artwork as Visible", () => {
    const c = content({
      campaignBanners: [
        banner({
          id: "a",
          media: { kind: "image", desktopUrl: "/uploads/campaign.jpg" },
        }),
      ],
    });

    expect(row(`${CAMPAIGN_SECTION_PREFIX}a`, c).status).toBe("visible");
  });

  it("reports a disabled campaign as Off even without artwork", () => {
    const c = content({
      campaignBanners: [banner({ id: "a", enabled: false })],
    });

    expect(row(`${CAMPAIGN_SECTION_PREFIX}a`, c).status).toBe("off");
  });

  it("reports a group row with nothing selected as No source", () => {
    const c = content({
      stacks: {
        ...DEFAULT_HOMEPAGE_CONTENT.stacks!,
        enabled: true,
        productIds: [],
        categoryIds: [],
      },
      gymGear: {
        ...DEFAULT_HOMEPAGE_CONTENT.gymGear!,
        enabled: true,
        productIds: undefined,
        categoryIds: undefined,
      },
    });

    expect(row("stacks", c).status).toBe("no-source");
    expect(row("gymGear", c).status).toBe("no-source");
  });

  it("reports a group row with a selected source as Enabled, not Visible", () => {
    const byProduct = content({
      stacks: {
        ...DEFAULT_HOMEPAGE_CONTENT.stacks!,
        enabled: true,
        productIds: ["p1"],
      },
    });
    const byCategory = content({
      gymGear: {
        ...DEFAULT_HOMEPAGE_CONTENT.gymGear!,
        enabled: true,
        categoryIds: ["c1"],
      },
    });

    // A selected source can still resolve to zero products at runtime, so the
    // CMS must not promise that the row appears.
    expect(row("stacks", byProduct).status).toBe("enabled");
    expect(row("gymGear", byCategory).status).toBe("enabled");
  });

  it("reports enabled Community as Not available yet, never Visible", () => {
    const on = content({
      ugc: { ...DEFAULT_HOMEPAGE_CONTENT.ugc!, enabled: true },
    });
    const off = content({
      ugc: { ...DEFAULT_HOMEPAGE_CONTENT.ugc!, enabled: false },
    });

    expect(row("ugc", on).status).toBe("unavailable");
    expect(row("ugc", off).status).toBe("off");
  });

  it("reports an enabled but wordless promotional strip as Empty", () => {
    const c = content({
      heroMarquee: {
        ...DEFAULT_HOMEPAGE_CONTENT.heroMarquee!,
        enabled: true,
        text: "   ",
      },
    });

    expect(row("heroMarquee", c).status).toBe("empty");
  });

  it("reports certificates with no documents and no factory note as Empty", () => {
    const base = DEFAULT_HOMEPAGE_CONTENT.certificates!;
    const bare = content({
      certificates: {
        ...base,
        enabled: true,
        items: [],
        factory: { ...base.factory, enabled: false, heading: "", body: "" },
      },
    });
    const withFactory = content({
      certificates: {
        ...base,
        enabled: true,
        items: [],
        factory: {
          ...base.factory,
          enabled: true,
          heading: "Made in Egypt",
          body: "",
        },
      },
    });

    expect(row("certificates", bare).status).toBe("empty");
    expect(row("certificates", withFactory).status).toBe("visible");
  });

  it("says Enabled, never Visible, for sections filled by a runtime query", () => {
    // These four resolve their contents from the catalogue at page load, so
    // Homepage Admin cannot prove anything renders. Claiming "Visible" here
    // would be the same misdirection as the old "On" badge.
    const on = content({
      categories: { ...DEFAULT_HOMEPAGE_CONTENT.categories, enabled: true },
      featuredProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
        enabled: true,
      },
      newArrivals: { ...DEFAULT_HOMEPAGE_CONTENT.newArrivals!, enabled: true },
      discountedProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.discountedProducts!,
        enabled: true,
      },
    });

    for (const key of [
      "categories",
      "featuredProducts",
      "newArrivals",
      "discountedProducts",
    ]) {
      expect(row(key, on).status).toBe("enabled");
    }
  });

  it("still says Off for those sections when the switch is off", () => {
    const off = content({
      categories: { ...DEFAULT_HOMEPAGE_CONTENT.categories, enabled: false },
      featuredProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
        enabled: false,
      },
      newArrivals: { ...DEFAULT_HOMEPAGE_CONTENT.newArrivals!, enabled: false },
      discountedProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.discountedProducts!,
        enabled: false,
      },
    });

    for (const key of [
      "categories",
      "featuredProducts",
      "newArrivals",
      "discountedProducts",
    ]) {
      expect(row(key, off).status).toBe("off");
    }
  });

  it("reserves Visible for sections it can check the way the storefront does", () => {
    // Each of these evaluates the storefront's own render condition here, so
    // the claim is safe to make.
    const c = content({
      heroMarquee: {
        ...DEFAULT_HOMEPAGE_CONTENT.heroMarquee!,
        enabled: true,
        text: "FREE SHIPPING",
      },
      whyMach: { ...DEFAULT_HOMEPAGE_CONTENT.whyMach!, enabled: true },
      newsletter: { ...DEFAULT_HOMEPAGE_CONTENT.newsletter, enabled: true },
      footerCta: { ...DEFAULT_HOMEPAGE_CONTENT.footerCta, enabled: true },
    });

    for (const key of ["heroMarquee", "whyMach", "newsletter", "footerCta"]) {
      expect(row(key, c).status).toBe("visible");
    }
  });

  it("explains every status that is not Visible", () => {
    const c = content({
      ugc: { ...DEFAULT_HOMEPAGE_CONTENT.ugc!, enabled: true },
      newsletter: { ...DEFAULT_HOMEPAGE_CONTENT.newsletter, enabled: false },
      campaignBanners: [banner({ id: "a" })],
    });

    const rows = describeSectionRows(
      ["ugc", "newsletter", `${CAMPAIGN_SECTION_PREFIX}a`, "footerCta"],
      c,
    );

    for (const r of rows) {
      if (r.status === "visible") expect(r.hint).toBeUndefined();
      else expect(r.hint).toBeTruthy();
    }
  });
});
