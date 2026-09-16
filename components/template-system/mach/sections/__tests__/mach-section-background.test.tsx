import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MachSectionBackground } from "#root/shared/types/homepage-content";
import type { MachProduct } from "../../MachProductCard";
import { MachProductSection } from "#root/components/template-system/landing/MachProductSection";
import { machSectionBackdrop } from "../MachSectionBackdrop";
import { MACH_ROW_GROUND_CLASSES } from "../MachProductRow";

/**
 * What a section background actually puts on the page.
 *
 * Rendered through `MachProductSection` — the component the homepage layout
 * itself calls — rather than through each arrangement directly, because the
 * promise being tested is that the setting behaves the same in all of them: a
 * grid, a carousel and a group's feature panels each get the same layer, and a
 * section with no background configured is untouched.
 *
 * Static markup, not a mounted browser. Every rule here is about what is in
 * the DOM and in what order — is the media behind the content, is the video
 * muted, does an unconfigured section still paint its ground — and none of it
 * needs a layout engine to answer.
 */

// The add-to-cart path reaches for the cart and tracking providers, which a
// static render has none of. The control is not what is under test here and
// its own behaviour is covered elsewhere.
vi.mock("#root/components/template-system/mach/useMachAddToCart", () => ({
  useMachAddToCart: () => ({ add: () => true, confirmed: false }),
}));

const PRODUCTS: MachProduct[] = [
  {
    id: "p1",
    name: "Whey Isolate",
    price: 900,
    stock: 8,
    available: true,
    imageUrl: "/uploads/whey.webp",
  },
  {
    id: "p2",
    name: "Creatine",
    price: 450,
    stock: 4,
    available: true,
    imageUrl: "/uploads/creatine.webp",
  },
] as MachProduct[];

const IMAGE: MachSectionBackground = {
  type: "image",
  url: "/uploads/section-bg.webp",
};
const VIDEO: MachSectionBackground = {
  type: "video",
  url: "/uploads/section-bg.mp4",
};

type Arrangement = {
  name: string;
  props: Parameters<typeof MachProductSection>[0];
};

/** The four ways a product section can be arranged on this page. */
const ARRANGEMENTS: Arrangement[] = [
  {
    name: "grid",
    props: { title: "BEST SELLERS", products: PRODUCTS, displayMode: "grid" },
  },
  {
    name: "carousel",
    props: {
      title: "BEST SELLERS",
      products: PRODUCTS,
      displayMode: "carousel",
    },
  },
  {
    name: "group shelf",
    props: {
      title: "SUPPLEMENTS",
      products: PRODUCTS,
      displayMode: "grid",
      presentation: "shelf",
    },
  },
  {
    name: "group feature",
    props: {
      title: "STACKS AND BUNDLES",
      products: PRODUCTS,
      displayMode: "grid",
      presentation: "feature",
    },
  },
];

function render(
  arrangement: Arrangement,
  background?: MachSectionBackground,
): string {
  return renderToStaticMarkup(
    <MachProductSection {...arrangement.props} background={background} />,
  );
}

/* ================================================================== */
/*  No background — the storefront as it stands                       */
/* ================================================================== */

describe("a section with no background", () => {
  for (const arrangement of ARRANGEMENTS) {
    it(`renders exactly as it did in ${arrangement.name}`, () => {
      const none = render(arrangement);
      const missing = render(arrangement, { type: "none" });
      // Configured to "none", or never configured at all: the same page.
      expect(missing).toBe(none);

      expect(none).not.toContain("<video");
      expect(none).not.toContain("section-bg");
      // The flat ground is still painted, and the content is not lifted onto
      // a stacking level it never needed.
      expect(none).toContain("bg-");
      expect(none).not.toContain("relative isolate overflow-hidden");
    });
  }

  it("keeps its ground when the media is removed", () => {
    // What "Remove" leaves behind: the type still set, the url emptied.
    const removed = render(ARRANGEMENTS[0]!, { type: "image", url: "" });

    expect(removed).toBe(render(ARRANGEMENTS[0]!));
  });
});

/* ================================================================== */
/*  Image                                                             */
/* ================================================================== */

describe("an image background", () => {
  for (const arrangement of ARRANGEMENTS) {
    it(`covers the whole section in ${arrangement.name}`, () => {
      const html = render(arrangement, IMAGE);

      expect(html).toContain(IMAGE.url);
      expect(html).toContain("absolute inset-0");
      expect(html).toContain("object-cover");
      // Decorative: no alt text, hidden from assistive technology, and never
      // in the way of a click on a product.
      expect(html).toContain('alt=""');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain("pointer-events-none");
    });

    it(`sits behind the section's content in ${arrangement.name}`, () => {
      const html = render(arrangement, IMAGE);

      // Behind, structurally: the layer is inside the <section> and precedes
      // the content wrapper, which is the one lifted above it. So the heading,
      // the products, the controls and the link are all over the media rather
      // than only the cards.
      const layer = html.indexOf(IMAGE.url as string);
      const content = html.indexOf("relative z-10");
      const heading = html.indexOf(arrangement.props.title);
      expect(layer).toBeGreaterThan(-1);
      expect(content).toBeGreaterThan(layer);
      expect(heading).toBeGreaterThan(content);
    });
  }

  it("replaces the ground's fill without touching its type colour", () => {
    // Offers is the page's ink anchor: white type, whatever is behind it.
    const backdrop = machSectionBackdrop("ink", IMAGE);

    expect(backdrop.active).toBe(true);
    expect(backdrop.sectionCls).toContain("text-white");
    expect(backdrop.sectionCls).not.toContain("bg-[var(--mach-ink)]");
    expect(backdrop.contentCls).toBe("relative z-10");
  });

  it("leaves the ground alone when there is nothing to lay behind it", () => {
    expect(machSectionBackdrop("ink", undefined).sectionCls).toBe(
      MACH_ROW_GROUND_CLASSES.ink,
    );
    expect(machSectionBackdrop("paper", { type: "none" }).sectionCls).toBe(
      MACH_ROW_GROUND_CLASSES.paper,
    );
    expect(machSectionBackdrop("white", undefined).contentCls).toBe("");
  });
});

/* ================================================================== */
/*  Video                                                             */
/* ================================================================== */

describe("a video background", () => {
  for (const arrangement of ARRANGEMENTS) {
    it(`plays silently behind ${arrangement.name}`, () => {
      const html = render(arrangement, VIDEO);

      expect(html).toContain("<video");
      expect(html).toContain(VIDEO.url);
      // Decorative media: it plays itself, says nothing, and offers the
      // shopper no controls to fight with.
      expect(html).toMatch(/<video[^>]*\bautoplay\b/i);
      expect(html).toMatch(/<video[^>]*\bmuted\b/i);
      expect(html).toMatch(/<video[^>]*\bloop\b/i);
      expect(html).toMatch(/<video[^>]*playsinline/i);
      expect(html).not.toMatch(/<video[^>]*\bcontrols\b/i);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain("pointer-events-none");
      expect(html).toContain("object-cover");
    });
  }

  it("takes its height from the section rather than imposing one", () => {
    // `inset-0` and `object-cover`, and no height anywhere: a section with a
    // background is exactly as tall as the same section without one.
    const html = render(ARRANGEMENTS[0]!, VIDEO);

    expect(html).toContain("absolute inset-0");
    expect(html).not.toMatch(/<video[^>]*h-\[/);
    expect(html).not.toMatch(/<video[^>]*min-h-/);
  });
});

/* ================================================================== */
/*  Nothing else moves                                                */
/* ================================================================== */

describe("the section around the background", () => {
  it("keeps every product, in order, in both display modes", () => {
    for (const arrangement of ARRANGEMENTS) {
      const plain = render(arrangement);
      const withMedia = render(arrangement, IMAGE);

      for (const product of PRODUCTS) {
        expect(plain).toContain(product.name);
        expect(withMedia).toContain(product.name);
      }
      expect(withMedia.indexOf("Whey Isolate")).toBeLessThan(
        withMedia.indexOf("Creatine"),
      );
    }
  });

  it("renders the URL an upload actually returns, untouched", () => {
    // The shape `homepage.uploadMedia` hands back — root-relative, already
    // resolvable — so `normalizeMediaUrl` must pass it through rather than
    // prefixing it into a 404.
    const uploaded = "/uploads/homepage/sec-bg-best-sellers-01a0aac1.webp";
    const html = render(ARRANGEMENTS[0]!, { type: "image", url: uploaded });

    expect(html).toContain(`src="${uploaded}"`);
  });

  it("keeps the carousel's controls", () => {
    const withMedia = render(ARRANGEMENTS[1]!, VIDEO);

    expect(withMedia).toContain("Previous products in BEST SELLERS");
    expect(withMedia).toContain("Next products in BEST SELLERS");
    // The track still scrolls: the background sits behind it, not over it.
    expect(withMedia).toContain("overflow-x-auto");
  });
});
