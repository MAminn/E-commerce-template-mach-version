import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANDING_PAGE_SETTINGS,
  LANDING_MAX_PRODUCTS,
  canEditLandingPage,
  dashboardHomeForRole,
  isSafeLandingLink,
  isSafeLandingMediaUrl,
  normalizeLandingPageSettings,
  orderBySelection,
  validateLandingPageSettings,
  type LandingPageSettings,
} from "../config";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

function settings(patch: {
  hero?: Partial<LandingPageSettings["hero"]>;
  productIds?: string[];
  productsTitle?: string;
}): LandingPageSettings {
  const base = structuredClone(DEFAULT_LANDING_PAGE_SETTINGS);
  return {
    ...base,
    ...patch,
    hero: { ...base.hero, ...patch.hero },
  };
}

describe("who may edit the page", () => {
  it.each([
    ["admin", true],
    ["superadmin", true],
    ["media_buyer", true],
    ["user", false],
    ["vendor", false],
    [undefined, false],
    ["", false],
  ])("%s → %s", (role, allowed) => {
    expect(canEditLandingPage(role)).toBe(allowed);
  });

  it("sends each role to the right place after login", () => {
    expect(dashboardHomeForRole("admin")).toBe("/dashboard");
    expect(dashboardHomeForRole("superadmin")).toBe("/dashboard");
    expect(dashboardHomeForRole("media_buyer")).toBe("/dashboard/landing-2");
    expect(dashboardHomeForRole("user")).toBeNull();
    expect(dashboardHomeForRole("vendor")).toBeNull();
  });
});

describe("normalizeLandingPageSettings", () => {
  it("an unsaved page gets the defaults", () => {
    expect(normalizeLandingPageSettings(null)).toEqual(
      DEFAULT_LANDING_PAGE_SETTINGS,
    );
    expect(normalizeLandingPageSettings("garbage")).toEqual(
      DEFAULT_LANDING_PAGE_SETTINGS,
    );
  });

  it("fills missing fields and drops malformed ones", () => {
    const out = normalizeLandingPageSettings({
      hero: {
        title: "Big sale",
        align: "sideways",
        overlayOpacity: 400,
        media: { kind: "video", desktopUrl: "/uploads/homepage/a.mp4" },
      },
      productIds: [A, "not-a-uuid", A.toUpperCase(), B, 7],
    });
    expect(out.hero.title).toBe("Big sale");
    expect(out.hero.align).toBe("left");
    expect(out.hero.overlayOpacity).toBe(100);
    expect(out.hero.media.kind).toBe("video");
    expect(out.hero.ctaText).toBe(DEFAULT_LANDING_PAGE_SETTINGS.hero.ctaText);
    // Duplicates (case-insensitive) and junk removed, order kept.
    expect(out.productIds).toEqual([A, B]);
  });
});

describe("link and media safety", () => {
  it.each([
    "#products",
    "/shop",
    "/products/whey?utm_source=meta",
    "https://machsupplements.com/offers",
    "http://example.com",
    "",
  ])("accepts link %s", (link) => {
    expect(isSafeLandingLink(link)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//evil.example.com",
    "/\\evil.example.com",
    "#",
    "mailto:x@example.com",
    "shop now",
  ])("refuses link %s", (link) => {
    expect(isSafeLandingLink(link)).toBe(false);
  });

  it.each(["/uploads/homepage/landing-1.webp", "https://cdn.example.com/a.mp4", ""])(
    "accepts media %s",
    (url) => expect(isSafeLandingMediaUrl(url)).toBe(true),
  );

  it.each([
    "javascript:alert(1)",
    "http://insecure.example.com/a.jpg",
    "//evil.example.com/a.jpg",
    "data:image/png;base64,AAAA",
  ])("refuses media %s", (url) => expect(isSafeLandingMediaUrl(url)).toBe(false));
});

describe("validateLandingPageSettings", () => {
  it("accepts the defaults", () => {
    expect(validateLandingPageSettings(DEFAULT_LANDING_PAGE_SETTINGS).ok).toBe(true);
  });

  it("requires a headline", () => {
    const res = validateLandingPageSettings(settings({ hero: { title: "   " } }));
    expect(res).toMatchObject({ ok: false, errors: { title: "Enter a headline." } });
  });

  it("refuses an unsafe button link", () => {
    const res = validateLandingPageSettings(
      settings({ hero: { ctaLink: "javascript:alert(document.cookie)" } }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.ctaLink).toMatch(/#products/);
  });

  it("asks for a link when the button has text", () => {
    const res = validateLandingPageSettings(settings({ hero: { ctaLink: " " } }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.ctaLink).toMatch(/Add where the button goes/);
  });

  it("an empty button text means no button, and the link is cleared", () => {
    const res = validateLandingPageSettings(
      settings({ hero: { ctaText: "", ctaLink: "#products" } }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.settings.hero.ctaLink).toBe("");
  });

  it("refuses an unsafe media URL in any sub-slot", () => {
    const res = validateLandingPageSettings(
      settings({
        hero: {
          media: {
            kind: "video",
            desktopUrl: "/uploads/homepage/a.mp4",
            posterUrl: "javascript:alert(1)",
          },
        },
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.media).toBeDefined();
  });

  it("caps the product list", () => {
    const ids = Array.from(
      { length: LANDING_MAX_PRODUCTS + 1 },
      (_, i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const res = validateLandingPageSettings(settings({ productIds: ids }));
    expect(res.ok).toBe(false);
  });

  it("trims text and keeps the chosen product order", () => {
    const res = validateLandingPageSettings(
      settings({
        hero: { title: "  New drop  ", subtitle: " Free shipping " },
        productIds: [C, A, B],
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.settings.hero.title).toBe("New drop");
      expect(res.settings.hero.subtitle).toBe("Free shipping");
      expect(res.settings.productIds).toEqual([C, A, B]);
    }
  });
});

describe("orderBySelection", () => {
  it("follows the saved order and drops ids that no longer resolve", () => {
    const items = [{ id: A }, { id: B }, { id: C }];
    expect(orderBySelection(items, [C, "dddddddd-0000-4000-8000-000000000004", A])).toEqual([
      { id: C },
      { id: A },
    ]);
  });
});
