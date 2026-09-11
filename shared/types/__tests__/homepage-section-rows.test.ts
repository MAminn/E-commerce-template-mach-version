import { describe, it, expect } from "vitest";
import {
  CAMPAIGN_SECTION_PREFIX,
  DEFAULT_HOMEPAGE_CONTENT,
  type CampaignBannerContent,
  type HomepageContent,
} from "../homepage-content";
import { describeSectionRows } from "../homepage-section-rows";
import {
  resolveGroupSections,
  type BroadGroupCategory,
} from "../homepage-group-sections";

/**
 * The reorder list is the client's only view of the page composition, so what
 * it says about a section has to be what the storefront does with it.
 */

/** A content blob built from the shipped defaults, patched for one case. */
function content(patch: Partial<HomepageContent> = {}): HomepageContent {
  return { ...DEFAULT_HOMEPAGE_CONTENT, ...patch } as HomepageContent;
}

function row(
  key: string,
  c: HomepageContent,
  groups: BroadGroupCategory[] = [],
) {
  const found = describeSectionRows([key], c, resolveGroupSections(c, groups))[0];
  if (!found) throw new Error(`no row for ${key}`);
  return found;
}

const SUPPLEMENTS_ID = "01a06245-5bed-73ea-b81d-eebe1c7721a4";
const STACKS_ID = "01a06cc1-36ba-75cb-8353-5968a3889e70";
const GYM_GEAR_ID = "01a06cc1-55a5-759e-a04b-f25cdc6ad5ff";

const GROUPS: BroadGroupCategory[] = [
  { id: SUPPLEMENTS_ID, name: "Supplements", slug: "supplements" },
  { id: STACKS_ID, name: "Stacks & Bundles", slug: "stacks-bundles" },
  { id: GYM_GEAR_ID, name: "Gym Gear", slug: "gym-gear" },
];

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
  it("names a row after the section, not after its current heading", () => {
    // The renamed heading is reported, but as what it is — an override. A list
    // that renamed itself is how Best Sellers came to be doing duty as three
    // different sections without anyone being able to see it.
    const renamed = content({
      featuredProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
        title: "BUNDLES & STACKS",
      },
    });

    expect(row("featuredProducts", renamed)).toMatchObject({
      label: "Best Sellers",
      meta: "Storefront heading: BUNDLES & STACKS",
    });
  });

  it("omits the override line when the heading was not renamed", () => {
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
      label: "New Drops",
      meta: undefined,
    });
  });

  it("keeps the section's name when the heading is blank", () => {
    const blank = content({
      newArrivals: { ...DEFAULT_HOMEPAGE_CONTENT.newArrivals!, title: "  " },
    });

    expect(row("newArrivals", blank)).toMatchObject({
      label: "New Drops",
      meta: undefined,
    });
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

  it("reports a group section as Enabled, never Visible", () => {
    // A group fills itself from a catalogue query, so a perfectly valid
    // configuration can still put nothing on the page. Claiming Visible here
    // would rebuild the misdirection this model replaced, one word along.
    const c = content({
      groupSections: [{ categoryId: STACKS_ID, enabled: true }],
    });

    expect(row(`group:${STACKS_ID}`, c, GROUPS).status).toBe("enabled");
  });

  it("reports a group section that is switched off as Off", () => {
    const c = content({
      groupSections: [{ categoryId: STACKS_ID, enabled: false }],
    });

    expect(row(`group:${STACKS_ID}`, c, GROUPS).status).toBe("off");
  });

  it("reports a group nobody has configured as Off", () => {
    expect(row(`group:${SUPPLEMENTS_ID}`, content(), GROUPS).status).toBe("off");
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
    // These resolve their contents at page load — the category band from the
    // catalogue, the curated shelves from the products the client picked — so
    // Homepage Admin cannot prove anything renders. Claiming "Visible" here
    // would be the same misdirection as the old "On" badge.
    const on = content({
      categories: { ...DEFAULT_HOMEPAGE_CONTENT.categories, enabled: true },
      featuredProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
        enabled: true,
        productIds: ["p-1"],
      },
      newArrivals: {
        ...DEFAULT_HOMEPAGE_CONTENT.newArrivals!,
        enabled: true,
        productIds: ["p-2"],
      },
      discountedProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.discountedProducts!,
        enabled: true,
        productIds: ["p-3"],
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

/**
 * Section Order is the client's structural map of the page. These pin the two
 * properties that make it one: a row is named after what the section *is*, and
 * the four merchandising sections are four sections rather than one section
 * wearing different headings.
 */
describe("describeSectionRows — group sections", () => {
  it("names a group row after its category", () => {
    const c = content({
      groupSections: [{ categoryId: GYM_GEAR_ID, enabled: true }],
    });

    expect(row(`group:${GYM_GEAR_ID}`, c, GROUPS)).toMatchObject({
      label: "Gym Gear",
      meta: undefined,
    });
  });

  it("keeps the category's name when the storefront heading is overridden", () => {
    const c = content({
      groupSections: [
        { categoryId: GYM_GEAR_ID, enabled: true, title: "EQUIPMENT" },
      ],
    });

    // Primary name is the identity; the override is secondary metadata. Never
    // the other way round — that is how a group stops being findable here.
    expect(row(`group:${GYM_GEAR_ID}`, c, GROUPS)).toMatchObject({
      label: "Gym Gear",
      meta: "Storefront heading: EQUIPMENT",
    });
  });

  it("does not report the shipped caps heading as an override", () => {
    const c = content({
      groupSections: [
        { categoryId: STACKS_ID, enabled: true, title: "STACKS & BUNDLES" },
      ],
    });

    expect(row(`group:${STACKS_ID}`, c, GROUPS).meta).toBeUndefined();
  });

  it("lists every broad group as its own row, alongside the merchandising ones", () => {
    const c = content({
      groupSections: [
        { categoryId: SUPPLEMENTS_ID, enabled: true },
        { categoryId: STACKS_ID, enabled: true },
        { categoryId: GYM_GEAR_ID, enabled: true },
      ],
    });

    const rows = describeSectionRows(
      [
        `group:${SUPPLEMENTS_ID}`,
        `group:${STACKS_ID}`,
        `group:${GYM_GEAR_ID}`,
        "featuredProducts",
        "newArrivals",
        "featuredShelf",
        "discountedProducts",
      ],
      c,
      resolveGroupSections(c, GROUPS),
    );

    expect(rows.map((r) => r.label)).toEqual([
      "Supplements",
      "Stacks & Bundles",
      "Gym Gear",
      "Best Sellers",
      "New Drops",
      "Featured",
      "Offers",
    ]);
  });
});

describe("describeSectionRows — Featured", () => {
  it("is its own row, not a renamed Best Sellers", () => {
    expect(row("featuredShelf", content()).label).toBe("Featured");
    expect(row("featuredProducts", content()).label).toBe("Best Sellers");
  });

  it("reports every curated shelf with nothing picked as No source", () => {
    // All four are hand-curated now, so "enabled but empty" is knowable here
    // and means the row renders nothing — it is not a runtime unknown.
    const c = content({
      featuredProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
        enabled: true,
        productIds: [],
      },
      newArrivals: {
        ...DEFAULT_HOMEPAGE_CONTENT.newArrivals!,
        enabled: true,
        productIds: [],
      },
      featuredShelf: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredShelf!,
        enabled: true,
        productIds: [],
      },
      discountedProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.discountedProducts!,
        enabled: true,
        productIds: [],
      },
    });

    for (const key of [
      "featuredProducts",
      "newArrivals",
      "featuredShelf",
      "discountedProducts",
    ]) {
      expect(row(key, c).status).toBe("no-source");
      expect(row(key, c).hint).toBe(
        "Enabled, but no products have been selected for this section.",
      );
    }
  });

  it("reports a curated shelf with a selection as Enabled, never Visible", () => {
    // A selection is still not a guarantee: the products behind it can be
    // unpublished by the time the page loads.
    const c = content({
      newArrivals: {
        ...DEFAULT_HOMEPAGE_CONTENT.newArrivals!,
        enabled: true,
        productIds: ["p-1"],
      },
    });

    expect(row("newArrivals", c).status).toBe("enabled");
  });

  it("still reports a switched-off curated shelf as Off", () => {
    const c = content({
      discountedProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.discountedProducts!,
        enabled: false,
        productIds: ["p-1"],
      },
    });

    expect(row("discountedProducts", c).status).toBe("off");
  });

  it("leaves group statuses alone", () => {
    // Groups are category-driven, so "no products picked" is not a state they
    // have. They stay Off / Enabled.
    const c = content({
      groupSections: [{ categoryId: STACKS_ID, enabled: true }],
    });

    expect(row(`group:${STACKS_ID}`, c, GROUPS).status).toBe("enabled");
  });

  it("switches independently of Best Sellers and New Drops", () => {
    const c = content({
      featuredShelf: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredShelf!,
        enabled: true,
        productIds: ["p-1"],
      },
      featuredProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
        enabled: false,
      },
      newArrivals: { ...DEFAULT_HOMEPAGE_CONTENT.newArrivals!, enabled: false },
    });

    expect(row("featuredShelf", c).status).toBe("enabled");
    expect(row("featuredProducts", c).status).toBe("off");
    expect(row("newArrivals", c).status).toBe("off");
  });

  it("holds its own selection rather than borrowing another section's", () => {
    const c = content({
      featuredShelf: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredShelf!,
        enabled: true,
        productIds: ["featured-1"],
      },
      featuredProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
        enabled: true,
        productIds: ["bestseller-1"],
      },
    });

    expect(c.featuredShelf!.productIds).toEqual(["featured-1"]);
    expect(c.featuredProducts.productIds).toEqual(["bestseller-1"]);
    // Emptying Featured says nothing about Best Sellers.
    const emptied = content({
      ...c,
      featuredShelf: { ...c.featuredShelf!, productIds: [] },
    });
    expect(row("featuredShelf", emptied).status).toBe("no-source");
    expect(row("featuredProducts", emptied).status).toBe("enabled");
  });

  it("says No source when it is on with nothing picked", () => {
    // The one merchandising shelf whose emptiness is knowable in the CMS: it
    // is hand-picked by definition, so there is no query that could fill it.
    const c = content({
      featuredShelf: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredShelf!,
        enabled: true,
        productIds: [],
      },
    });

    expect(row("featuredShelf", c).status).toBe("no-source");
    expect(row("featuredShelf", c).hint).toBeTruthy();
  });

  it("does not disturb Offers, which stays independent too", () => {
    const c = content({
      featuredShelf: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredShelf!,
        enabled: true,
        productIds: ["featured-1"],
      },
      discountedProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.discountedProducts!,
        enabled: true,
        productIds: ["offer-1"],
      },
    });

    expect(row("discountedProducts", c).status).toBe("enabled");
    expect(row("discountedProducts", c).label).toBe("Offers");
    // Neither shelf borrows the other's list.
    expect(c.discountedProducts!.productIds).toEqual(["offer-1"]);
    expect(c.featuredShelf!.productIds).toEqual(["featured-1"]);
  });
});
