import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_SECTION_PREFIX,
  DEFAULT_HOMEPAGE_CONTENT,
  EMPTY_MEDIA_SLOT,
  resolveSectionOrder,
  type CampaignBannerContent,
  type HomepageContent,
} from "../homepage-content";
import {
  CAMPAIGN_BANNER_STATUS_LABELS,
  addCampaignBanner,
  campaignBannerCtaHref,
  campaignBannerStatus,
  campaignSectionKey,
  createCampaignBanner,
  isUnsafeLink,
  patchCampaignBanner,
  patchCampaignBannerMedia,
  removeCampaignBanner,
} from "../homepage-campaign-banners";
import { describeSectionRows } from "../homepage-section-rows";

/**
 * Regression cover for the campaign banner repair.
 *
 * The defects these pin down are the ones the chain actually had, not a
 * generic sweep:
 *
 *  1. Homepage Admin computed each banner edit from the array it had last
 *     rendered and committed it into current state, so an asynchronous media
 *     upload landing seconds later overwrote everything saved in between —
 *     including a second upload into a different sub-slot.
 *  2. Deleting a banner left its `campaign:<id>` entry in the stored section
 *     order permanently.
 *  3. The banner card reported "Visible" from the switch alone, which is the
 *     wrong answer for every banner that has not had its photograph uploaded
 *     yet — the state a client is in one click after "Add banner".
 *  4. A CTA destination was only checked against the placeholder sentinels, so
 *     a `javascript:` URL typed into the CMS rendered as a live button.
 */

/** A banner with real media, for the cases that need one to render. */
function bannerWithMedia(
  id: string,
  overrides: Partial<CampaignBannerContent> = {},
): CampaignBannerContent {
  return {
    ...createCampaignBanner(id),
    media: { ...EMPTY_MEDIA_SLOT, desktopUrl: "/uploads/homepage/a.webp" },
    ...overrides,
  };
}

function contentWith(
  banners: CampaignBannerContent[],
  sectionOrder?: string[],
): HomepageContent {
  return {
    ...DEFAULT_HOMEPAGE_CONTENT,
    campaignBanners: banners,
    ...(sectionOrder ? { sectionOrder } : {}),
  };
}

/* ================================================================== */
/*  Creation and identity                                             */
/* ================================================================== */

describe("createCampaignBanner", () => {
  it("starts with an empty media slot and no destination", () => {
    const banner = createCampaignBanner("campaign-abc123");

    expect(banner.media).toEqual(EMPTY_MEDIA_SLOT);
    // A plausible-looking default destination would become a live button the
    // moment the client typed a label, pointing somewhere they never chose.
    expect(banner.ctaLink).toBe("");
    expect(banner.ctaText).toBe("");
  });

  it("is safe to ship enabled, because with no media it renders nothing", () => {
    const banner = createCampaignBanner("campaign-abc123");

    expect(banner.enabled).toBe(true);
    expect(campaignBannerStatus(banner)).toBe("missing-media");
  });

  it("carries the existing alignment, theme, overlay and height defaults", () => {
    const banner = createCampaignBanner("campaign-abc123");

    expect(banner.align).toBe("left");
    expect(banner.verticalAlign).toBe("bottom");
    expect(banner.textTheme).toBe("light");
    expect(banner.overlayOpacity).toBe(45);
    expect(banner.height).toBe("standard");
  });
});

describe("addCampaignBanner", () => {
  it("appends one banner and leaves the existing ones untouched", () => {
    const before = contentWith([bannerWithMedia("campaign-one")]);

    const after = addCampaignBanner(before, () => "campaign-two");

    expect(after.campaignBanners).toHaveLength(2);
    expect(after.campaignBanners?.[0]).toEqual(before.campaignBanners?.[0]);
    expect(after.campaignBanners?.[1]?.id).toBe("campaign-two");
  });

  it("refuses to hand out an id another banner already uses", () => {
    const before = contentWith([bannerWithMedia("campaign-one")]);
    // A factory that keeps returning a colliding id until it has been asked
    // twice — stands in for the (vanishingly unlikely) crypto collision.
    const ids = ["campaign-one", "campaign-one", "campaign-fresh"];
    let call = 0;

    const after = addCampaignBanner(before, () => ids[call++] ?? "campaign-x");

    const seen = (after.campaignBanners ?? []).map((b) => b.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toContain("campaign-fresh");
  });

  it("gives two banners distinct section-order keys", () => {
    let content = contentWith([]);
    content = addCampaignBanner(content, () => "campaign-one");
    content = addCampaignBanner(content, () => "campaign-two");

    const keys = (content.campaignBanners ?? []).map((b) =>
      campaignSectionKey(b.id),
    );

    expect(keys).toEqual([
      `${CAMPAIGN_SECTION_PREFIX}campaign-one`,
      `${CAMPAIGN_SECTION_PREFIX}campaign-two`,
    ]);
    expect(new Set(keys).size).toBe(2);
  });
});

/* ================================================================== */
/*  Editing — the stale-write defect                                  */
/* ================================================================== */

describe("patchCampaignBanner", () => {
  it("edits only the addressed banner", () => {
    const content = contentWith([
      bannerWithMedia("campaign-one", { title: "ONE" }),
      bannerWithMedia("campaign-two", { title: "TWO" }),
    ]);

    const after = patchCampaignBanner(content, "campaign-two", {
      title: "CHANGED",
    });

    expect(after.campaignBanners?.[0]?.title).toBe("ONE");
    expect(after.campaignBanners?.[1]?.title).toBe("CHANGED");
  });

  it("never lets a patch rewrite the banner's identity", () => {
    const content = contentWith([bannerWithMedia("campaign-one")]);

    const after = patchCampaignBanner(content, "campaign-one", {
      id: "campaign-hijacked",
      title: "COPY EDIT",
    } as Partial<CampaignBannerContent>);

    // The id is what `sectionOrder` addresses the banner by, so a copy edit
    // moving it would silently drop the banner out of its saved position.
    expect(after.campaignBanners?.[0]?.id).toBe("campaign-one");
    expect(after.campaignBanners?.[0]?.title).toBe("COPY EDIT");
  });

  it("ignores an id that no longer exists", () => {
    const content = contentWith([bannerWithMedia("campaign-one")]);

    const after = patchCampaignBanner(content, "campaign-deleted", {
      title: "GHOST",
    });

    expect(after.campaignBanners).toHaveLength(1);
    expect(after.campaignBanners?.[0]?.id).toBe("campaign-one");
  });
});

describe("patchCampaignBannerMedia", () => {
  it("merges into the slot rather than replacing it", () => {
    const content = contentWith([
      {
        ...createCampaignBanner("campaign-one"),
        media: { ...EMPTY_MEDIA_SLOT, desktopUrl: "/uploads/desktop.webp" },
      },
    ]);

    const after = patchCampaignBannerMedia(content, "campaign-one", {
      mobileUrl: "/uploads/mobile.webp",
    });

    expect(after.campaignBanners?.[0]?.media).toMatchObject({
      desktopUrl: "/uploads/desktop.webp",
      mobileUrl: "/uploads/mobile.webp",
    });
  });

  it("survives two uploads resolving out of order", () => {
    // This is the defect, reproduced. Both uploads start from the same empty
    // slot; the old code rebuilt the whole slot from the value each handler
    // had closed over, so whichever finished last erased the other's URL.
    const start = contentWith([createCampaignBanner("campaign-one")]);

    // Desktop upload resolves first and commits against current state…
    const afterDesktop = patchCampaignBannerMedia(start, "campaign-one", {
      desktopUrl: "/uploads/desktop.webp",
    });
    // …then the mobile upload, started earlier, resolves against what is
    // there *now* rather than against the empty slot it began with.
    const afterMobile = patchCampaignBannerMedia(afterDesktop, "campaign-one", {
      mobileUrl: "/uploads/mobile.webp",
    });

    expect(afterMobile.campaignBanners?.[0]?.media?.desktopUrl).toBe(
      "/uploads/desktop.webp",
    );
    expect(afterMobile.campaignBanners?.[0]?.media?.mobileUrl).toBe(
      "/uploads/mobile.webp",
    );
  });

  it("does not discard copy typed while an upload was in flight", () => {
    let content = contentWith([createCampaignBanner("campaign-one")]);

    // Client starts an upload, then types a headline before it finishes.
    content = patchCampaignBanner(content, "campaign-one", {
      title: "SUMMER DROP",
    });
    // Upload resolves.
    content = patchCampaignBannerMedia(content, "campaign-one", {
      desktopUrl: "/uploads/desktop.webp",
    });

    expect(content.campaignBanners?.[0]?.title).toBe("SUMMER DROP");
    expect(content.campaignBanners?.[0]?.media?.desktopUrl).toBe(
      "/uploads/desktop.webp",
    );
  });

  it("fills a missing slot instead of throwing", () => {
    const content = contentWith([
      { ...createCampaignBanner("campaign-one"), media: undefined },
    ]);

    const after = patchCampaignBannerMedia(content, "campaign-one", {
      desktopUrl: "/uploads/desktop.webp",
    });

    expect(after.campaignBanners?.[0]?.media).toMatchObject({
      kind: "image",
      desktopUrl: "/uploads/desktop.webp",
    });
  });
});

/* ================================================================== */
/*  Removal                                                           */
/* ================================================================== */

describe("removeCampaignBanner", () => {
  it("removes the banner and its stale section-order entry together", () => {
    const order = [
      "categories",
      `${CAMPAIGN_SECTION_PREFIX}campaign-one`,
      "featuredProducts",
      `${CAMPAIGN_SECTION_PREFIX}campaign-two`,
      "footerCta",
    ];
    const content = contentWith(
      [bannerWithMedia("campaign-one"), bannerWithMedia("campaign-two")],
      order,
    );

    const after = removeCampaignBanner(content, "campaign-one");

    expect(after.campaignBanners?.map((b) => b.id)).toEqual(["campaign-two"]);
    expect(after.sectionOrder).not.toContain(
      `${CAMPAIGN_SECTION_PREFIX}campaign-one`,
    );
  });

  it("leaves every other section's position exactly where it was", () => {
    const order = [
      "categories",
      `${CAMPAIGN_SECTION_PREFIX}campaign-one`,
      "featuredProducts",
      `${CAMPAIGN_SECTION_PREFIX}campaign-two`,
      "footerCta",
    ];
    const content = contentWith(
      [bannerWithMedia("campaign-one"), bannerWithMedia("campaign-two")],
      order,
    );

    const after = removeCampaignBanner(content, "campaign-one");

    expect(after.sectionOrder).toEqual([
      "categories",
      "featuredProducts",
      `${CAMPAIGN_SECTION_PREFIX}campaign-two`,
      "footerCta",
    ]);
  });

  it("never reassigns the surviving banners' ids", () => {
    const content = contentWith([
      bannerWithMedia("campaign-one", { title: "ONE" }),
      bannerWithMedia("campaign-two", { title: "TWO" }),
      bannerWithMedia("campaign-three", { title: "THREE" }),
    ]);

    const after = removeCampaignBanner(content, "campaign-two");

    expect(after.campaignBanners?.map((b) => [b.id, b.title])).toEqual([
      ["campaign-one", "ONE"],
      ["campaign-three", "THREE"],
    ]);
  });

  it("leaves an unsaved order unsaved rather than inventing one", () => {
    // A store whose client has never opened Section Order: the merge layer
    // leaves `sectionOrder` undefined so the storefront falls through to the
    // default composition.
    const content: HomepageContent = {
      ...contentWith([bannerWithMedia("campaign-one")]),
      sectionOrder: undefined,
    };

    const after = removeCampaignBanner(content, "campaign-one");

    // Writing a concrete order here would lock in today's default composition
    // for a client who has never touched Section Order.
    expect(after.sectionOrder).toBeUndefined();
  });

  it("stops the storefront resolving the removed banner", () => {
    const content = removeCampaignBanner(
      contentWith([bannerWithMedia("campaign-one"), bannerWithMedia("campaign-two")]),
      "campaign-one",
    );

    const order = resolveSectionOrder(
      content.sectionOrder,
      (content.campaignBanners ?? []).map((b) => b.id),
      [],
    );

    expect(order).not.toContain(`${CAMPAIGN_SECTION_PREFIX}campaign-one`);
    expect(order).toContain(`${CAMPAIGN_SECTION_PREFIX}campaign-two`);
  });
});

/* ================================================================== */
/*  Status                                                            */
/* ================================================================== */

describe("campaignBannerStatus", () => {
  it("reports a disabled banner as off", () => {
    const banner = bannerWithMedia("campaign-one", { enabled: false });
    expect(campaignBannerStatus(banner)).toBe("off");
    expect(CAMPAIGN_BANNER_STATUS_LABELS.off).toBe("Hidden");
  });

  it("refuses to call an enabled banner with no media visible", () => {
    const banner = createCampaignBanner("campaign-one");

    expect(campaignBannerStatus(banner)).toBe("missing-media");
    expect(CAMPAIGN_BANNER_STATUS_LABELS[campaignBannerStatus(banner)]).not.toBe(
      "Visible",
    );
  });

  it("reports an enabled banner with media as visible", () => {
    expect(campaignBannerStatus(bannerWithMedia("campaign-one"))).toBe(
      "visible",
    );
  });

  it("counts a mobile-only slot as media", () => {
    const banner: CampaignBannerContent = {
      ...createCampaignBanner("campaign-one"),
      media: { ...EMPTY_MEDIA_SLOT, mobileUrl: "/uploads/mobile.webp" },
    };
    expect(campaignBannerStatus(banner)).toBe("visible");
  });

  it("agrees with the status Section Order shows for the same banner", () => {
    const content = contentWith([
      createCampaignBanner("campaign-one"),
      bannerWithMedia("campaign-two"),
      bannerWithMedia("campaign-three", { enabled: false }),
    ]);
    const order = (content.campaignBanners ?? []).map((b) =>
      campaignSectionKey(b.id),
    );

    const rows = describeSectionRows(order, content, []);

    // Both surfaces must classify the same banner the same way; they were the
    // two places the client compared, and they used to disagree.
    expect(rows.map((r) => r.status)).toEqual([
      "missing-media",
      "visible",
      "off",
    ]);
  });
});

/* ================================================================== */
/*  Call to action                                                    */
/* ================================================================== */

describe("campaignBannerCtaHref", () => {
  it("returns the destination for a complete CTA", () => {
    expect(
      campaignBannerCtaHref({ ctaText: "Shop the drop", ctaLink: "/shop" }),
    ).toBe("/shop");
  });

  it("renders no button without a label", () => {
    expect(campaignBannerCtaHref({ ctaText: "", ctaLink: "/shop" })).toBeNull();
    expect(
      campaignBannerCtaHref({ ctaText: "   ", ctaLink: "/shop" }),
    ).toBeNull();
    expect(
      campaignBannerCtaHref({ ctaText: undefined, ctaLink: "/shop" }),
    ).toBeNull();
  });

  it("renders no button for a placeholder destination", () => {
    for (const ctaLink of ["", "   ", "#", "#soon", undefined]) {
      expect(campaignBannerCtaHref({ ctaText: "Shop", ctaLink })).toBeNull();
    }
  });

  it("renders no button for a destination that would execute", () => {
    for (const ctaLink of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
    ]) {
      expect(campaignBannerCtaHref({ ctaText: "Shop", ctaLink })).toBeNull();
    }
  });

  it("still allows the ordinary destinations a client types", () => {
    for (const ctaLink of [
      "/shop",
      "/shop?category=stacks",
      "https://example.com/campaign",
      "mailto:hello@example.com",
      "#products",
    ]) {
      expect(campaignBannerCtaHref({ ctaText: "Shop", ctaLink })).toBe(ctaLink);
    }
  });

  it("keeps isUnsafeLink narrow", () => {
    expect(isUnsafeLink("/shop")).toBe(false);
    expect(isUnsafeLink("https://example.com")).toBe(false);
    // Not a scheme — a path that merely starts with the same letters.
    expect(isUnsafeLink("/javascript-guide")).toBe(false);
    expect(isUnsafeLink("javascript:void(0)")).toBe(true);
  });
});
