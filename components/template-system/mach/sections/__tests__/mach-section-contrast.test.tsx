import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_HOMEPAGE_CONTENT,
  MACH_LANDING_TEMPLATE_ID,
  clampSectionOverlayOpacity,
  resolveSectionBackground,
  type HomepageContent,
  type MachSectionBackground,
} from "#root/shared/types/homepage-content";
import { resolveGroupSections } from "#root/shared/types/homepage-group-sections";
import { mergeHomepageContentWithDefaults } from "#root/backend/homepage/merge-homepage-content";
import type { MachProduct } from "../../MachProductCard";
import { MachProductSection } from "#root/components/template-system/landing/MachProductSection";
import { machSectionBackdrop } from "../MachSectionBackdrop";
import { MACH_ROW_GROUND_CLASSES } from "../MachProductRow";

/**
 * How a section reads on top of its own background.
 *
 * A photograph has no single brightness — a heading can sit over sky while the
 * prices sit over asphalt — so readability here is a decision the client
 * makes, not something measured off the image. Two settings carry it: which
 * way the type reads, and how hard the picture is washed back behind it.
 *
 * The rule these tests exist to protect is the one that is easy to get wrong
 * in the opposite direction: making the section's type readable must not turn
 * the product cards inside out. A Mach shelf card stands its pack shot on an
 * *opaque white tile* on every ground, dark ones included, and the name, meta
 * and price sit underneath it directly on the section. So a light text theme
 * has to light the words on the section and leave the tile alone — white text
 * on a white tile is the failure mode, and it is asserted against below.
 */

vi.mock("#root/components/template-system/mach/useMachAddToCart", () => ({
  useMachAddToCart: () => ({ add: () => true, confirmed: false }),
}));

const PRODUCTS: MachProduct[] = [
  {
    id: "p1",
    name: "Whey Isolate",
    price: 900,
    discountPrice: 700,
    stock: 8,
    available: true,
    categoryName: "Protein",
    imageUrl: "/uploads/whey.webp",
  },
] as MachProduct[];

const IMAGE = "/uploads/homepage/sec-bg.webp";
const VIDEO = "/uploads/homepage/sec-bg.mp4";

type Arrangement = {
  name: string;
  props: Parameters<typeof MachProductSection>[0];
};

const GRID: Arrangement = {
  name: "grid",
  props: { title: "BEST SELLERS", products: PRODUCTS, displayMode: "grid" },
};
const CAROUSEL: Arrangement = {
  name: "carousel",
  props: { title: "BEST SELLERS", products: PRODUCTS, displayMode: "carousel" },
};
const FEATURE: Arrangement = {
  name: "feature",
  props: {
    title: "STACKS",
    products: PRODUCTS,
    displayMode: "grid",
    presentation: "feature",
  },
};
const ARRANGEMENTS = [GRID, CAROUSEL, FEATURE];

function render(
  arrangement: Arrangement,
  background?: MachSectionBackground,
): string {
  return renderToStaticMarkup(
    <MachProductSection {...arrangement.props} background={background} />,
  );
}

/** The section element's own class list. */
function sectionClasses(html: string): string {
  return html.match(/<section[^>]*class="([^"]*)"/)?.[1] ?? "";
}

/** The inline background colour of the overlay layer, if there is one. */
function overlayColor(html: string): string | null {
  return html.match(/z-\[1\][^>]*style="background-color:([^"]*)"/)?.[1] ?? null;
}

/** Save → jsonb → merge, the way the CMS actually persists a section. */
function saveAndReload(overrides: Partial<HomepageContent>): HomepageContent {
  const stored = JSON.parse(
    JSON.stringify({ ...DEFAULT_HOMEPAGE_CONTENT, ...overrides }),
  ) as Partial<HomepageContent>;
  return mergeHomepageContentWithDefaults(stored, MACH_LANDING_TEMPLATE_ID);
}

/* ================================================================== */
/*  The no-background path                                            */
/* ================================================================== */

describe("a section with no background", () => {
  for (const arrangement of ARRANGEMENTS) {
    it(`is untouched by the contrast controls in ${arrangement.name}`, () => {
      const none = render(arrangement);

      // No overlay, no wash, no change of ground or type colour.
      expect(none).not.toContain("z-[1]");
      expect(none).not.toContain("background-color:rgba");
      expect(none).toBe(render(arrangement, { type: "none" }));
      // A treatment saved against a background that was later switched off
      // changes nothing either.
      expect(none).toBe(
        render(arrangement, {
          type: "none",
          textTheme: "light",
          overlayOpacity: 80,
        }),
      );
    });
  }

  it("keeps the ground deciding how its type reads", () => {
    // The rule the page has always followed: ink grounds carry light type,
    // paper and white grounds carry dark type.
    expect(machSectionBackdrop("ink", undefined).onDark).toBe(true);
    expect(machSectionBackdrop("paper", undefined).onDark).toBe(false);
    expect(machSectionBackdrop("white", { type: "none" }).onDark).toBe(false);
    expect(machSectionBackdrop("ink", undefined).sectionCls).toBe(
      MACH_ROW_GROUND_CLASSES.ink,
    );
  });
});

/* ================================================================== */
/*  Defaults                                                          */
/* ================================================================== */

describe("a background with no treatment saved", () => {
  it("defaults an image to light text over a 40% black wash", () => {
    const resolved = resolveSectionBackground({ type: "image", url: IMAGE });

    expect(resolved.textTheme).toBe("light");
    expect(resolved.overlayOpacity).toBe(40);
    expect(overlayColor(render(GRID, { type: "image", url: IMAGE }))).toBe(
      "rgba(0,0,0,0.4)",
    );
  });

  it("defaults a video the same way", () => {
    const resolved = resolveSectionBackground({ type: "video", url: VIDEO });

    expect(resolved.textTheme).toBe("light");
    expect(resolved.overlayOpacity).toBe(40);
    expect(overlayColor(render(GRID, { type: "video", url: VIDEO }))).toBe(
      "rgba(0,0,0,0.4)",
    );
  });

  it("bounds anything unusable to the 0-80 range", () => {
    expect(clampSectionOverlayOpacity(undefined)).toBe(40);
    expect(clampSectionOverlayOpacity(null)).toBe(40);
    expect(clampSectionOverlayOpacity(Number.NaN)).toBe(40);
    expect(clampSectionOverlayOpacity(-20)).toBe(0);
    expect(clampSectionOverlayOpacity(140)).toBe(80);
  });
});

/* ================================================================== */
/*  What the client saved comes back                                  */
/* ================================================================== */

describe("a saved contrast treatment", () => {
  it("persists light and dark themes through a save", () => {
    const reloaded = saveAndReload({
      featuredProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
        background: { type: "image", url: IMAGE, textTheme: "light" },
      },
      newArrivals: {
        ...DEFAULT_HOMEPAGE_CONTENT.newArrivals!,
        background: { type: "image", url: IMAGE, textTheme: "dark" },
      },
    });

    expect(reloaded.featuredProducts.background?.textTheme).toBe("light");
    expect(reloaded.newArrivals?.background?.textTheme).toBe("dark");
  });

  it("persists an overlay at either end of the range", () => {
    const reloaded = saveAndReload({
      featuredProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
        background: { type: "image", url: IMAGE, overlayOpacity: 0 },
      },
      discountedProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.discountedProducts!,
        background: { type: "video", url: VIDEO, overlayOpacity: 80 },
      },
    });

    // Zero is a real setting, not a missing one: it must survive rather than
    // falling back to the default.
    expect(reloaded.featuredProducts.background?.overlayOpacity).toBe(0);
    expect(
      resolveSectionBackground(reloaded.featuredProducts.background)
        .overlayOpacity,
    ).toBe(0);
    expect(reloaded.discountedProducts?.background?.overlayOpacity).toBe(80);
  });

  it("belongs to one section at a time", () => {
    const reloaded = saveAndReload({
      featuredProducts: {
        ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
        background: {
          type: "image",
          url: IMAGE,
          textTheme: "dark",
          overlayOpacity: 10,
        },
      },
      groupSections: [
        {
          categoryId: "11111111-1111-1111-1111-111111111111",
          enabled: true,
          background: {
            type: "video",
            url: VIDEO,
            textTheme: "light",
            overlayOpacity: 75,
          },
        },
        { categoryId: "22222222-2222-2222-2222-222222222222", enabled: true },
      ],
    });

    const [supplements, gymGear] = resolveGroupSections(reloaded, [
      { id: "11111111-1111-1111-1111-111111111111", name: "Supplements", slug: "supplements" },
      { id: "22222222-2222-2222-2222-222222222222", name: "Gym Gear", slug: "gym-gear" },
    ]);

    expect(reloaded.featuredProducts.background).toMatchObject({
      textTheme: "dark",
      overlayOpacity: 10,
    });
    expect(supplements?.background).toMatchObject({
      textTheme: "light",
      overlayOpacity: 75,
    });
    // A group given no background is not given a treatment either.
    expect(gymGear?.background).toEqual({ type: "none" });
  });
});

/* ================================================================== */
/*  The scrim                                                         */
/* ================================================================== */

describe("the overlay", () => {
  it("is black under light text", () => {
    const html = render(GRID, {
      type: "image",
      url: IMAGE,
      textTheme: "light",
      overlayOpacity: 60,
    });

    expect(overlayColor(html)).toBe("rgba(0,0,0,0.6)");
  });

  it("is white under dark text", () => {
    const html = render(GRID, {
      type: "image",
      url: IMAGE,
      textTheme: "dark",
      overlayOpacity: 25,
    });

    expect(overlayColor(html)).toBe("rgba(255,255,255,0.25)");
  });

  it("sits between the media and the content, covering the section", () => {
    const html = render(GRID, { type: "image", url: IMAGE });

    const media = html.indexOf(IMAGE);
    const wash = html.indexOf("z-[1]");
    const content = html.indexOf("relative z-10");
    const heading = html.indexOf("BEST SELLERS");

    expect(media).toBeGreaterThan(-1);
    expect(wash).toBeGreaterThan(media);
    expect(content).toBeGreaterThan(wash);
    expect(heading).toBeGreaterThan(content);
    // Covers everything, and never intercepts a click on a product.
    expect(html).toMatch(/z-\[1\][^>]*/);
    expect(
      html.match(/class="pointer-events-none absolute inset-0 z-\[1\]"/),
    ).not.toBeNull();
  });

  it("never filters the media itself", () => {
    // The wash is a layer; the photograph keeps its own contrast. Scoped to
    // the backdrop's own tag — the product card's image carries a hover
    // opacity of its own, which is nothing to do with this.
    const html = render(GRID, { type: "image", url: IMAGE });
    const backdropImg = html.match(/<img[^>]*z-0[^>]*>/)?.[0] ?? "";

    expect(backdropImg).toContain(IMAGE);
    expect(backdropImg).not.toMatch(/opacity|filter|brightness/);
  });
});

/* ================================================================== */
/*  Typography, in all three arrangements                             */
/* ================================================================== */

describe("section typography on a background", () => {
  for (const arrangement of ARRANGEMENTS) {
    it(`reads light with a light theme in ${arrangement.name}`, () => {
      const html = render(arrangement, {
        type: "image",
        url: IMAGE,
        textTheme: "light",
      });

      // The section's own base colour, and the heading with it.
      expect(sectionClasses(html)).toContain("text-white");
      expect(sectionClasses(html)).not.toContain("bg-white");
      expect(html).toContain("text-white");
    });

    it(`reads dark with a dark theme in ${arrangement.name}`, () => {
      const html = render(arrangement, {
        type: "image",
        url: IMAGE,
        textTheme: "dark",
      });

      expect(sectionClasses(html)).toContain("text-[var(--mach-ink)]");
      expect(sectionClasses(html)).not.toContain("text-white");
    });
  }

  it("lights the product name, meta and price on the shelf", () => {
    const light = render(GRID, { type: "image", url: IMAGE, textTheme: "light" });
    const dark = render(GRID, { type: "image", url: IMAGE, textTheme: "dark" });

    // These sit directly on the section, under the card's tile.
    expect(light).toMatch(/class="[^"]*text-white[^"]*"[^>]*>Whey Isolate/);
    expect(light).toContain("text-white/45");
    expect(dark).toMatch(
      /class="[^"]*text-\[var\(--mach-ink\)\][^"]*"[^>]*>Whey Isolate/,
    );
    expect(dark).toContain("text-[var(--mach-mute)]");
  });

  it("carries the treatment to the carousel's controls", () => {
    const light = render(CAROUSEL, {
      type: "image",
      url: IMAGE,
      textTheme: "light",
    });

    expect(light).toContain("Previous products in BEST SELLERS");
    // The arrows invert on a dark-read section, the same way they do on the
    // ink ground — not left as ink-on-photograph.
    expect(light).toContain("border-white/30");
    expect(light).toContain("focus-visible:ring-white");
  });

  it("keeps the ink section's white type when it gains a background", () => {
    // Offers is the page's ink anchor; a background must not relight it.
    const html = renderToStaticMarkup(
      <MachProductSection
        title='OFFERS'
        products={PRODUCTS}
        displayMode='grid'
        ground='ink'
        background={{ type: "image", url: IMAGE, textTheme: "light" }}
      />,
    );

    expect(sectionClasses(html)).toContain("text-white");
  });
});

/* ================================================================== */
/*  Card surfaces                                                     */
/* ================================================================== */

describe("the product card's own surface", () => {
  it("stays an opaque white tile under a light text theme", () => {
    // The failure this test exists for: lighting the section's type must not
    // leave a white product name on a white tile. The pack shot's tile is
    // opaque white on a dark-read section exactly as it is on the ink ground,
    // and the name sits outside it.
    const html = render(GRID, { type: "image", url: IMAGE, textTheme: "light" });

    expect(html).toContain("bg-white");
    // Not the charcoal stage, which is reserved for the legacy non-dense card.
    expect(html).not.toContain("bg-[var(--mach-ink-raised)]");
  });

  it("keeps the feature panel's own opaque surface", () => {
    // The feature panel is a card in its own right: on a dark-read section it
    // takes the raised ink surface rather than becoming transparent, so its
    // internal text keeps a ground of its own.
    const light = render(FEATURE, {
      type: "image",
      url: IMAGE,
      textTheme: "light",
    });
    const dark = render(FEATURE, {
      type: "image",
      url: IMAGE,
      textTheme: "dark",
    });

    expect(light).toContain("bg-[var(--mach-ink-raised)]");
    expect(dark).toContain("bg-white");
  });

  it("renders the same cards either way", () => {
    for (const arrangement of ARRANGEMENTS) {
      for (const theme of ["light", "dark"] as const) {
        const html = render(arrangement, {
          type: "image",
          url: IMAGE,
          textTheme: theme,
        });
        expect(html).toContain("Whey Isolate");
        expect(html).toContain("/uploads/whey.webp");
      }
    }
  });
});
