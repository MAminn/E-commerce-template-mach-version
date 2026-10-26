// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_LANDING_PAGE_SETTINGS,
  type LandingPageHero,
} from "#root/shared/landing-page/config";
import type { MachProduct } from "../../MachProductCard";
import { MachLanding2Page } from "../MachLanding2Page";

/**
 * /landing-2 as the server renders it: the hero (image or video background,
 * headline, subtitle, optional button) and the selected products, in the
 * chosen order, on the storefront's own product cards.
 */

vi.mock("#root/components/template-system/mach/useMachAddToCart", () => ({
  useMachAddToCart: () => ({ add: () => true, confirmed: false }),
}));

function hero(patch: Partial<LandingPageHero> = {}): LandingPageHero {
  return { ...structuredClone(DEFAULT_LANDING_PAGE_SETTINGS.hero), ...patch };
}

function product(id: string, name: string, extra: Partial<MachProduct> = {}): MachProduct {
  return {
    id,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    price: 1000,
    discountPrice: null,
    stock: 5,
    available: true,
    categoryName: "Protein",
    images: [{ url: `/uploads/${id}.webp`, isPrimary: true }],
    variantCount: 0,
    ...extra,
  } as MachProduct;
}

function render(h: LandingPageHero, products: MachProduct[] = [], productsTitle = "") {
  const html = renderToStaticMarkup(
    <MachLanding2Page hero={h} products={products} productsTitle={productsTitle} />,
  );
  return new DOMParser().parseFromString(html, "text/html");
}

describe("Landing 2 hero", () => {
  it("renders an image background with the headline and subtitle", () => {
    const doc = render(
      hero({
        title: "Summer stack",
        subtitle: "Up to 30% off",
        media: {
          kind: "image",
          desktopUrl: "/uploads/homepage/landing-d.webp",
          mobileUrl: "/uploads/homepage/landing-m.webp",
          alt: "Athlete",
        },
      }),
    );
    expect(doc.querySelector("h1")?.textContent).toBe("Summer stack");
    expect(doc.body.textContent).toContain("Up to 30% off");
    const img = doc.querySelector("section img");
    expect(img?.getAttribute("src")).toBe("/uploads/homepage/landing-d.webp");
    expect(img?.getAttribute("alt")).toBe("Athlete");
    // Above the fold: fetched eagerly.
    expect(img?.getAttribute("loading")).toBe("eager");
    expect(
      doc.querySelector('source[media="(max-width: 767px)"]')?.getAttribute("srcset"),
    ).toBe("/uploads/homepage/landing-m.webp");
  });

  it("renders a video background muted, looping, inline, with its poster", () => {
    const doc = render(
      hero({
        media: {
          kind: "video",
          desktopUrl: "/uploads/homepage/landing-d.mp4",
          mobileUrl: "/uploads/homepage/landing-m.mp4",
          posterUrl: "/uploads/homepage/landing-p.webp",
        },
      }),
    );
    const video = doc.querySelector("video")!;
    expect(video).not.toBeNull();
    for (const attr of ["autoplay", "muted", "loop", "playsinline"]) {
      expect(video.hasAttribute(attr), attr).toBe(true);
    }
    expect(video.getAttribute("poster")).toBe("/uploads/homepage/landing-p.webp");
    const sources = [...video.querySelectorAll("source")].map((s) => s.getAttribute("src"));
    // Mobile first: browsers take the first matching <source>.
    expect(sources).toEqual(["/uploads/homepage/landing-m.mp4", "/uploads/homepage/landing-d.mp4"]);
  });

  it("with no media, still renders the copy on the ink ground", () => {
    const doc = render(hero({ title: "Shop the collection" }));
    expect(doc.querySelector("video")).toBeNull();
    expect(doc.querySelector("section img")).toBeNull();
    expect(doc.querySelector("h1")?.textContent).toBe("Shop the collection");
  });

  it("shows the button only when it has text", () => {
    const withCta = render(hero({ ctaText: "Shop now", ctaLink: "#products" }));
    expect(withCta.querySelector('a[href="#products"]')?.textContent).toContain("Shop now");

    const without = render(hero({ ctaText: "", ctaLink: "" }));
    expect(without.querySelector('a[href="#products"]')).toBeNull();
  });
});

describe("Landing 2 products", () => {
  it("lists the selected products in the chosen order, with live prices", () => {
    const doc = render(hero(), [
      product("c", "Creatine", { price: 800, discountPrice: 650 }),
      product("a", "Whey Isolate", { price: 2400 }),
    ]);
    const section = doc.getElementById("products")!;
    expect(section).not.toBeNull();
    const text = section.textContent ?? "";
    expect(text.indexOf("Creatine")).toBeLessThan(text.indexOf("Whey Isolate"));
    expect(text).toContain("650.00");
    expect(text).toContain("2400.00");
  });

  it("each card links to its product page and offers Add to Cart", () => {
    const doc = render(hero(), [product("a", "Whey Isolate")]);
    const section = doc.getElementById("products")!;
    expect(section.querySelector('a[href*="whey-isolate"]')).not.toBeNull();
    expect(section.querySelector("button")).not.toBeNull();
  });

  it("shows the optional heading", () => {
    const doc = render(hero(), [product("a", "Whey")], "Shop the offer");
    expect(doc.getElementById("products")?.textContent).toContain("Shop the offer");
  });

  it("renders no products section when nothing is selected", () => {
    expect(render(hero(), []).getElementById("products")).toBeNull();
  });
});
