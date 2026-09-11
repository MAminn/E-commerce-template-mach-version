import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EMPTY_MEDIA_SLOT,
  type CampaignBannerContent,
} from "#root/shared/types/homepage-content";
import { createCampaignBanner } from "#root/shared/types/homepage-campaign-banners";
import { MachCampaignBanner } from "../MachCampaignBanner";

/**
 * What the campaign banner actually puts on the page.
 *
 * Rendered to static markup rather than mounted: these are assertions about
 * the banner's own rules — does it render at all, does the client's media
 * reach the `img`, does an unusable destination become a button — none of
 * which need a browser, and none of which should be pinned to a screenshot.
 *
 * The media rule is the one worth stating plainly, because it is the rule the
 * admin's status badge now mirrors: a campaign banner *is* its photograph, so
 * an enabled banner with an empty slot renders nothing rather than a
 * full-height empty rectangle.
 */

function render(banner: CampaignBannerContent): string {
  return renderToStaticMarkup(<MachCampaignBanner banner={banner} />);
}

function banner(
  overrides: Partial<CampaignBannerContent> = {},
): CampaignBannerContent {
  return { ...createCampaignBanner("campaign-one"), ...overrides };
}

const WITH_MEDIA = {
  media: { ...EMPTY_MEDIA_SLOT, desktopUrl: "/uploads/homepage/campaign.webp" },
};

describe("MachCampaignBanner — when it renders at all", () => {
  it("renders an enabled banner that has media", () => {
    const html = render(banner({ ...WITH_MEDIA, title: "SUMMER DROP" }));

    expect(html).not.toBe("");
    expect(html).toContain("SUMMER DROP");
    expect(html).toContain("/uploads/homepage/campaign.webp");
  });

  it("renders nothing when the banner is switched off", () => {
    const html = render(
      banner({ ...WITH_MEDIA, enabled: false, title: "SUMMER DROP" }),
    );

    expect(html).toBe("");
  });

  it("renders nothing when enabled with an empty media slot", () => {
    // The state every banner is in one click after "Add banner". A headline
    // over an empty rectangle is not a campaign.
    const html = render(banner({ enabled: true, title: "SUMMER DROP" }));

    expect(html).toBe("");
  });

  it("renders nothing when the slot exists but holds only whitespace", () => {
    const html = render(
      banner({
        title: "SUMMER DROP",
        media: { ...EMPTY_MEDIA_SLOT, desktopUrl: "   " },
      }),
    );

    expect(html).toBe("");
  });
});

describe("MachCampaignBanner — media", () => {
  it("puts the desktop asset on the image", () => {
    const html = render(banner(WITH_MEDIA));

    expect(html).toContain('src="/uploads/homepage/campaign.webp"');
  });

  it("adds a mobile source only when a dedicated crop was uploaded", () => {
    const withoutMobile = render(banner(WITH_MEDIA));
    // No second source: the desktop asset is what a phone gets, which is the
    // documented fallback rather than an omission.
    expect(withoutMobile).not.toContain("max-width: 767px");
    expect(withoutMobile).toContain("/uploads/homepage/campaign.webp");

    const withMobile = render(
      banner({
        media: {
          ...EMPTY_MEDIA_SLOT,
          desktopUrl: "/uploads/homepage/campaign.webp",
          mobileUrl: "/uploads/homepage/campaign-mobile.webp",
        },
      }),
    );
    expect(withMobile).toContain("max-width: 767px");
    expect(withMobile).toContain("/uploads/homepage/campaign-mobile.webp");
    // The desktop asset is still there for everything above the breakpoint.
    expect(withMobile).toContain("/uploads/homepage/campaign.webp");
  });

  it("renders a mobile-only banner off the mobile asset", () => {
    const html = render(
      banner({
        media: {
          ...EMPTY_MEDIA_SLOT,
          mobileUrl: "/uploads/homepage/campaign-mobile.webp",
        },
      }),
    );

    expect(html).not.toBe("");
    // The one asset serves every viewport: it is the `img` source, and there
    // is no separate mobile `<source>` because there is nothing to switch to.
    expect(html).toContain('src="/uploads/homepage/campaign-mobile.webp"');
    expect(html).not.toContain('src=""');
    expect(html).not.toContain("max-width: 767px");
  });

  it("normalises a bare filename saved by an older upload path", () => {
    const html = render(
      banner({ media: { ...EMPTY_MEDIA_SLOT, desktopUrl: "legacy.jpg" } }),
    );

    expect(html).toContain('src="/uploads/legacy.jpg"');
  });

  it("carries the client's alt text and focal point through", () => {
    const html = render(
      banner({
        media: {
          ...EMPTY_MEDIA_SLOT,
          desktopUrl: "/uploads/homepage/campaign.webp",
          alt: "Athlete mid-lift",
          focalPoint: { x: 30, y: 70 },
        },
      }),
    );

    expect(html).toContain('alt="Athlete mid-lift"');
    expect(html).toContain("30% 70%");
  });

  it("keeps video slots working", () => {
    const html = render(
      banner({
        media: {
          ...EMPTY_MEDIA_SLOT,
          kind: "video",
          desktopUrl: "/uploads/homepage/campaign.mp4",
          posterUrl: "/uploads/homepage/poster.webp",
        },
      }),
    );

    expect(html).toContain("<video");
    expect(html).toContain("/uploads/homepage/campaign.mp4");
    expect(html).toContain("/uploads/homepage/poster.webp");
  });
});

describe("MachCampaignBanner — call to action", () => {
  it("renders the button when label and destination are both real", () => {
    const html = render(
      banner({ ...WITH_MEDIA, ctaText: "Shop the drop", ctaLink: "/shop" }),
    );

    expect(html).toContain('href="/shop"');
    expect(html).toContain("Shop the drop");
  });

  it("renders no button when the label is empty", () => {
    const html = render(
      banner({ ...WITH_MEDIA, ctaText: "", ctaLink: "/shop" }),
    );

    expect(html).not.toContain('href="/shop"');
    expect(html).not.toContain("<a ");
  });

  it("renders no button for a placeholder destination", () => {
    for (const ctaLink of ["", "#", "#soon"]) {
      const html = render(banner({ ...WITH_MEDIA, ctaText: "Shop", ctaLink }));
      expect(html).not.toContain("<a ");
    }
  });

  it("renders no button for a destination that would execute", () => {
    const html = render(
      banner({
        ...WITH_MEDIA,
        ctaText: "Shop",
        ctaLink: "javascript:alert(1)",
      }),
    );

    expect(html).not.toContain("<a ");
    expect(html.toLowerCase()).not.toContain("javascript:");
  });
});

describe("MachCampaignBanner — presentation the client controls", () => {
  it("keeps the approved greyscale campaign treatment", () => {
    // Intentional identity, not a bug: campaign photography stays inside the
    // monochrome scheme whatever the client uploads.
    expect(render(banner(WITH_MEDIA))).toContain("grayscale");
  });

  it("honours the height choice", () => {
    expect(render(banner({ ...WITH_MEDIA, height: "tall" }))).toContain(
      "80svh",
    );
    expect(render(banner({ ...WITH_MEDIA, height: "standard" }))).toContain(
      "62svh",
    );
  });

  it("honours the text theme", () => {
    expect(render(banner({ ...WITH_MEDIA, textTheme: "dark" }))).toContain(
      "--mach-ink",
    );
    expect(
      render(banner({ ...WITH_MEDIA, title: "X", textTheme: "light" })),
    ).toContain("text-white");
  });

  it("lets a long headline wrap instead of being clipped on a phone", () => {
    const html = render(
      banner({ ...WITH_MEDIA, title: "SUPPLEMENTATION" }),
    );

    expect(html).toContain("break-words");
  });

  it("keeps a long button label inside the viewport", () => {
    const html = render(
      banner({
        ...WITH_MEDIA,
        ctaText: "Shop the entire summer collection now",
        ctaLink: "/shop",
      }),
    );

    expect(html).toContain("max-w-full");
  });

  it("omits copy the client left blank rather than reserving space for it", () => {
    const html = render(banner(WITH_MEDIA));

    expect(html).not.toContain("<h2");
    // `<p ` rather than `<p` — the media layer renders a <picture>.
    expect(html).not.toContain("<p ");
  });
});
