// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CartProvider, useCart } from "#root/lib/context/CartContext";
import { CartPageEditorialTemplate } from "#root/components/template-system/cartPage/CartPageEditorialTemplate";
import { CheckoutPageEditorialTemplate } from "#root/components/template-system/checkoutPage/CheckoutPageEditorialTemplate";
import CartPage from "../../cart/+Page";
import CheckoutPage from "../+Page";

/**
 * Cart and checkout are two entry points into ONE promo state.
 *
 * These run the real CartContext and the real cart and checkout pages with
 * the Editorial templates production uses; only the network is mocked (the
 * validate endpoint plays the server). "Navigating" swaps the page under the
 * same CartProvider, the way client-side routing does; "refreshing" unmounts
 * the provider and mounts a fresh one that restores from localStorage.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const STRAPS = "00000000-0000-4000-8000-000000000001";
const CREATINE = "00000000-0000-4000-8000-000000000003";
const PROMO_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROMO_ID = "22222222-2222-4222-8222-222222222222";

// Server truth for the mock: AGIZA20 covers the straps only; FLAT50 is a
// 50 EGP-off code for everything.
const validate = vi.fn(
  async (input: { code: string; cartItems: { id: string }[] }) => {
    const ids = input.cartItems.map((i) => i.id);
    if (input.code === "AGIZA20") {
      const eligible = ids.filter((id) => id === STRAPS);
      if (eligible.length === 0) {
        return {
          success: false,
          error: "This promo code doesn't apply to any of the items in your cart.",
        };
      }
      return {
        success: true,
        result: {
          id: PROMO_ID,
          code: "AGIZA20",
          discountType: "percentage" as const,
          discountValue: 20,
          appliesToAllProducts: false,
          eligibleProductIds: eligible,
          discountLabel: "20% off",
        },
      };
    }
    if (input.code === "FLAT50") {
      return {
        success: true,
        result: {
          id: OTHER_PROMO_ID,
          code: "FLAT50",
          discountType: "fixed_amount" as const,
          discountValue: 50,
          appliesToAllProducts: true,
          eligibleProductIds: ids,
          discountLabel: "50.00 EGP off",
        },
      };
    }
    return {
      success: false,
      error: `"${input.code}" isn't a valid promo code. Check the spelling and try again.`,
    };
  },
);

const orderCreate = vi.fn(async (_input: { promoCodeId?: string }) => ({
  success: true,
  result: { id: "order-1", total: "0" },
}));

vi.mock("#root/shared/trpc/client", () => ({
  trpc: {
    promoCode: { validate: { query: (i: never) => validate(i) } },
    settings: {
      getShippingFee: { query: async () => ({ success: true, result: 85 }) },
    },
    offer: { evaluate: { query: async () => ({ success: true, result: [] }) } },
    cartCapture: {
      sync: { mutate: async () => ({}) },
      markConverted: { mutate: async () => ({}) },
    },
    payment: {
      methods: {
        query: async () => ({
          methods: [{ id: "cod", label: "Cash on Delivery", description: "" }],
        }),
      },
      createSession: {
        mutate: async () => {
          throw new Error("payment must not be started in tests");
        },
      },
    },
    order: { create: { mutate: (i: never) => orderCreate(i) } },
  },
}));

vi.mock("#root/lib/cart-session", () => ({
  getCartSessionToken: () => "test-session",
}));
vi.mock("vike/client/router", () => ({ navigate: vi.fn() }));
vi.mock("#root/frontend/contexts/TrackingContext", () => ({
  useTracking: () => ({ trackEvent: () => {} }),
}));
// Production selection: cart-editorial + checkout-editorial.
vi.mock("#root/frontend/contexts/TemplateContext", () => ({
  useTemplate: () => ({
    getTemplateId: (category: string) =>
      category === "cartPage" ? "cart-editorial" : "checkout-editorial",
  }),
}));
vi.mock("#root/components/template-system/templateConfig", () => ({
  getTemplateComponent: (category: string) => ({
    component:
      category === "cartPage"
        ? CartPageEditorialTemplate
        : CheckoutPageEditorialTemplate,
  }),
}));
vi.mock("#root/components/template-system/editorial/EditorialChrome", () => ({
  EditorialChrome: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("#root/components/template-system/motion/Reveal", () => ({
  Reveal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("#root/components/template-system/motion/Stagger", () => ({
  StaggerContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  StaggerItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("#root/components/checkout/BostaShippingFields", () => ({
  BostaShippingFields: ({ fallback }: { fallback: ReactNode }) => <>{fallback}</>,
}));
vi.mock("#root/components/checkout/CityCombobox", () => ({
  CityCombobox: () => <input aria-label="Governorate" />,
}));

const product = (id: string, name: string, price: number) => ({
  id,
  name,
  price,
  stock: 20,
});
const straps = product(STRAPS, "Mach – Figure 8 Straps", 399);
const creatine = product(CREATINE, "Mach Creatine", 600);

let cart!: ReturnType<typeof useCart>;
function Probe() {
  cart = useCart();
  return null;
}

type Page = "cart" | "checkout";
let container: HTMLDivElement;
let root: Root;

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

/** Mount (or re-mount after a "refresh") a provider showing `page`. */
async function mount(page: Page) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(app(page)));
  await settle();
}
const app = (page: Page) => (
  <CartProvider>
    <Probe />
    {page === "cart" ? <CartPage /> : <CheckoutPage />}
  </CartProvider>
);
/** Client-side navigation: same provider, different page. */
async function goTo(page: Page) {
  await act(async () => root.render(app(page)));
  await settle();
}
function unmount() {
  act(() => root.unmount());
  container.remove();
}
async function refresh(page: Page) {
  unmount();
  await mount(page);
}

beforeEach(() => {
  localStorage.clear();
  validate.mockClear();
  orderCreate.mockClear();
});
afterEach(() => unmount());

// ── DOM helpers (the Editorial cart has one promo box; checkout scoped to desktop) ──
const scope = (page: Page) =>
  page === "cart"
    ? container
    : container.querySelector<HTMLElement>('[data-testid="desktop-promo-code"]')!;
const promoInput = (page: Page) =>
  scope(page).querySelector<HTMLInputElement>('input[aria-label="Promo code"]');
const appliedBox = (page: Page) =>
  scope(page).querySelector('[data-testid="applied-promo-code"]');
const text = () => container.textContent ?? "";

function type(page: Page, value: string) {
  const el = promoInput(page)!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function apply(page: Page, code: string) {
  type(page, code);
  const btn = [...scope(page).querySelectorAll("button")].find(
    (b) => b.textContent === "Apply",
  )!;
  await act(async () => btn.click());
  await settle();
}
async function remove(page: Page) {
  const btn = [...scope(page).querySelectorAll("button")].find(
    (b) => b.textContent === "Remove",
  )!;
  await act(async () => btn.click());
  await settle();
}
async function add(p: ReturnType<typeof product>, qty = 1) {
  act(() => {
    cart.addItem(p, qty, {});
  });
  await settle();
}
const savedPromo = () => JSON.parse(localStorage.getItem("promoCode") ?? "null");

describe("cart → checkout", () => {
  it("a code applied in the cart is already applied in checkout, discount included", async () => {
    await mount("cart");
    await add(straps);
    await apply("cart", "AGIZA20");
    expect(appliedBox("cart")?.textContent).toContain("AGIZA20");

    validate.mockClear();
    await goTo("checkout");

    expect(appliedBox("checkout")!.textContent).toContain("AGIZA20");
    expect(appliedBox("checkout")!.textContent).toContain("20% off");
    expect(promoInput("checkout")).toBeNull(); // nothing to re-enter
    expect(text()).toContain("Discount (AGIZA20)");
    expect(text()).toContain("−EGP 79.80");
    expect(text()).toContain("EGP 404.20"); // 399 − 79.80 + 85
    // Entering checkout doesn't apply the code again.
    expect(validate).not.toHaveBeenCalled();
  });
});

describe("checkout → cart", () => {
  it("a code applied in checkout is the code the cart shows", async () => {
    await mount("checkout");
    await add(straps);
    expect(appliedBox("checkout")).toBeNull();

    await apply("checkout", "AGIZA20");
    expect(appliedBox("checkout")!.textContent).toContain("AGIZA20");
    expect(cart.promoCode?.id).toBe(PROMO_ID);
    expect(savedPromo()?.code).toBe("AGIZA20");

    await goTo("cart");
    expect(appliedBox("cart")!.textContent).toContain("AGIZA20");
    expect(text()).toContain("Discount (AGIZA20)");
    expect(text()).toContain("EGP 404.20");
  });

  it("a code removed in checkout is gone from the cart and from storage", async () => {
    await mount("cart");
    await add(straps);
    await apply("cart", "AGIZA20");
    await goTo("checkout");

    await remove("checkout");
    expect(appliedBox("checkout")).toBeNull();
    expect(promoInput("checkout")!.value).toBe("");
    expect(cart.promoCode).toBeNull();
    expect(cart.discount).toBe(0);
    expect(savedPromo()).toBeNull();

    await goTo("cart");
    expect(appliedBox("cart")).toBeNull();
    expect(text()).not.toContain("Discount");
    expect(text()).toContain("EGP 484.00");
  });
});

describe("invalid / ineligible codes in checkout", () => {
  it("an invalid code shows the server's message and changes nothing", async () => {
    await mount("checkout");
    await add(straps);
    await apply("checkout", "THISCODEDOESNOTEXIST999");

    expect(
      container.querySelector("#desktop-promo-code-feedback")!.textContent,
    ).toBe(
      '"THISCODEDOESNOTEXIST999" isn\'t a valid promo code. Check the spelling and try again.',
    );
    expect(promoInput("checkout")!.value).toBe("THISCODEDOESNOTEXIST999");
    expect(cart.promoCode).toBeNull();
    expect(cart.discount).toBe(0);
  });

  it("an ineligible code shows the eligibility reason", async () => {
    await mount("checkout");
    await add(creatine);
    await apply("checkout", "AGIZA20");

    expect(
      container.querySelector("#desktop-promo-code-feedback")!.textContent,
    ).toBe("This promo code doesn't apply to any of the items in your cart.");
    expect(cart.promoCode).toBeNull();
  });
});

describe("refresh persistence", () => {
  it("a code applied in checkout survives a checkout refresh (re-validated)", async () => {
    await mount("checkout");
    await add(straps);
    await apply("checkout", "AGIZA20");

    validate.mockClear();
    await refresh("checkout");

    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({ code: "AGIZA20" }),
    );
    expect(appliedBox("checkout")!.textContent).toContain("AGIZA20");
    expect(text()).toContain("EGP 404.20");
    expect(cart.discount).toBeCloseTo(79.8);
  });

  it("a code removed in checkout stays removed after a refresh", async () => {
    await mount("checkout");
    await add(straps);
    await apply("checkout", "AGIZA20");
    await remove("checkout");
    await refresh("cart");

    expect(appliedBox("cart")).toBeNull();
    expect(cart.promoCode).toBeNull();
  });
});

describe("one code, one discount", () => {
  it("back-and-forth navigation never stacks the discount", async () => {
    await mount("cart");
    await add(straps);
    await apply("cart", "AGIZA20");

    for (const page of ["checkout", "cart", "checkout", "cart", "checkout"] as const) {
      await goTo(page);
      expect(cart.discount).toBeCloseTo(79.8);
      expect(cart.total).toBeCloseTo(404.2);
    }
    // Exactly one promo discount line (the collapsed mobile summary renders none).
    expect(text().match(/Discount \(/g)).toHaveLength(1);
  });

  it("re-applying the same code from the cart is refused, not doubled", async () => {
    await mount("checkout");
    await add(straps);
    await apply("checkout", "AGIZA20");
    await goTo("cart");

    await apply("cart", "AGIZA20");
    expect(text()).toContain('"AGIZA20" is already applied to your order.');
    expect(cart.discount).toBeCloseTo(79.8);
  });

  it("a different code replaces the applied one — never both", async () => {
    await mount("cart");
    await add(straps);
    await apply("cart", "AGIZA20");
    await apply("cart", "FLAT50");
    await goTo("checkout");

    expect(appliedBox("checkout")!.textContent).toContain("FLAT50");
    expect(appliedBox("checkout")!.textContent).not.toContain("AGIZA20");
    expect(cart.discount).toBe(50);
    expect(cart.total).toBeCloseTo(399 - 50 + 85);
  });
});

describe("pricing stays CartContext's", () => {
  it("a restricted code discounts only the eligible line in a mixed cart, in checkout too", async () => {
    await mount("cart");
    await add(straps);
    await add(creatine);
    await goTo("checkout");
    await apply("checkout", "AGIZA20");

    expect(cart.subtotal).toBe(999);
    expect(cart.discount).toBeCloseTo(79.8); // 20% of 399, not of 999
    expect(text()).toContain("−EGP 79.80");
    expect(text()).toContain("EGP 1004.20"); // 999 − 79.80 + 85
  });

  it("a quantity change with a code applied re-prices checkout", async () => {
    await mount("cart");
    await add(straps);
    await add(creatine);
    await apply("cart", "AGIZA20");

    act(() => {
      cart.updateQuantity(STRAPS, 2, {});
    });
    await settle();
    await goTo("checkout");

    expect(cart.discount).toBeCloseTo(159.6);
    expect(text()).toContain("−EGP 159.60");
    expect(appliedBox("checkout")!.textContent).toContain("You save EGP 159.60");
  });

  it("the order carries the same promoCodeId the cart applied", async () => {
    await mount("cart");
    await add(straps);
    await apply("cart", "AGIZA20");
    await goTo("checkout");

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect(orderCreate.mock.calls[0]![0].promoCodeId).toBe(PROMO_ID);
  });

  it("an order placed after removing the code in checkout carries none", async () => {
    await mount("cart");
    await add(straps);
    await apply("cart", "AGIZA20");
    await goTo("checkout");
    await remove("checkout");

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(orderCreate.mock.calls[0]![0].promoCodeId).toBeUndefined();
  });

  it("pressing Enter in the checkout promo field doesn't place the order", async () => {
    await mount("checkout");
    await add(straps);
    type("checkout", "AGIZA20");
    await act(async () => {
      promoInput("checkout")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    await settle();

    expect(cart.promoCode?.code).toBe("AGIZA20");
    expect(orderCreate).not.toHaveBeenCalled();
  });
});

describe("the cart's own promo box still works", () => {
  it("applies and removes from the cart as before", async () => {
    await mount("cart");
    await add(straps);
    await apply("cart", "AGIZA20");
    expect(appliedBox("cart")!.textContent).toContain("AGIZA20 — 20% off");
    expect(text()).toContain('"AGIZA20" applied — 20% off.');

    await remove("cart");
    expect(appliedBox("cart")).toBeNull();
    expect(cart.promoCode).toBeNull();
  });
});
