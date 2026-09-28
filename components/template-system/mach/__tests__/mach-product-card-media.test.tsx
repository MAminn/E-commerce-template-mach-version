// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MachProductCard,
  type MachProduct,
  type MachProductCardProps,
} from "../MachProductCard";

/**
 * The product card's media stage is full-bleed.
 *
 * The photo used to sit inside a padded white stage with a hairline ring, so
 * every shot that is not itself pure white — the grey-ground wraps, lifestyle
 * photography — showed a white frame the UI had drawn around it. These tests
 * pin the stage to: no inset, no ring, and a fit that never crops packaging.
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
  images: [
    { url: "/uploads/knee.webp", isPrimary: true },
    { url: "/uploads/knee-2.webp", isPrimary: false },
  ],
} as unknown as MachProduct;

const VARIANTS: Array<Partial<MachProductCardProps>> = [
  {},
  { size: "lg" },
  { onDark: true },
  { onDark: true, size: "lg" },
  { variant: "shop" },
];

function stageOf(props: Partial<MachProductCardProps>) {
  const html = renderToStaticMarkup(
    <MachProductCard product={PRODUCT} {...props} />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  const stage = doc.querySelector("div.group > div")!;
  const imgs = [...stage.querySelectorAll("img")];
  return { html, stage, imgs };
}

describe("MachProductCard media stage", () => {
  for (const props of VARIANTS) {
    const label = JSON.stringify(props);

    it(`draws no inset or frame around the photo ${label}`, () => {
      const { stage, imgs } = stageOf(props);

      expect(stage.className).toContain("aspect-square");
      expect(stage.className).not.toMatch(/\bring-/);
      expect(stage.className).not.toMatch(/\bp-\[/);
      expect(imgs).toHaveLength(2);
      for (const img of imgs) {
        expect(img.className).toContain("inset-0");
        expect(img.className).toContain("h-full w-full");
        expect(img.className).not.toMatch(/(^|\s)(sm:)?p-/);
      }
    });

    it(`never crops or distorts the photo ${label}`, () => {
      const { imgs } = stageOf(props);
      for (const img of imgs) {
        expect(img.className).toContain("object-contain");
        expect(img.className).not.toMatch(/object-(cover|fill)/);
      }
    });
  }

  it("keeps the meta below the stage unchanged", () => {
    const { html } = stageOf({});
    expect(html).toContain("Gym Gear");
    expect(html).toContain("Knee Wrap");
    expect(html).toContain("350.00");
    expect(html).toContain("400.00");
    expect(html).toContain("-13%");
  });
});
