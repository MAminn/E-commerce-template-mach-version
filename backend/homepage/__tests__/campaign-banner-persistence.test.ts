import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CAMPAIGN_SECTION_PREFIX,
  DEFAULT_HOMEPAGE_CONTENT,
  EMPTY_MEDIA_SLOT,
  MACH_LANDING_TEMPLATE_ID,
  resolveSectionOrder,
  type CampaignBannerContent,
  type HomepageContent,
} from "#root/shared/types/homepage-content";
import {
  addCampaignBanner,
  campaignSectionKey,
  createCampaignBanner,
  patchCampaignBanner,
  patchCampaignBannerMedia,
  removeCampaignBanner,
} from "#root/shared/types/homepage-campaign-banners";
import { mergeHomepageContentWithDefaults } from "../merge-homepage-content";
import { homepageRouter } from "../trpc";

/**
 * The campaign banner chain, end to end, minus the database.
 *
 * Homepage Admin state → the save mutation's Zod schema → what the row would
 * hold → the merge layer every read goes through → the section order the
 * storefront renders from. A campaign banner crosses all five, and a field
 * dropped at any one of them is invisible until the client reloads and finds
 * their work gone — which is the class of fault this suite exists to catch.
 *
 * The schema is pulled off the real router rather than re-declared, so a
 * banner field added to the type and forgotten in the mutation fails here
 * instead of in production.
 */

const MERCHANT_ID = "00000000-0000-0000-0000-000000000000";

const updateContentInput = (
  homepageRouter as unknown as {
    _def: {
      procedures: {
        updateContent: { _def: { inputs: z.ZodTypeAny[] } };
      };
    };
  }
)._def.procedures.updateContent._def.inputs[0] as z.ZodTypeAny;

/** Everything the save mutation does to content, and nothing else. */
function save(content: HomepageContent): HomepageContent {
  const parsed = updateContentInput.safeParse({
    merchantId: MERCHANT_ID,
    templateId: MACH_LANDING_TEMPLATE_ID,
    content,
  });
  if (!parsed.success) {
    throw new Error(
      `save rejected: ${JSON.stringify(parsed.error.issues, null, 2)}`,
    );
  }
  // The row is jsonb; round-tripping through JSON is what actually happens to
  // the blob between the mutation and the next read.
  return JSON.parse(
    JSON.stringify((parsed.data as { content: HomepageContent }).content),
  ) as HomepageContent;
}

/** A save followed by the read path Homepage Admin and SSR both use. */
function saveAndReload(content: HomepageContent): HomepageContent {
  return mergeHomepageContentWithDefaults(
    save(content) as Partial<HomepageContent>,
    MACH_LANDING_TEMPLATE_ID,
  );
}

function configuredBanner(id: string): CampaignBannerContent {
  return {
    ...createCampaignBanner(id),
    media: {
      ...EMPTY_MEDIA_SLOT,
      desktopUrl: "/uploads/homepage/campaign-desktop.webp",
      mobileUrl: "/uploads/homepage/campaign-mobile.webp",
      alt: "Athlete mid-lift",
      focalPoint: { x: 40, y: 65 },
    },
    eyebrow: "NEW SEASON",
    title: "SUMMER DROP",
    body: "The full range, restocked.",
    ctaText: "Shop the drop",
    ctaLink: "/shop",
    align: "center",
    verticalAlign: "middle",
    textTheme: "dark",
    overlayOpacity: 70,
    height: "tall",
  };
}

/* ================================================================== */
/*  Shape survives the save                                           */
/* ================================================================== */

describe("campaign banners survive the save path", () => {
  it("accepts a fully-configured banner and keeps every field", () => {
    const content: HomepageContent = {
      ...DEFAULT_HOMEPAGE_CONTENT,
      campaignBanners: [configuredBanner("campaign-ab12cd34")],
    };

    const saved = save(content);

    expect(saved.campaignBanners?.[0]).toEqual(
      configuredBanner("campaign-ab12cd34"),
    );
  });

  it("keeps a banner the client added through the admin", () => {
    const added = addCampaignBanner(
      { ...DEFAULT_HOMEPAGE_CONTENT, campaignBanners: [] },
      () => "campaign-ab12cd34",
    );

    const reloaded = saveAndReload(added);

    expect(reloaded.campaignBanners?.map((b) => b.id)).toEqual([
      "campaign-ab12cd34",
    ]);
  });

  it("keeps an empty banner list empty instead of restoring the seeds", () => {
    // Deleting every banner is a decision, not missing data. The merge layer
    // only falls back to the shipped pair when the key has never been saved.
    const reloaded = saveAndReload({
      ...DEFAULT_HOMEPAGE_CONTENT,
      campaignBanners: [],
    });

    expect(reloaded.campaignBanners).toEqual([]);
  });

  it("seeds the shipped banners for content that predates the field", () => {
    const { campaignBanners: _dropped, ...withoutBanners } =
      DEFAULT_HOMEPAGE_CONTENT;

    const reloaded = mergeHomepageContentWithDefaults(
      withoutBanners as Partial<HomepageContent>,
      MACH_LANDING_TEMPLATE_ID,
    );

    expect(reloaded.campaignBanners?.map((b) => b.id)).toEqual([
      "campaign-primary",
      "campaign-secondary",
    ]);
  });
});

/* ================================================================== */
/*  Backward compatibility                                            */
/* ================================================================== */

describe("existing saved banners stay readable", () => {
  it("fills in options a banner saved before they existed has no value for", () => {
    // A blob from before alignment, theme, overlay and height were options.
    const legacy = {
      ...DEFAULT_HOMEPAGE_CONTENT,
      campaignBanners: [
        {
          id: "campaign-primary",
          enabled: true,
          title: "LEGACY",
          media: {
            kind: "image" as const,
            desktopUrl: "/uploads/homepage/legacy.webp",
          },
        },
      ],
    } as unknown as HomepageContent;

    const reloaded = saveAndReload(legacy);
    const banner = reloaded.campaignBanners?.[0];

    expect(banner?.title).toBe("LEGACY");
    expect(banner?.media?.desktopUrl).toBe("/uploads/homepage/legacy.webp");
    // Defaults come from the shipped banner of the same id, so nothing is
    // undefined at render time.
    expect(banner?.align).toBe("left");
    expect(banner?.textTheme).toBe("light");
    expect(banner?.overlayOpacity).toBe(45);
    expect(banner?.height).toBe("standard");
  });

  it("does not force a client-added banner onto the seeded defaults", () => {
    const content = patchCampaignBanner(
      addCampaignBanner(
        { ...DEFAULT_HOMEPAGE_CONTENT, campaignBanners: [] },
        () => "campaign-ab12cd34",
      ),
      "campaign-ab12cd34",
      { align: "right", height: "tall" },
    );

    const reloaded = saveAndReload(content);

    expect(reloaded.campaignBanners?.[0]?.align).toBe("right");
    expect(reloaded.campaignBanners?.[0]?.height).toBe("tall");
  });

  it("keeps a cleared optional field cleared", () => {
    const content = patchCampaignBanner(
      {
        ...DEFAULT_HOMEPAGE_CONTENT,
        campaignBanners: [configuredBanner("campaign-ab12cd34")],
      },
      "campaign-ab12cd34",
      { eyebrow: "", body: "" },
    );

    const reloaded = saveAndReload(content);

    expect(reloaded.campaignBanners?.[0]?.eyebrow).toBe("");
    expect(reloaded.campaignBanners?.[0]?.body).toBe("");
  });
});

/* ================================================================== */
/*  Media                                                             */
/* ================================================================== */

describe("campaign media reaches the storefront", () => {
  it("persists desktop and mobile assets, alt text and focal point", () => {
    const reloaded = saveAndReload({
      ...DEFAULT_HOMEPAGE_CONTENT,
      campaignBanners: [configuredBanner("campaign-ab12cd34")],
    });

    expect(reloaded.campaignBanners?.[0]?.media).toEqual({
      kind: "image",
      desktopUrl: "/uploads/homepage/campaign-desktop.webp",
      mobileUrl: "/uploads/homepage/campaign-mobile.webp",
      posterUrl: "",
      alt: "Athlete mid-lift",
      focalPoint: { x: 40, y: 65 },
    });
  });

  it("persists a desktop-only slot, which the renderer falls back on for mobile", () => {
    const content = patchCampaignBannerMedia(
      {
        ...DEFAULT_HOMEPAGE_CONTENT,
        campaignBanners: [createCampaignBanner("campaign-ab12cd34")],
      },
      "campaign-ab12cd34",
      { desktopUrl: "/uploads/homepage/only-desktop.webp" },
    );

    const reloaded = saveAndReload(content);
    const media = reloaded.campaignBanners?.[0]?.media;

    expect(media?.desktopUrl).toBe("/uploads/homepage/only-desktop.webp");
    expect(media?.mobileUrl ?? "").toBe("");
  });

  it("persists a video slot with its poster frame", () => {
    const content = patchCampaignBannerMedia(
      {
        ...DEFAULT_HOMEPAGE_CONTENT,
        campaignBanners: [createCampaignBanner("campaign-ab12cd34")],
      },
      "campaign-ab12cd34",
      {
        kind: "video",
        desktopUrl: "/uploads/homepage/campaign.mp4",
        posterUrl: "/uploads/homepage/poster.webp",
      },
    );

    const reloaded = saveAndReload(content);

    expect(reloaded.campaignBanners?.[0]?.media).toMatchObject({
      kind: "video",
      desktopUrl: "/uploads/homepage/campaign.mp4",
      posterUrl: "/uploads/homepage/poster.webp",
    });
  });
});

/* ================================================================== */
/*  Section order                                                     */
/* ================================================================== */

describe("campaign banners in section order", () => {
  const order = (content: HomepageContent) =>
    resolveSectionOrder(
      content.sectionOrder,
      (content.campaignBanners ?? []).map((b) => b.id),
      [],
    );

  it("gives a new banner exactly one row", () => {
    const content = saveAndReload(
      addCampaignBanner(
        { ...DEFAULT_HOMEPAGE_CONTENT, campaignBanners: [] },
        () => "campaign-ab12cd34",
      ),
    );

    const rows = order(content).filter((k) =>
      k.startsWith(CAMPAIGN_SECTION_PREFIX),
    );

    expect(rows).toEqual([`${CAMPAIGN_SECTION_PREFIX}campaign-ab12cd34`]);
  });

  it("lets two banners coexist with distinct keys", () => {
    let content: HomepageContent = {
      ...DEFAULT_HOMEPAGE_CONTENT,
      campaignBanners: [],
    };
    content = addCampaignBanner(content, () => "campaign-one");
    content = addCampaignBanner(content, () => "campaign-two");

    const keys = order(saveAndReload(content)).filter((k) =>
      k.startsWith(CAMPAIGN_SECTION_PREFIX),
    );

    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it("keeps a banner placed between two product sections there", () => {
    const placed: string[] = [
      "categories",
      "featuredProducts",
      `${CAMPAIGN_SECTION_PREFIX}campaign-one`,
      "newArrivals",
      "featuredShelf",
      "discountedProducts",
      "whyMach",
      "certificates",
      "ugc",
      "newsletter",
      "footerCta",
      "heroMarquee",
    ];
    const content: HomepageContent = {
      ...DEFAULT_HOMEPAGE_CONTENT,
      campaignBanners: [configuredBanner("campaign-one")],
      sectionOrder: placed,
    };

    const reloaded = saveAndReload(content);
    const resolved = order(reloaded);

    expect(resolved.indexOf(`${CAMPAIGN_SECTION_PREFIX}campaign-one`)).toBe(
      resolved.indexOf("featuredProducts") + 1,
    );
    expect(resolved.indexOf("newArrivals")).toBe(
      resolved.indexOf(`${CAMPAIGN_SECTION_PREFIX}campaign-one`) + 1,
    );
  });

  it("does not move a banner when its copy is edited", () => {
    const content: HomepageContent = {
      ...DEFAULT_HOMEPAGE_CONTENT,
      campaignBanners: [configuredBanner("campaign-one")],
      sectionOrder: [
        "categories",
        `${CAMPAIGN_SECTION_PREFIX}campaign-one`,
        "featuredProducts",
        "footerCta",
      ],
    };
    const before = order(saveAndReload(content));

    const renamed = patchCampaignBanner(content, "campaign-one", {
      title: "A COMPLETELY DIFFERENT HEADLINE",
      eyebrow: "AND EYEBROW",
    });

    expect(order(saveAndReload(renamed))).toEqual(before);
  });

  it("keeps a disabled banner's position and every other section's", () => {
    const content: HomepageContent = {
      ...DEFAULT_HOMEPAGE_CONTENT,
      campaignBanners: [configuredBanner("campaign-one")],
      sectionOrder: [
        "categories",
        `${CAMPAIGN_SECTION_PREFIX}campaign-one`,
        "featuredProducts",
        "footerCta",
      ],
    };
    const before = order(saveAndReload(content));

    const disabled = patchCampaignBanner(content, "campaign-one", {
      enabled: false,
    });

    // Hiding a banner must not cost it its place — re-enabling has to bring it
    // back exactly where the client left it.
    expect(order(saveAndReload(disabled))).toEqual(before);
    const reEnabled = patchCampaignBanner(disabled, "campaign-one", {
      enabled: true,
    });
    expect(order(saveAndReload(reEnabled))).toEqual(before);
  });

  it("clears a deleted banner's key out of stored content", () => {
    const content: HomepageContent = {
      ...DEFAULT_HOMEPAGE_CONTENT,
      campaignBanners: [
        configuredBanner("campaign-one"),
        configuredBanner("campaign-two"),
      ],
      sectionOrder: [
        "categories",
        `${CAMPAIGN_SECTION_PREFIX}campaign-one`,
        "featuredProducts",
        `${CAMPAIGN_SECTION_PREFIX}campaign-two`,
        "footerCta",
      ],
    };

    const reloaded = saveAndReload(
      removeCampaignBanner(content, "campaign-one"),
    );

    expect(reloaded.sectionOrder).not.toContain(
      campaignSectionKey("campaign-one"),
    );
    expect(reloaded.sectionOrder).toContain(campaignSectionKey("campaign-two"));
    expect(order(reloaded)).not.toContain(campaignSectionKey("campaign-one"));
  });

  it("drops a stale key left behind by older stored content", () => {
    // Content saved before deletion pruned the order — the resolver has always
    // been the backstop and must stay one.
    const content: HomepageContent = {
      ...DEFAULT_HOMEPAGE_CONTENT,
      campaignBanners: [configuredBanner("campaign-two")],
      sectionOrder: [
        "categories",
        `${CAMPAIGN_SECTION_PREFIX}campaign-gone`,
        `${CAMPAIGN_SECTION_PREFIX}campaign-two`,
        "footerCta",
      ],
    };

    expect(order(saveAndReload(content))).not.toContain(
      `${CAMPAIGN_SECTION_PREFIX}campaign-gone`,
    );
  });
});

/* ================================================================== */
/*  Non-Mach safety                                                   */
/* ================================================================== */

describe("the legacy promo banner is untouched", () => {
  it("keeps promoBanner content saved against a non-Mach template", () => {
    const content: HomepageContent = {
      ...DEFAULT_HOMEPAGE_CONTENT,
      promoBanner: {
        enabled: true,
        text: "Free shipping over EGP 1500",
        linkText: "Shop now",
        linkUrl: "/shop",
      },
    };

    const reloaded = mergeHomepageContentWithDefaults(
      save(content) as Partial<HomepageContent>,
      "landing-modern",
    );

    expect(reloaded.promoBanner).toEqual({
      enabled: true,
      text: "Free shipping over EGP 1500",
      linkText: "Shop now",
      linkUrl: "/shop",
    });
  });

  it("keeps promoBanner alongside campaign banners on Mach", () => {
    // Two different features in one blob: the one-line announcement bar above
    // the navbar and the full-bleed banners between product rows. Saving one
    // must never disturb the other.
    const content: HomepageContent = {
      ...DEFAULT_HOMEPAGE_CONTENT,
      promoBanner: {
        enabled: true,
        text: "Kept for the templates that use it",
        linkText: "Shop",
        linkUrl: "/shop",
      },
      campaignBanners: [configuredBanner("campaign-one")],
    };

    const reloaded = saveAndReload(content);

    expect(reloaded.promoBanner.text).toBe("Kept for the templates that use it");
    expect(reloaded.promoBanner.enabled).toBe(true);
  });

  it("does not put the promo strip into section order", () => {
    // `promoBanner` is chrome on the templates that render it, not an
    // orderable homepage section — confusing the two is what started this.
    const resolved = resolveSectionOrder(undefined, [], []);

    expect(resolved).not.toContain("promoBanner");
    expect(resolved).toContain("heroMarquee");
  });
});
