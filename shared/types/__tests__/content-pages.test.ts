import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveAboutPage,
  resolveContactPage,
  resolveContentImageUrl,
  resolveReturnPolicyPage,
} from "../content-pages";
import {
  DEFAULT_HOMEPAGE_CONTENT,
  ValuePropIconType,
  type HomepageAboutUsContent,
  type HomepageContactBannerContent,
  type HomepageReturnPolicyContent,
} from "../homepage-content";
import { DEFAULT_LAYOUT_SETTINGS } from "../layout-settings";

/**
 * /about-us, /contact and /return-policy.
 *
 * All three routes existed and all three returned the literal string "Page not
 * found" on any storefront whose `navbarStyle` was not "minimal" — which is
 * every Mach store, since Mach runs "editorial". Meanwhile the shipped layout
 * settings link to all three from the navbar and footer, so the live
 * storefront advertised three of its own 404s.
 *
 * These tests pin the two halves of the fix: the content decisions (here) and
 * the wiring that routes them to a template (bottom of the file).
 */

const ROOT = path.resolve(__dirname, "../..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

function about(
  overrides: Partial<HomepageAboutUsContent> = {},
): HomepageAboutUsContent {
  return {
    enabled: true,
    title: "About Mach",
    titleAr: "عن ماك",
    description: "Line one.\nLine two.",
    descriptionAr: "سطر واحد.",
    imageUrl: "",
    ...overrides,
  };
}

function policy(
  overrides: Partial<HomepageReturnPolicyContent> = {},
): HomepageReturnPolicyContent {
  return {
    enabled: true,
    title: "Return Policy",
    titleAr: "سياسة الإرجاع",
    intro: "If something's not right, we're here to help.",
    introAr: "نحن هنا لمساعدتك.",
    steps: [
      {
        icon: ValuePropIconType.PACKAGE,
        title: "1. Return Window",
        titleAr: "١. فترة الإرجاع",
        description: "14 days from delivery.",
        descriptionAr: "١٤ يوماً",
      },
    ],
    detailSections: [
      {
        title: "Non-Returnable Items",
        body: "Opened supplement containers.",
      },
    ],
    footerPrefix: "Need help? Reach us at",
    supportEmail: "help@machsupplements.com",
    footerMiddle: "or via our",
    contactLinkLabel: "Contact Us page",
    contactLinkUrl: "/contact",
    ...overrides,
  };
}

function banner(
  overrides: Partial<HomepageContactBannerContent> = {},
): HomepageContactBannerContent {
  return {
    enabled: true,
    slides: [],
    heading: "We Would Love To Hear From You",
    headingAr: "نود أن نسمع منك",
    description: "Drop us a message.",
    descriptionAr: "أرسل لنا رسالة.",
    directionsUrl: "",
    ...overrides,
  };
}

/* ================================================================== */
/*  Shared                                                            */
/* ================================================================== */

describe("resolveContentImageUrl", () => {
  it("passes absolute and root-relative values through untouched", () => {
    expect(resolveContentImageUrl("https://cdn.example.com/a.jpg")).toBe(
      "https://cdn.example.com/a.jpg",
    );
    expect(resolveContentImageUrl("/uploads/layout/a.webp")).toBe(
      "/uploads/layout/a.webp",
    );
  });

  it("resolves a bare filename against the uploads directory", () => {
    expect(resolveContentImageUrl("a.webp")).toBe("/uploads/a.webp");
  });

  it("is null for nothing", () => {
    expect(resolveContentImageUrl("")).toBeNull();
    expect(resolveContentImageUrl("   ")).toBeNull();
    expect(resolveContentImageUrl(undefined)).toBeNull();
  });
});

/* ================================================================== */
/*  About                                                             */
/* ================================================================== */

describe("resolveAboutPage", () => {
  it("returns the CMS title and body", () => {
    expect(resolveAboutPage(about(), "en")).toEqual({
      title: "About Mach",
      paragraphs: ["Line one.", "Line two."],
      imageUrl: null,
    });
  });

  it("reads the Arabic copy in Arabic and falls back when it is blank", () => {
    expect(resolveAboutPage(about(), "ar")?.title).toBe("عن ماك");
    expect(resolveAboutPage(about({ titleAr: "  " }), "ar")?.title).toBe(
      "About Mach",
    );
    expect(resolveAboutPage(about({ titleAr: undefined }), "ar")?.title).toBe(
      "About Mach",
    );
  });

  it("normalises the CMS image reference", () => {
    expect(resolveAboutPage(about({ imageUrl: "team.webp" }), "en")?.imageUrl).toBe(
      "/uploads/team.webp",
    );
  });

  it("is unpublished when the CMS switch is off", () => {
    expect(resolveAboutPage(about({ enabled: false }), "en")).toBeNull();
  });

  it("is unpublished when there is no copy to show — it invents none", () => {
    expect(resolveAboutPage(about({ description: "" }), "en")).toBeNull();
    expect(resolveAboutPage(about({ description: "\n  \n" }), "en")).toBeNull();
    expect(resolveAboutPage(about({ title: "  " }), "en")).toBeNull();
    expect(resolveAboutPage(undefined, "en")).toBeNull();
  });

  it("takes its content from homepageContent.aboutUs and nothing else", () => {
    // The page is not allowed to fall back to layout settings, branding copy
    // or a hard-coded string when the CMS field is empty.
    const view = resolveAboutPage(
      about({ title: "Only From The CMS", description: "Only from the CMS." }),
      "en",
    );
    expect(view?.title).toBe("Only From The CMS");
    expect(view?.paragraphs).toEqual(["Only from the CMS."]);
  });
});

/* ================================================================== */
/*  Return policy                                                     */
/* ================================================================== */

describe("resolveReturnPolicyPage", () => {
  it("returns the CMS steps and detail sections", () => {
    const view = resolveReturnPolicyPage(policy(), "en");
    expect(view?.title).toBe("Return Policy");
    expect(view?.steps).toEqual([
      {
        icon: ValuePropIconType.PACKAGE,
        title: "1. Return Window",
        description: "14 days from delivery.",
      },
    ]);
    expect(view?.detailSections).toEqual([
      { title: "Non-Returnable Items", body: "Opened supplement containers." },
    ]);
  });

  it("publishes the shipped default policy as-is", () => {
    // returnPolicy ships enabled with real steps, so /return-policy — the
    // footer's "Shipping & Returns" — works on a store that has never opened
    // the CMS card.
    const view = resolveReturnPolicyPage(
      DEFAULT_HOMEPAGE_CONTENT.returnPolicy,
      "en",
    );
    expect(view).not.toBeNull();
    expect(view?.steps.length).toBe(4);
  });

  it("offers no help line until there is a real address behind it", () => {
    // supportEmail ships blank on purpose; a mailto: to nobody is worse than
    // no line. A contact link alone is still worth printing.
    const noEmail = resolveReturnPolicyPage(
      policy({ supportEmail: "", contactLinkUrl: "", contactLinkLabel: "" }),
      "en",
    );
    expect(noEmail?.help).toBeNull();

    const linkOnly = resolveReturnPolicyPage(policy({ supportEmail: " " }), "en");
    expect(linkOnly?.help?.supportEmail).toBeNull();
    expect(linkOnly?.help?.contactLink).toEqual({
      label: "Contact Us page",
      url: "/contact",
    });
  });

  it("reads Arabic copy in Arabic", () => {
    const view = resolveReturnPolicyPage(policy(), "ar");
    expect(view?.title).toBe("سياسة الإرجاع");
    expect(view?.steps[0]?.title).toBe("١. فترة الإرجاع");
    // No Arabic body was written for the detail section — English stands in
    // rather than the section vanishing.
    expect(view?.detailSections[0]?.body).toBe("Opened supplement containers.");
  });

  it("is unpublished when switched off or empty", () => {
    expect(resolveReturnPolicyPage(policy({ enabled: false }), "en")).toBeNull();
    expect(
      resolveReturnPolicyPage(
        policy({ intro: "", steps: [], detailSections: [] }),
        "en",
      ),
    ).toBeNull();
    expect(resolveReturnPolicyPage(undefined, "en")).toBeNull();
  });
});

/* ================================================================== */
/*  Contact                                                           */
/* ================================================================== */

describe("resolveContactPage", () => {
  it("always resolves — the form is the page", () => {
    // Unlike the other two this never returns null: /contact is linked from
    // the footer and its job is to take a message, banner or no banner.
    expect(resolveContactPage(undefined, "en").heading).toBeTruthy();
    expect(resolveContactPage(banner({ enabled: false }), "en").heading).toBe(
      "We Would Love To Hear From You",
    );
  });

  it("returns the CMS heading, description and directions link", () => {
    const view = resolveContactPage(
      banner({ directionsUrl: "https://maps.example.com/mach" }),
      "en",
    );
    expect(view.heading).toBe("We Would Love To Hear From You");
    expect(view.description).toBe("Drop us a message.");
    expect(view.directionsUrl).toBe("https://maps.example.com/mach");
  });

  it("drops banner images when the banner is switched off", () => {
    const slides = [{ id: "a", imageUrl: "/uploads/a.webp" }];
    expect(resolveContactPage(banner({ slides }), "en").images).toHaveLength(1);
    expect(
      resolveContactPage(banner({ slides, enabled: false }), "en").images,
    ).toHaveLength(0);
  });

  it("skips slides with no image", () => {
    const view = resolveContactPage(
      banner({
        slides: [
          { id: "a", imageUrl: "" },
          { id: "b", imageUrl: "b.webp", alt: "Shop front" },
        ],
      }),
      "en",
    );
    expect(view.images).toEqual([
      { id: "b", imageUrl: "/uploads/b.webp", mobileImageUrl: null, alt: "Shop front" },
    ]);
  });
});

/* ================================================================== */
/*  Routing and wiring — structural                                   */
/* ================================================================== */

describe("content routes are not Minimal-only", () => {
  const routes = [
    "pages/about-us/+Page.tsx",
    "pages/contact/+Page.tsx",
    "pages/return-policy/+Page.tsx",
  ];

  it("no longer answers a real route with 'Page not found'", () => {
    // This exact string, behind `if (!isMinimal)`, is the bug. It must not
    // come back: the routes exist, so claiming they don't is a lie the
    // storefront links to from its own navbar and footer.
    for (const route of routes) {
      expect(read(route)).not.toContain("Page not found");
    }
  });

  it("renders Mach presentation for the editorial storefront", () => {
    expect(read("pages/about-us/+Page.tsx")).toContain("<MachAboutPage");
    expect(read("pages/return-policy/+Page.tsx")).toContain(
      "<MachReturnPolicyPage",
    );
    expect(read("pages/contact/+Page.tsx")).toContain("<MachContactPage");
  });

  it("keeps the Minimal rendering intact", () => {
    // Minimal still gets its own components and its own markup — this change
    // adds a branch, it does not replace one storefront's pages with another's.
    expect(read("pages/return-policy/+Page.tsx")).toContain(
      "<ReturnPolicyPage content=",
    );
    expect(read("pages/contact/+Page.tsx")).toContain("minimal-template");
    expect(read("pages/about-us/+Page.tsx")).toContain("isMinimal");
  });

  it("wraps the Mach pages in the chrome the other Mach pages use", () => {
    // MachChrome is what hides the global footer and renders the Mach one.
    // Without it these pages would stack the generic site footer under Mach
    // navigation.
    const shell = read(
      "components/template-system/mach/pages/MachPageShell.tsx",
    );
    expect(shell).toContain("<MachChrome>");
    expect(shell).toContain('from "../MachChrome"');
  });

  it("does not duplicate the navbar — LayoutDefault still owns it", () => {
    const dir = "components/template-system/mach/pages/";
    for (const file of [
      "MachPageShell.tsx",
      "MachAboutPage.tsx",
      "MachContactPage.tsx",
      "MachReturnPolicyPage.tsx",
    ]) {
      expect(read(dir + file)).not.toContain("MachNavbar");
    }
  });

  it("loads CMS content server-side so a direct hit and a refresh both work", () => {
    // +data runs on the server for a direct GET, so these pages do not depend
    // on a client-side navigation from "/" to have their content.
    for (const route of ["about-us", "contact", "return-policy"]) {
      const data = read(`pages/${route}/+data.ts`);
      expect(data).toContain("export const data = async (ctx: PageContext)");
      expect(data).toContain("getHomepageContentRaw");
      expect(data).toContain("ctx.templateSelection");
    }
  });

  it("gives each route its own title and description", () => {
    for (const route of ["about-us", "contact", "return-policy"]) {
      const title = read(`pages/${route}/+title.ts`);
      // Uses the project's Vike +title pattern and the shared brand name
      // rather than a second metadata mechanism.
      expect(title).toContain("export default function title");
      expect(title).toContain("pageContext.brandName || STORE_NAME");
      expect(read(`pages/${route}/+config.ts`)).toContain("description:");
    }
    expect(read("pages/about-us/+title.ts")).toContain("`About ${brand}`");
    expect(read("pages/contact/+title.ts")).toContain("`Contact ${brand}`");
    expect(read("pages/return-policy/+title.ts")).toContain(
      "`Shipping & Returns | ${brand}`",
    );
  });
});

describe("contact submits through the one existing mutation", () => {
  it("is the same trpc.contact.submit for both templates", () => {
    const hook = read("hooks/useContactForm.ts");
    expect(hook).toContain("trpc.contact.submit.mutate");
    // Neither page may open a second submit path.
    for (const route of ["pages/contact/+Page.tsx"]) {
      expect(read(route)).not.toContain("trpc.contact.submit");
      expect(read(route)).toContain("useContactForm");
    }
    expect(
      read("components/template-system/mach/pages/MachContactPage.tsx"),
    ).toContain("useContactForm");
  });

  it("reads the contact address from the active template, not a hard-coded one", () => {
    // Layout settings are template-scoped. Pinned to "landing-minimal" the
    // mutation read a row this store's admin cannot edit, so every Mach
    // submission failed with "Contact email not configured".
    const router = read("backend/contact/trpc.ts");
    expect(router).not.toContain('"landing-minimal"');
    expect(router).toContain("getTemplateSelectionRaw(ctx.db)");
    expect(router.replace(/\s+/g, " ")).toContain(
      "getLayoutSettings( merchantId, activeLandingTemplate, )",
    );
  });
});

describe("navigation links resolve to routes that exist", () => {
  /**
   * Every internal destination the shipped chrome renders must be a route in
   * pages/, or an explicit placeholder that the chrome renders inert.
   *
   * Placeholders are fine — MachFooter prints them as a dead "Soon" label
   * rather than a link. Silent 404s are not.
   */
  const ROUTE_FILES = [
    "/",
    "/shop",
    "/search",
    "/cart",
    "/account",
    "/orders",
    "/login",
    "/register",
    "/about-us",
    "/contact",
    "/return-policy",
    "/offers",
  ];

  function internalDestinations(): string[] {
    const urls: string[] = [];
    for (const link of DEFAULT_LAYOUT_SETTINGS.header.navigationLinks) {
      urls.push(link.url);
    }
    for (const group of DEFAULT_LAYOUT_SETTINGS.footer.footerLinkGroups) {
      for (const link of group.links) urls.push(link.url);
    }
    return urls;
  }

  it("every shipped navbar and footer destination is a real route or a marked placeholder", () => {
    for (const url of internalDestinations()) {
      if (url === "#soon") continue; // rendered inert by design
      expect(url.startsWith("/")).toBe(true);
      const routePath = url.split("?")[0] ?? "";
      expect(ROUTE_FILES).toContain(routePath);
    }
  });

  it("ships no bare '#', empty or javascript: destination in the nav", () => {
    for (const url of internalDestinations()) {
      expect(url).not.toBe("");
      expect(url).not.toBe("#");
      expect(url.toLowerCase().startsWith("javascript:")).toBe(false);
    }
  });

  it("links About, Contact and Shipping & Returns at the three fixed routes", () => {
    const urls = internalDestinations();
    expect(urls).toContain("/about-us");
    expect(urls).toContain("/contact");
    expect(urls).toContain("/return-policy");
  });
});

describe("the CMS controls for these pages reach the Mach admin", () => {
  it("no longer hides About / Contact / Return Policy behind isMinimal", () => {
    // The public routes and the admin cards were gated together. Un-gating
    // only the routes would leave the Mach admin unable to edit pages their
    // own storefront now serves.
    const admin = read("pages/dashboard/admin/homepage/+Page.tsx");
    expect(admin).toContain("const hasContentPages = isMinimal || isMach;");

    const GATES = [
      "{hasContentPages && (",
      "{isMinimal && (",
      "{!isMinimal && (",
      "{isMach && (",
      "{!isMach && (",
    ];

    for (const anchor of [
      ">About Us Page</CardTitle>",
      ">Return Policy Page</CardTitle>",
      "Contact Page Banner & Content",
    ]) {
      const at = admin.indexOf(anchor);
      expect(at).toBeGreaterThan(0);
      // Whichever gate sits closest above the card is the one that decides
      // whether a Mach admin can see it.
      const nearest = GATES.map((gate) => ({
        gate,
        at: admin.lastIndexOf(gate, at),
      })).reduce((best, candidate) =>
        candidate.at > best.at ? candidate : best,
      );
      expect(nearest.gate).toBe("{hasContentPages && (");
    }
  });
});
