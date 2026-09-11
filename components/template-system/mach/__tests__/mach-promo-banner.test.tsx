import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { HomepagePromoBannerContent } from "#root/shared/types/homepage-content";
import { resolvePromoBanner } from "#root/shared/types/homepage-promo-banner";
import { CHROME_BANNER_SLOT_ID, MachPromoBannerBar } from "../MachPromoBanner";

/**
 * The promotional banner on Mach — `content.promoBanner`, the one-line
 * announcement bar above the navbar.
 *
 * This is the feature the client reported as broken: the Homepage Admin
 * control worked and the value persisted, but the Mach storefront never read
 * the field, so nothing they typed appeared. These tests pin the field to the
 * page, and pin it to the right *place* — the global chrome slot above the
 * navigation — since the position is the point.
 *
 * Rendered to static markup; the portal wrapper needs a DOM and is covered
 * structurally below instead.
 */

const ROOT = path.resolve(__dirname, "../../../..");

function promo(
  overrides: Partial<HomepagePromoBannerContent> = {},
): HomepagePromoBannerContent {
  return {
    enabled: true,
    text: "Free shipping over EGP 1500",
    linkText: "Shop now",
    linkUrl: "/shop",
    ...overrides,
  };
}

function render(content: HomepagePromoBannerContent | undefined): string {
  return renderToStaticMarkup(<MachPromoBannerBar content={content} />);
}

/* ================================================================== */
/*  Behaviour                                                         */
/* ================================================================== */

describe("resolvePromoBanner", () => {
  it("returns text and link for a complete banner", () => {
    expect(resolvePromoBanner(promo())).toEqual({
      text: "Free shipping over EGP 1500",
      link: { label: "Shop now", href: "/shop" },
    });
  });

  it("returns nothing when switched off", () => {
    expect(resolvePromoBanner(promo({ enabled: false }))).toBeNull();
  });

  it("returns nothing when enabled with no text and no usable link", () => {
    expect(
      resolvePromoBanner(promo({ text: "", linkText: "", linkUrl: "" })),
    ).toBeNull();
    expect(
      resolvePromoBanner(promo({ text: "   ", linkText: undefined, linkUrl: undefined })),
    ).toBeNull();
    // A label with a placeholder destination is not a usable link either.
    expect(
      resolvePromoBanner(promo({ text: "", linkText: "Shop", linkUrl: "#" })),
    ).toBeNull();
  });

  it("returns text alone when there is no link", () => {
    expect(resolvePromoBanner(promo({ linkText: "", linkUrl: "" }))).toEqual({
      text: "Free shipping over EGP 1500",
      link: null,
    });
  });

  it("returns a link alone when there is no text", () => {
    expect(resolvePromoBanner(promo({ text: "" }))).toEqual({
      text: "",
      link: { label: "Shop now", href: "/shop" },
    });
  });

  it("drops the link when only one half of it is filled in", () => {
    expect(resolvePromoBanner(promo({ linkUrl: "" }))?.link).toBeNull();
    expect(resolvePromoBanner(promo({ linkText: "" }))?.link).toBeNull();
  });

  it("drops the link for a placeholder or unsafe destination", () => {
    for (const linkUrl of ["", "#", "#soon", "javascript:alert(1)", "data:text/html,x"]) {
      expect(resolvePromoBanner(promo({ linkUrl }))?.link).toBeNull();
    }
  });

  it("keeps ordinary destinations", () => {
    for (const linkUrl of ["/shop", "/shop?sale=1", "https://example.com/x", "#products"]) {
      expect(resolvePromoBanner(promo({ linkUrl }))?.link?.href).toBe(linkUrl);
    }
  });

  it("is a function of promoBanner alone", () => {
    // Neither the marquee nor the campaign banners are inputs here: the three
    // are independent features, and this one cannot be switched off or
    // emptied by either of the others.
    expect(resolvePromoBanner(promo())).not.toBeNull();
    expect(resolvePromoBanner(undefined)).toBeNull();
  });
});

/* ================================================================== */
/*  Markup                                                            */
/* ================================================================== */

describe("MachPromoBannerBar", () => {
  it("renders the announcement text", () => {
    const html = render(promo());
    expect(html).toContain("Free shipping over EGP 1500");
    expect(html).toContain('data-mach-promo-banner=""');
  });

  it("renders nothing when disabled", () => {
    expect(render(promo({ enabled: false }))).toBe("");
  });

  it("renders nothing when enabled but empty", () => {
    expect(render(promo({ text: "", linkText: "", linkUrl: "" }))).toBe("");
  });

  it("renders the link with its destination", () => {
    const html = render(promo());
    expect(html).toContain('href="/shop"');
    expect(html).toContain(">Shop now</a>");
  });

  it("renders no anchor for a placeholder or unsafe destination", () => {
    for (const linkUrl of ["#", "#soon", "javascript:alert(1)"]) {
      const html = render(promo({ linkUrl }));
      expect(html).toContain("Free shipping over EGP 1500");
      expect(html).not.toContain("<a ");
    }
  });

  it("renders text and link together on one bar", () => {
    const html = render(promo());
    expect(html.match(/data-mach-promo-banner/g)?.length).toBe(1);
    expect(html).toContain("Free shipping over EGP 1500");
    expect(html).toContain(">Shop now</a>");
  });

  it("does not contain the marquee or any campaign banner", () => {
    const html = render(promo());
    expect(html).not.toContain("BUILT FOR THE WORK");
    expect(html).not.toContain("grayscale");
    expect(html).not.toContain("<section");
  });
});

/* ================================================================== */
/*  Placement and wiring — structural                                 */
/* ================================================================== */

describe("promotional banner placement", () => {
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

  it("targets the chrome slot LayoutDefault reserves above the navbar", () => {
    const layout = read("layouts/LayoutDefault.tsx");
    // The slot must sit inside the fixed chrome and before the navbar.
    const slotAt = layout.indexOf(`id='${CHROME_BANNER_SLOT_ID}'`);
    const chromeAt = layout.indexOf("id='global-navbar'");
    const navbarAt = layout.indexOf("{children}", slotAt);
    expect(slotAt).toBeGreaterThan(chromeAt);
    expect(navbarAt).toBeGreaterThan(slotAt);
    // And the Mach bar portals into exactly that id.
    const component = read("components/template-system/mach/MachPromoBanner.tsx");
    expect(component).toContain("createPortal(");
    expect(CHROME_BANNER_SLOT_ID).toBe("chrome-banner-slot");
  });

  it("is mounted by the Mach landing template from content.promoBanner", () => {
    const template = read("components/template-system/landing/LandingTemplateMach.tsx");
    expect(template).toContain("<MachPromoBanner content={content.promoBanner} />");
  });

  it("leaves the marquee exactly where it was", () => {
    const template = read("components/template-system/landing/LandingTemplateMach.tsx");
    expect(template).toContain('case "heroMarquee":');
    expect(template).toContain("<MachMarquee key={key} content={content.heroMarquee} />");
  });

  it("is edited on Mach by the Promotional Banner card in Homepage Admin", () => {
    const admin = read("pages/dashboard/admin/homepage/+Page.tsx");
    const title = admin.indexOf("<CardTitle>Promotional Banner</CardTitle>");
    expect(title).toBeGreaterThan(0);
    // The gate immediately above the card must not exclude Mach — hiding
    // this card on Mach was the mistaken fix this test exists to prevent.
    const gate = admin.lastIndexOf("{!isMinimal && (", title);
    const machGate = admin.lastIndexOf("!isMach", title);
    expect(gate).toBeGreaterThan(0);
    expect(machGate < gate || machGate < 0).toBe(true);
    // And the field it edits is the one the storefront reads.
    expect(admin.slice(title, title + 2500)).toContain("promoBanner: { ...prev.promoBanner, enabled: checked }");
  });

  it("keeps the full-bleed banners named Campaign Banners", () => {
    const sections = read("pages/dashboard/admin/homepage/sections/MachSections.tsx");
    expect(sections).toContain("<CardTitle>Campaign Banners</CardTitle>");
    expect(sections).not.toContain("<CardTitle>Promotional Banners</CardTitle>");
    expect(sections).not.toContain("Add Promotional Banner");
  });

  it("is the only top bar on Mach — the navbar no longer renders the Layout Settings strip", () => {
    // Layout Settings' `header.announcementBar*` used to render a second
    // strip inside MachNavbar, stacking under this bar when both were on.
    const navbar = read("components/template-system/mach/MachNavbar.tsx");
    expect(navbar).not.toContain("announcementBarEnabled");
    expect(navbar).not.toContain("announcementBarText");
    // The setting still drives the default navbar for the other templates.
    const defaultNavbar = read("components/globals/Navbar.tsx");
    expect(defaultNavbar).toContain("announcementBarEnabled");
    // And Layout Settings stops offering the control for the Mach navbar
    // style rather than leaving a switch that does nothing.
    const layoutAdmin = read("pages/dashboard/admin/layout-settings/+Page.tsx");
    expect(layoutAdmin).toContain('settings.header.navbarStyle !== "editorial" && (');
  });

  it("keeps the Modern template's own promoBanner rendering untouched", () => {
    const modern = read("components/template-system/landing/LandingTemplateModern.tsx");
    expect(modern).toContain("content.promoBanner.enabled");
    expect(modern).toContain('getElementById("chrome-banner-slot")');
    expect(modern).not.toContain("MachPromoBanner");
  });
});
