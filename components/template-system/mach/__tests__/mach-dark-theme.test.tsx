import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_HOMEPAGE_CONTENT,
  groupSectionKey,
  type HomepageCategoriesContent,
  type HomepageCertificatesContent,
  type HomepageContent,
  type HomepageUgcContent,
  type MachSectionBackground,
} from "#root/shared/types/homepage-content";
import { resolveRowGrounds } from "#root/components/template-system/landing/mach-row-grounds";
import { MachProductSection } from "#root/components/template-system/landing/MachProductSection";
import { isMachDarkTheme, MACH_THEME_CLASS } from "../machTheme";
import { MachProductCard, type MachProduct } from "../MachProductCard";
import { machSectionBackdrop } from "../sections/MachSectionBackdrop";
import {
  MACH_ROW_GROUND_CLASSES,
  type MachRowGround,
} from "../sections/MachProductRow";
import { MachUgcSection } from "../sections/MachUgcSection";
import { MachTestimonials } from "../sections/MachTestimonials";
import { MachClosingCta } from "../sections/MachClosingCta";
import { MachCertificates } from "../sections/MachCertificates";
import { MachCategoryTiles } from "../sections/MachCategoryTiles";

/**
 * The Mach storefront is dark by default.
 *
 * These pin the three halves of that rule: the page-level scope switches on
 * for the Mach chrome only; every Mach surface with no media of its own lands
 * on an ink ground; and nothing about a section's configured image or video,
 * or a product photo's white stage, moves with the theme.
 */

vi.mock("#root/components/template-system/mach/useMachAddToCart", () => ({
  useMachAddToCart: () => ({ add: () => true, confirmed: false }),
}));

const PRODUCT = {
  id: "p1",
  name: "Knee Wrap",
  price: 400,
  discountPrice: 350,
  stock: 8,
  available: true,
  categoryName: "Gym Gear",
  images: [{ url: "/uploads/knee.webp", isPrimary: true }],
} as unknown as MachProduct;

const IMAGE_BG: MachSectionBackground = {
  type: "image",
  url: "/uploads/homepage/sec-bg.webp",
  textTheme: "light",
  overlayOpacity: 40,
};

/** A light page/section ground: white, or either of the paper steps. */
const LIGHT_GROUND = /(^|\s)(bg-white|bg-\[var\(--mach-paper(-soft)?\)\])(\s|$)/;

/** The class list of the first `<section>` in the markup. */
function sectionClass(html: string): string {
  const cls = html.match(/<section\b[^>]*class="([^"]*)"/)?.[1];
  if (cls === undefined) throw new Error("no <section> rendered");
  return cls;
}

/* ================================================================== */
/*  The page-level scope                                              */
/* ================================================================== */

describe("the Mach page theme", () => {
  it("is on for the Mach chrome on storefront routes", () => {
    expect(
      isMachDarkTheme({ navbarStyle: "editorial", isDashboardRoute: false }),
    ).toBe(true);
  });

  it("never reaches the dashboard", () => {
    expect(
      isMachDarkTheme({ navbarStyle: "editorial", isDashboardRoute: true }),
    ).toBe(false);
  });

  it("leaves every other template's chrome on the light tokens", () => {
    for (const navbarStyle of ["default", "minimal", undefined]) {
      expect(
        isMachDarkTheme({ navbarStyle, isDashboardRoute: false }),
      ).toBe(false);
    }
  });

  describe("stylesheet", () => {
    const css = readFileSync(
      path.resolve(__dirname, "../../../../layouts/style.css"),
      "utf8",
    );

    it("re-points the shared tokens to ink inside the scope", () => {
      const block = css.match(
        new RegExp(`\\.${MACH_THEME_CLASS}\\s*\\{([^}]*)\\}`),
      )?.[1];
      expect(block).toBeDefined();
      expect(block).toContain("--background: var(--mach-ink)");
      expect(block).toContain("--foreground: #ffffff");
      expect(block).toContain("--border: var(--mach-ink-line)");
    });

    it("stops the token scope at <main>, so shared overlays keep theirs", () => {
      // The consent banner is mounted beside <main> and pairs the light tokens
      // with hard-coded stone buttons; flipping its tokens would leave dark
      // text on a dark bar.
      expect(css).not.toMatch(/html\[data-mach-theme="dark"\] body\s*\{[^}]*--background/);
    });

    it("declares the scoped variant the shared templates use", () => {
      expect(css).toContain(
        `@custom-variant mach-dark (&:is(.${MACH_THEME_CLASS} *));`,
      );
    });
  });
});

/* ================================================================== */
/*  Merchandising rows                                                */
/* ================================================================== */

describe("merchandising row grounds", () => {
  const A = groupSectionKey("a");
  const B = groupSectionKey("b");
  const order = ["featuredProducts", A, "discountedProducts", B, "newArrivals"];
  const renders = { featuredProducts: true, [A]: true, [B]: true, newArrivals: true };

  it("alternates dark grounds only", () => {
    const grounds = [...resolveRowGrounds(order, renders).values()];
    expect(grounds).toEqual(["ink-soft", "ink-raised", "ink-soft", "ink-raised"]);
  });

  it("never hands an alternating row the Offers anchor's own ground", () => {
    for (const ground of resolveRowGrounds(order, renders).values()) {
      expect(ground).not.toBe("ink");
    }
  });

  it("reads every dark ground as a dark surface", () => {
    for (const ground of ["ink", "ink-soft", "ink-raised"] as MachRowGround[]) {
      expect(machSectionBackdrop(ground, undefined).onDark).toBe(true);
      expect(MACH_ROW_GROUND_CLASSES[ground]).toContain("text-white");
    }
  });

  it("keeps the alternating rows' top rule, in the dark hairline", () => {
    expect(machSectionBackdrop("ink-soft", undefined).ruleCls).toContain(
      "border-[var(--mach-ink-line)]",
    );
    expect(machSectionBackdrop("ink-raised", undefined).ruleCls).toContain(
      "border-t",
    );
    // Offers never had one.
    expect(machSectionBackdrop("ink", undefined).ruleCls).toBe("");
  });

  it("falls back to a dark ground when no ground is passed", () => {
    for (const displayMode of ["grid", "carousel"] as const) {
      const html = renderToStaticMarkup(
        <MachProductSection
          title="BEST SELLERS"
          products={[PRODUCT]}
          displayMode={displayMode}
        />,
      );
      expect(sectionClass(html)).not.toMatch(LIGHT_GROUND);
      expect(sectionClass(html)).toContain("text-white");
    }
  });
});

/* ================================================================== */
/*  Media sections are untouched                                      */
/* ================================================================== */

describe("a section with its own image or video", () => {
  it("renders identically whatever ground the theme would have given it", () => {
    // The same background on a light ground (the old rhythm) and a dark one
    // (the new): section class, content wrapper, rule and type all match.
    for (const bg of [IMAGE_BG, { ...IMAGE_BG, textTheme: "dark" as const }]) {
      const light = machSectionBackdrop("paper", bg);
      for (const dark of ["ink-soft", "ink-raised"] as MachRowGround[]) {
        expect(machSectionBackdrop(dark, bg)).toEqual(light);
      }
    }
  });

  it("paints no ground over the media", () => {
    const state = machSectionBackdrop("ink-soft", IMAGE_BG);
    expect(state.sectionCls).not.toMatch(/(^|\s)bg-/);
  });

  it("keeps the media, its wash and its fit", () => {
    const html = renderToStaticMarkup(
      <MachProductSection
        title="STACKS"
        products={[PRODUCT]}
        displayMode="grid"
        ground="ink-raised"
        background={IMAGE_BG}
      />,
    );
    expect(html).toContain(`src="${IMAGE_BG.url}"`);
    expect(html).toContain("object-cover");
    expect(html).toContain("background-color:rgba(0,0,0,0.4)");
  });
});

/* ================================================================== */
/*  Product photography                                               */
/* ================================================================== */

describe("the product card on the dark ground", () => {
  const stageOf = (props: Partial<Parameters<typeof MachProductCard>[0]>) => {
    const html = renderToStaticMarkup(
      <MachProductCard product={PRODUCT} {...props} />,
    );
    return { html, stage: html.match(/<div class="group relative"><div class="([^"]*)"/)?.[1] ?? "" };
  };

  it("keeps the photo's white stage at every size and in the shop grid", () => {
    for (const props of [
      { onDark: true },
      { onDark: true, size: "lg" as const },
      { onDark: true, variant: "shop" as const },
    ]) {
      const { stage } = stageOf(props);
      expect(stage).toContain("bg-white");
      expect(stage).not.toContain("mach-ink-raised");
      expect(stage).not.toMatch(/(^|\s)p-/);
    }
  });

  it("lights only the type underneath", () => {
    const { html } = stageOf({ onDark: true, variant: "shop" });
    expect(html).toMatch(/<h3 class="[^"]*text-white/);
  });
});

/* ================================================================== */
/*  Homepage sections without media                                   */
/* ================================================================== */

describe("homepage sections with no media of their own", () => {
  const content = DEFAULT_HOMEPAGE_CONTENT as HomepageContent;

  const cases: Array<[string, () => string]> = [
    [
      "customer videos",
      () =>
        renderToStaticMarkup(
          <MachUgcSection
            content={{
              ...(content.ugc as HomepageUgcContent),
              enabled: true,
              items: [{ id: "v1", videoUrl: "/uploads/homepage/ugc-1.mp4" }],
            }}
          />,
        ),
    ],
    [
      "testimonials",
      () =>
        renderToStaticMarkup(
          <MachTestimonials
            content={{
              enabled: true,
              title: "What our customers say",
              items: [{ name: "Sara", rating: 5, review: "Great." }],
            }}
          />,
        ),
    ],
    [
      "closing call to action",
      () =>
        renderToStaticMarkup(
          <MachClosingCta
            content={{ ...content.footerCta, enabled: true, title: "Next session" }}
          />,
        ),
    ],
    [
      "certificates",
      () =>
        renderToStaticMarkup(
          <MachCertificates
            content={{
              ...(content.certificates as HomepageCertificatesContent),
              enabled: true,
              items: [
                {
                  id: "c1",
                  title: "ISO 9001",
                  thumbnailUrl: "/uploads/homepage/certificate-1.webp",
                },
              ],
            }}
          />,
        ),
    ],
    [
      "category tiles",
      () =>
        renderToStaticMarkup(
          <MachCategoryTiles
            content={{
              ...(content.categories as HomepageCategoriesContent),
              title: "Shop by goal",
              categoryIds: ["c1"],
            }}
            categories={[
              { id: "c1", name: "Supplements", slug: "supplements", imageUrl: "/uploads/c1.jpg" },
            ]}
          />,
        ),
    ],
  ];

  for (const [name, render] of cases) {
    it(`puts the ${name} on an ink ground`, () => {
      const cls = sectionClass(render());
      expect(cls).not.toMatch(LIGHT_GROUND);
      expect(cls).toMatch(/bg-\[var\(--mach-ink(-soft|-raised)?\)\]/);
    });
  }

  it("keeps the certificate's own white page", () => {
    // The document mat is the certificate's paper, not a section ground.
    const render = cases.find(([name]) => name === "certificates")?.[1];
    if (!render) throw new Error("certificates case missing");
    const html = render();
    expect(html).toMatch(/<button[^>]*class="[^"]*bg-white/);
  });
});
