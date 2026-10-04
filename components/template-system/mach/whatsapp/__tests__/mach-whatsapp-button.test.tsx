// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  toPublicWhatsAppButton,
  type PublicWhatsAppButton,
  type WhatsAppSettings,
} from "#root/shared/whatsapp/config";

/**
 * The floating WhatsApp button: renders nothing while off, a safe external
 * link while on, honours visibility and stays clear of the surfaces it must
 * not sit on.
 */

const page = { urlPathname: "/" };
const consent = { showBanner: false };
let publicButton: PublicWhatsAppButton | null = null;
const getPublicButton = vi.fn(async () => ({ success: true as const, result: publicButton }));

vi.mock("vike-react/usePageContext", () => ({ usePageContext: () => page }));
vi.mock("#root/frontend/contexts/ConsentContext", () => ({ useConsent: () => consent }));
vi.mock("#root/shared/trpc/client", () => ({
  trpc: { whatsapp: { getPublicButton: { query: () => getPublicButton() } } },
}));

const { MachWhatsAppButton, MachWhatsAppButtonView, isOverControl } = await import("../MachWhatsAppButton");
const { isWhatsAppExcludedRoute } = await import("../whatsappRoutes");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

const settings = (p: Partial<WhatsAppSettings> = {}): WhatsAppSettings => ({
  enabled: true,
  phoneNumber: "+20 10 1234 5678",
  message: "",
  visibility: "both",
  ...p,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  page.urlPathname = "/";
  consent.showBanner = false;
  publicButton = null;
  getPublicButton.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<MachWhatsAppButton />);
  });
}

const link = () => container.querySelector<HTMLAnchorElement>("[data-testid=whatsapp-floating-button]");

describe("MachWhatsAppButton — off", () => {
  it("default settings (off) render nothing at all", async () => {
    publicButton = toPublicWhatsAppButton(settings({ enabled: false }));
    await render();
    expect(getPublicButton).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toBe("");
  });

  it("on but with no valid number renders nothing", async () => {
    publicButton = toPublicWhatsAppButton(settings({ phoneNumber: "010" }));
    await render();
    expect(container.innerHTML).toBe("");
  });

  it("a failed fetch renders nothing and does not throw", async () => {
    getPublicButton.mockRejectedValueOnce(new Error("network"));
    await render();
    expect(container.innerHTML).toBe("");
  });
});

describe("MachWhatsAppButton — on", () => {
  it("renders a safe, labelled external link to the normalised wa.me URL", async () => {
    publicButton = toPublicWhatsAppButton(settings());
    await render();
    const a = link()!;
    expect(a).not.toBeNull();
    expect(a.getAttribute("href")).toBe("https://wa.me/201012345678");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("aria-label")).toBe("Chat with us on WhatsApp");
    // Icon only — no visible text, and the glyph is hidden from AT.
    expect(a.textContent).toBe("");
    expect(a.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("carries the encoded prefilled message", async () => {
    publicButton = toPublicWhatsAppButton(settings({ message: "Hi MACH & team?" }));
    await render();
    expect(link()!.getAttribute("href")).toBe("https://wa.me/201012345678?text=Hi%20MACH%20%26%20team%3F");
  });

  it("is fixed bottom-right with an accessible tap size and does not take layout space", async () => {
    publicButton = toPublicWhatsAppButton(settings());
    await render();
    const cls = link()!.className;
    expect(cls).toContain("fixed");
    expect(cls).toMatch(/\bright-\[calc\(env\(safe-area-inset-right,0px\)_\+_16px\)\]/);
    expect(cls).toMatch(/\bbottom-\[calc\(env\(safe-area-inset-bottom,0px\)_\+_16px\)\]/);
    expect(cls).toContain("lg:bottom-[calc(env(safe-area-inset-bottom,0px)_+_24px)]");
    expect(cls).toContain("h-[52px] w-[52px]");
    expect(cls).toContain("rounded-full");
    // WhatsApp's own treatment: white glyph on WhatsApp green.
    expect(cls).toContain("bg-[#25D366]");
    expect(cls).toContain("text-white");
    expect(cls).not.toMatch(/\bleft-/);
    // Under the sticky purchase bar / consent banner (z-50) and every modal.
    expect(cls).toContain("z-40");
  });

  it.each([
    ["both", ["flex"], ["hidden", "lg:hidden", "lg:flex"]],
    ["mobile", ["flex", "lg:hidden"], ["hidden", "lg:flex"]],
    ["desktop", ["hidden", "lg:flex"], ["lg:hidden"]],
  ] as const)("visibility %s", async (visibility, present, absent) => {
    publicButton = toPublicWhatsAppButton(settings({ visibility }));
    await render();
    const classes = link()!.className.split(/\s+/);
    for (const c of present) expect(classes).toContain(c);
    for (const c of absent) expect(classes).not.toContain(c);
  });
});

describe("MachWhatsAppButton — placement against other controls", () => {
  it("on the product page it is lifted clear of the mobile sticky Add to Bag bar", async () => {
    page.urlPathname = "/shop/mach-whey";
    publicButton = toPublicWhatsAppButton(settings());
    await render();
    const cls = link()!.className;
    expect(cls).toContain("bottom-[calc(env(safe-area-inset-bottom,0px)_+_88px)]");
    expect(cls).not.toContain(" bottom-[calc(env(safe-area-inset-bottom,0px)_+_16px)]");
    // The bar only exists below lg; desktop keeps the normal offset.
    expect(cls).toContain("lg:bottom-[calc(env(safe-area-inset-bottom,0px)_+_24px)]");
  });

  it("the 88px lift clears the sticky bar's height (p-3 around a 48px control)", () => {
    const pdp = read("components/template-system/productPage/ProductPageEditorial.tsx");
    expect(pdp).toMatch(/fixed inset-x-0 bottom-0 z-50[^"]*p-3[^"]*lg:hidden/);
    expect(pdp).toMatch(/className='h-12 rounded-none/);
    expect(12 + 48 + 12 + 1).toBeLessThan(88);
  });

  it("stays hidden while the first-visit consent banner is showing", async () => {
    consent.showBanner = true;
    publicButton = toPublicWhatsAppButton(settings());
    await render();
    expect(link()).toBeNull();
  });

  it.each(["/dashboard", "/dashboard/settings", "/checkout", "/links", "/template-preview"])(
    "renders nothing on %s and does not even fetch",
    async (pathname) => {
      page.urlPathname = pathname;
      publicButton = toPublicWhatsAppButton(settings());
      await render();
      expect(link()).toBeNull();
      expect(getPublicButton).not.toHaveBeenCalled();
    },
  );

  it.each(["/", "/shop", "/shop/mach-whey", "/categories/protein", "/cart", "/about-us", "/contact", "/return-policy", "/account", "/orders", "/order-confirmation/abc"])(
    "renders on storefront route %s",
    async (pathname) => {
      page.urlPathname = pathname;
      publicButton = toPublicWhatsAppButton(settings());
      await render();
      expect(link()).not.toBeNull();
    },
  );
});

describe("never sits on a control", () => {
  const rect = { left: 307, top: 692, right: 359, bottom: 744, width: 52 };
  const viewport = { width: 375, height: 760 };
  const self = document.createElement("a");
  const glyph = document.createElement("span");
  self.appendChild(glyph);

  /** A stub hit-tester: everything at the given points, topmost first. */
  const at = (hits: (x: number, y: number) => Element[]) => ({ elementsFromPoint: hits });
  const el = (html: string) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    return wrap.firstElementChild!;
  };

  it("detects a button (e.g. Proceed to Checkout) under its footprint", () => {
    const checkout = el("<button><span>Proceed to checkout</span></button>");
    const doc = at((x, y) => (x < 335 && y > 680 && y < 710 ? [self, checkout.firstElementChild!, checkout] : [self, document.body]));
    expect(isOverControl(rect, self, viewport, doc)).toBe(true);
  });

  it.each(["<input>", "<select></select>", "<textarea></textarea>", "<div role='button'></div>"])("detects %s", (html) => {
    const control = el(html);
    expect(isOverControl(rect, self, viewport, at(() => [self, control]))).toBe(true);
  });

  it("ignores plain links and page content, so catalogue grids don't hide it", () => {
    const card = el("<a href='/shop/x'><img></a>");
    expect(isOverControl(rect, self, viewport, at(() => [self, card.firstElementChild!, card]))).toBe(false);
    expect(isOverControl(rect, self, viewport, at(() => [self, document.body]))).toBe(false);
  });

  it("skips itself and its own glyph", () => {
    expect(isOverControl(rect, self, viewport, at(() => [glyph, self, document.body]))).toBe(false);
  });

  it("is never 'covering' while display:none at this breakpoint", () => {
    const control = el("<button></button>");
    expect(isOverControl({ ...rect, width: 0 }, self, viewport, at(() => [control]))).toBe(false);
  });

  it("while covering, the link fades out and goes inert (no taps, no focus, not announced)", async () => {
    await act(async () => {
      root.render(<MachWhatsAppButtonView href='https://wa.me/201012345678' visibility='both' hidden />);
    });
    const a = link()!;
    expect(a.className).toContain("opacity-0");
    expect(a.hasAttribute("inert")).toBe(true);
    expect(a.dataset.coveringControl).toBe("true");
  });

  it("normally it is fully visible and focusable", async () => {
    await act(async () => {
      root.render(<MachWhatsAppButtonView href='https://wa.me/201012345678' visibility='both' />);
    });
    const a = link()!;
    expect(a.className).toContain("opacity-100");
    expect(a.hasAttribute("inert")).toBe(false);
    expect(a.hasAttribute("aria-hidden")).toBe(false);
    expect(a.hasAttribute("tabindex")).toBe(false);
  });
});

describe("isWhatsAppExcludedRoute", () => {
  it("matches whole segments only", () => {
    expect(isWhatsAppExcludedRoute("/checkout")).toBe(true);
    expect(isWhatsAppExcludedRoute("/checkout/")).toBe(true);
    expect(isWhatsAppExcludedRoute("/dashboard/admin/popup")).toBe(true);
    expect(isWhatsAppExcludedRoute("/shop/checkout-shaker")).toBe(false);
    expect(isWhatsAppExcludedRoute("/linksys")).toBe(false);
  });
});

describe("layout wiring — structural", () => {
  const layout = read("layouts/LayoutDefault.tsx");

  it("is mounted once, only on non-dashboard Mach storefront chrome", () => {
    const mounts = layout.match(/<MachWhatsAppButton \/>/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(layout).toContain("{!isDashboardRoute && isMachStorefront && <MachWhatsAppButton />}");
  });

  it("is inside ConsentProvider (it reads the banner state)", () => {
    expect(layout.indexOf("<ConsentProvider>")).toBeLessThan(layout.indexOf("<MachWhatsAppButton />"));
    expect(layout.indexOf("</ConsentProvider>")).toBeGreaterThan(layout.indexOf("<MachWhatsAppButton />"));
  });

  it("the dashboard layout does not mount it", () => {
    expect(read("pages/dashboard/+Layout.tsx")).not.toContain("WhatsApp");
  });
});
