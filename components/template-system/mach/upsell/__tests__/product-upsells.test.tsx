// @vitest-environment happy-dom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CartProvider, useCart } from "#root/lib/context/CartContext";
import type { FeaturedProduct } from "../../../home/HomeFeaturedProducts";
import type { ProductPageProduct } from "../../../productPage/ProductPageModernSplit";
import { ProductPageEditorial } from "../../../productPage/ProductPageEditorial";
import type { ProductUpsells } from "../types";
import { productPageUpsellProps, type UpsellResponse } from "../productPageUpsellProps";

/**
 * Upsells on the Mach product page (`product-editorial`, the template
 * production runs), end to end through the real CartProvider: the block under
 * the purchase controls, the post-add sheet, and the rules that keep them from
 * repeating themselves or guessing a variant. Network calls the cart makes are
 * stubbed; the cart logic itself is the real one.
 */

const toast = vi.fn();
vi.mock("../../MachCartFeedback", () => ({
  showMachCartToast: (...args: unknown[]) => toast(...args),
}));
vi.mock("../../MachChrome", () => ({
  MachChrome: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../../motion/Reveal", () => ({
  Reveal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../motion/Stagger", () => ({
  StaggerContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StaggerItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const trackEvent = vi.fn();
vi.mock("#root/frontend/contexts/TrackingContext", () => ({
  useTracking: () => ({ trackEvent }),
}));
vi.mock("#root/shared/trpc/client", () => ({
  trpc: {
    settings: { getShippingFee: { query: async () => ({ success: true, result: 0 }) } },
    offer: { evaluate: { query: async () => ({ success: true, result: [] }) } },
    promoCode: { validate: { query: async () => ({ success: false }) } },
    cartCapture: { sync: { mutate: async () => ({ success: true }) } },
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MAIN: ProductPageProduct = {
  id: "whey",
  name: "Mach Whey Blend",
  price: 1500,
  discountPrice: null,
  stock: 10,
  available: true,
  description: "Protein.",
  images: [{ url: "/uploads/whey.webp", isPrimary: true }],
  imageUrl: "/uploads/whey.webp",
  categoryName: "Supplements",
  variants: [],
  rating: 0,
  reviewCount: 0,
} as unknown as ProductPageProduct;

function up(id: string, over: Partial<FeaturedProduct> = {}): FeaturedProduct {
  return {
    id,
    slug: id,
    name: id.toUpperCase(),
    price: 400,
    discountPrice: 350,
    stock: 5,
    available: true,
    imageUrl: `/uploads/${id}.webp`,
    categoryName: "Gym Gear",
    variantCount: 0,
    ...over,
  };
}

function upsellsOf(items: FeaturedProduct[], over: Partial<ProductUpsells> = {}): ProductUpsells {
  return { items, limit: 2, productPage: true, postAdd: true, source: "random", ...over };
}

let setUpsellsExternal: (u: ProductUpsells | undefined) => void = () => {};

/** Stands in for the product route: real cart, same `onAddToCart` contract. */
function Page({
  initialUpsells,
  crossSellProducts,
  refuseMainAdd = false,
}: {
  initialUpsells?: ProductUpsells;
  crossSellProducts?: FeaturedProduct[];
  refuseMainAdd?: boolean;
}) {
  const { addItem, items } = useCart();
  const [upsells, setUpsells] = useState(initialUpsells);
  setUpsellsExternal = setUpsells;
  return (
    <>
      <output data-testid='cart'>{JSON.stringify(items)}</output>
      <ProductPageEditorial
        product={MAIN}
        upsells={upsells}
        crossSellProducts={crossSellProducts}
        onAddToCart={(p, opts, qty) =>
          refuseMainAdd
            ? false
            : addItem(
                { id: p.id, name: p.name, price: p.price, stock: p.stock, available: true },
                qty ?? 1,
                opts ?? {},
              )
        }
      />
    </>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  toast.mockClear();
  trackEvent.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

async function render(ui: ReactNode) {
  await act(async () => {
    root.render(<CartProvider>{ui}</CartProvider>);
  });
}

const cart = (): Array<{ id: string; quantity: number; price: number; originalPrice?: number; selectedOptions: Record<string, string> }> =>
  JSON.parse(document.querySelector("[data-testid=cart]")!.textContent || "[]");
const block = () => document.querySelector("[data-testid=product-upsell-block]");
const blockIds = () =>
  [...(block()?.querySelectorAll("[data-upsell-item]") ?? [])].map((el) => el.getAttribute("data-upsell-item"));
const sheet = () => document.querySelector("[data-testid=post-add-upsell]");
const sheetIds = () =>
  [...(sheet()?.querySelectorAll("[data-upsell-item]") ?? [])].map((el) => el.getAttribute("data-upsell-item"));
const button = (scope: ParentNode | null, label: RegExp) =>
  [...(scope?.querySelectorAll("button") ?? [])].find((b) => label.test(b.textContent ?? "")) as HTMLButtonElement | undefined;
const addToBag = () => button(document, /^Add to Bag$/)!;

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

describe("product-page upsell block", () => {
  it("renders the configured number of recommendations, compactly", async () => {
    await render(<Page initialUpsells={upsellsOf([up("straps"), up("rice"), up("carb")])} />);
    expect(blockIds()).toEqual(["straps", "rice"]);
    expect(block()!.textContent).toContain("EGP 350.00");
    expect(block()!.textContent).toContain("EGP 400.00");
    // Tap targets are at least 44px on every width.
    expect(button(block(), /Add/)!.className).toContain("min-h-[44px]");
  });

  it("is absent when the product page placement is off, or there is nothing to show", async () => {
    await render(<Page initialUpsells={upsellsOf([up("straps")], { productPage: false })} />);
    expect(block()).toBeNull();
    await act(async () => setUpsellsExternal(upsellsOf([])));
    expect(block()).toBeNull();
    await act(async () => setUpsellsExternal(undefined));
    expect(block()).toBeNull();
  });

  it("uses the manual heading for a curated list and a neutral one for random", async () => {
    await render(<Page initialUpsells={upsellsOf([up("straps")], { source: "manual" })} />);
    expect(block()!.textContent).toContain("Frequently Bought Together");
    await act(async () => setUpsellsExternal(upsellsOf([up("straps")])));
    expect(block()!.textContent).toContain("Add to Your Order");
  });

  it("adds through the real cart at the charged price, then shows Added", async () => {
    await render(<Page initialUpsells={upsellsOf([up("straps"), up("rice")])} />);
    await click(button(block(), /Add/)!);
    expect(cart()).toEqual([
      expect.objectContaining({ id: "straps", quantity: 1, price: 350, originalPrice: 400, selectedOptions: {} }),
    ]);
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(block()!.querySelector("[data-upsell-item=straps]")!.textContent).toContain("Added");
    // The block does not reshuffle under the shopper's thumb.
    expect(blockIds()).toEqual(["straps", "rice"]);
  });

  it("ignores rapid repeat presses — one unit, not two", async () => {
    await render(<Page initialUpsells={upsellsOf([up("straps")])} />);
    const add = button(block(), /Add/)!;
    await act(async () => {
      add.click();
      add.click();
      add.click();
    });
    expect(cart()).toHaveLength(1);
    expect(cart()[0]!.quantity).toBe(1);
  });

  it("never guesses a variant: products with options link to their page", async () => {
    await render(<Page initialUpsells={upsellsOf([up("shaker", { variantCount: 2 }), up("rice", { variantCount: undefined })])} />);
    const shaker = block()!.querySelector("[data-upsell-item=shaker]")!;
    expect(button(shaker, /Add/)).toBeUndefined();
    const link = shaker.querySelector('a[aria-label^="Choose options"]') as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/shop/shaker");
    // Unknown option state is treated the same way.
    expect(button(block()!.querySelector("[data-upsell-item=rice]"), /Add/)).toBeUndefined();
    expect(cart()).toEqual([]);
  });

  it("leaves out products already in the bag when it is chosen", async () => {
    localStorage.setItem(
      "cart",
      JSON.stringify([{ id: "straps", name: "STRAPS", price: 350, stock: 5, quantity: 1, selectedOptions: {} }]),
    );
    await render(<Page />);
    await act(async () => setUpsellsExternal(upsellsOf([up("straps"), up("rice"), up("carb")])));
    expect(blockIds()).toEqual(["rice", "carb"]);
  });
});

describe("post-add upsell sheet", () => {
  it("opens only after the main product was accepted by the cart", async () => {
    await render(<Page initialUpsells={upsellsOf([up("straps"), up("rice")])} />);
    expect(sheet()).toBeNull();
    await click(addToBag());
    expect(cart().map((l) => l.id)).toEqual(["whey"]);
    expect(sheet()).not.toBeNull();
    expect(sheet()!.textContent).toContain("Added to your bag");
    expect(sheet()!.textContent).toContain("Mach Whey Blend");
    expect(sheetIds()).toEqual(["straps", "rice"]);
    // The sheet is the confirmation; no second toast on top of it.
    expect(toast).not.toHaveBeenCalled();
  });

  it("does not open when the cart refuses the main product", async () => {
    await render(<Page refuseMainAdd initialUpsells={upsellsOf([up("straps")])} />);
    await click(addToBag());
    expect(sheet()).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("does not repeat an upsell already added from the product page — the next one replaces it", async () => {
    await render(<Page initialUpsells={upsellsOf([up("straps"), up("rice"), up("carb")])} />);
    await click(button(block()!.querySelector("[data-upsell-item=straps]"), /Add/)!);
    await click(addToBag());
    expect(sheetIds()).toEqual(["rice", "carb"]);
  });

  it("never opens empty: with nothing left to offer, the add is confirmed by the toast", async () => {
    await render(<Page initialUpsells={upsellsOf([up("straps")])} />);
    await click(button(block(), /Add/)!);
    toast.mockClear();
    await click(addToBag());
    expect(sheet()).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("stays closed when the post-add placement is off", async () => {
    await render(<Page initialUpsells={upsellsOf([up("straps")], { postAdd: false })} />);
    await click(addToBag());
    expect(sheet()).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("adds from the sheet without a toast and without reopening on cart changes", async () => {
    await render(<Page initialUpsells={upsellsOf([up("straps"), up("rice"), up("carb")])} />);
    await click(addToBag());
    toast.mockClear();
    await click(button(sheet(), /^Add$/)!);
    expect(cart().map((l) => l.id)).toEqual(["whey", "straps"]);
    expect(toast).not.toHaveBeenCalled();
    expect(sheet()!.querySelector("[data-upsell-item=straps]")!.textContent).toContain("Added");

    // Close, then change the cart from the block: the sheet must not come back.
    await click(button(sheet(), /Continue shopping/)!);
    expect(sheet()).toBeNull();
    await click(button(block()!.querySelector("[data-upsell-item=rice]"), /Add/)!);
    expect(cart().map((l) => l.id)).toEqual(["whey", "straps", "rice"]);
    expect(sheet()).toBeNull();
  });

  it("links to the bag and checkout", async () => {
    await render(<Page initialUpsells={upsellsOf([up("straps")])} />);
    await click(addToBag());
    const hrefs = [...sheet()!.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/cart");
    expect(hrefs).toContain("/checkout");
  });

  it("is a bottom sheet on phones and a centred modal from sm up, in the Mach dark theme", async () => {
    await render(<Page initialUpsells={upsellsOf([up("straps")])} />);
    await click(addToBag());
    const cls = sheet()!.className;
    // Phone: pinned to the bottom edge, full width, height-capped and scrollable.
    expect(cls).toMatch(/(^|\s)inset-x-0(\s|$)/);
    expect(cls).toMatch(/(^|\s)bottom-0(\s|$)/);
    expect(cls).toContain("max-h-[88dvh]");
    expect(cls).toContain("max-sm:data-[state=open]:slide-in-from-bottom");
    // sm+: centred, bounded width.
    expect(cls).toContain("sm:top-1/2");
    expect(cls).toContain("sm:left-1/2");
    expect(cls).toContain("sm:max-w-[460px]");
    // Portalled outside <main>, so it must carry the theme scope itself, and
    // sit above the fixed navbar (z-10000).
    expect(cls).toContain("mach-theme-dark");
    expect(cls).toContain("z-[10002]");
  });

  it("keeps the main add-to-cart behaviour: quantity and selected options reach the cart line", async () => {
    await render(<Page initialUpsells={upsellsOf([up("straps")])} />);
    await click(button(document, /Increase quantity/) ?? document.querySelector('[aria-label="Increase quantity"]')!);
    await click(addToBag());
    expect(cart()).toEqual([expect.objectContaining({ id: "whey", quantity: 2, price: 1500, selectedOptions: {} })]);
    expect(sheet()!.textContent).toContain("2 ×");
  });
});

/**
 * The page as the route builds it from the resolver's answer — so these pin
 * the shipped default (off) and the switch-on path end to end.
 */
describe("upsells off by default, on once enabled", () => {
  const CURATED = [up("straps"), up("rice")];

  function response(over: Partial<UpsellResponse>): UpsellResponse {
    return { enabled: true, productPage: true, postAdd: true, limit: 3, source: "random", items: [], ...over };
  }

  async function renderFrom(res: UpsellResponse | null) {
    const { upsells, crossSellProducts } = productPageUpsellProps(res, CURATED);
    await render(<Page initialUpsells={upsells} crossSellProducts={crossSellProducts} />);
  }

  /** The legacy add-ons strip: a section other than the upsell block linking the curated products. */
  const legacyStripLinks = () =>
    [...document.querySelectorAll("section:not([data-testid=product-upsell-block]) a[href^='/shop/']")].map((a) =>
      a.getAttribute("href"),
    );

  // Exactly what the server answers for a store with no saved upsell_config.
  const OFF = response({ enabled: false, productPage: false, postAdd: false, source: "none" });

  it("OFF (no saved config): no block, no popup, and the legacy add-ons strip as before", async () => {
    await renderFrom(OFF);
    expect(block()).toBeNull();
    expect(legacyStripLinks()).toEqual(["/shop/straps", "/shop/rice"]);
    await click(addToBag());
    expect(cart().map((l) => l.id)).toEqual(["whey"]);
    expect(sheet()).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("OFF even if a response carried items: nothing is shown", async () => {
    await renderFrom({ ...OFF, items: [up("carb")], productPage: true, postAdd: true });
    expect(block()).toBeNull();
    await click(addToBag());
    expect(sheet()).toBeNull();
  });

  it("an unreachable resolver behaves like OFF", async () => {
    await renderFrom(null);
    expect(block()).toBeNull();
    expect(legacyStripLinks()).toEqual(["/shop/straps", "/shop/rice"]);
    await click(addToBag());
    expect(sheet()).toBeNull();
  });

  it("ON, global random: block and popup, legacy strip hidden", async () => {
    await renderFrom(response({ items: [up("carb"), up("knee")] }));
    expect(blockIds()).toEqual(["carb", "knee"]);
    expect(legacyStripLinks()).toEqual([]);
    await click(addToBag());
    expect(sheetIds()).toEqual(["carb", "knee"]);
  });

  it("ON, manual: the curated list in order, drawn once", async () => {
    await renderFrom(response({ source: "manual", items: CURATED }));
    expect(blockIds()).toEqual(["straps", "rice"]);
    expect(block()!.textContent).toContain("Frequently Bought Together");
    expect(legacyStripLinks()).toEqual([]);
    await click(addToBag());
    expect(sheetIds()).toEqual(["straps", "rice"]);
  });

  it("ON, product disabled: no block, no popup, no strip", async () => {
    await renderFrom(response({ source: "none", items: [] }));
    expect(block()).toBeNull();
    expect(legacyStripLinks()).toEqual([]);
    await click(addToBag());
    expect(sheet()).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
