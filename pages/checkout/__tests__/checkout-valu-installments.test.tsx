// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CartProvider, useCart } from "#root/lib/context/CartContext";
import { CheckoutPageEditorialTemplate } from "#root/components/template-system/checkoutPage/CheckoutPageEditorialTemplate";
import { CheckoutPageModernTemplate } from "#root/components/template-system/checkoutPage/CheckoutPageModernTemplate";
import CheckoutPage from "../+Page";

/**
 * valU installments at checkout. valU is a display-only choice: selecting it
 * shows a live 3-month estimate from the displayed total and creates nothing;
 * placing the order runs the existing Fawaterak payment-attempt flow, where
 * the customer picks valU on Fawaterak's hosted page. COD and Online Payment
 * behave exactly as before.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STRAPS = "00000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "019a0000-aaaa-7bbb-8ccc-000000000001";
const PRICE = 1304; // + 85 shipping = EGP 1,389 → EGP 463.00 / month

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type ShippingResult = { success: true; result: number };
type OffersResult = { success: true; result: unknown[] };
type PromoResult =
  | { success: true; result: Record<string, unknown> }
  | { success: false; error: string };

const shippingFee = vi.fn(async (): Promise<ShippingResult> => ({ success: true, result: 85 }));
const offerEvaluate = vi.fn(async (_i: unknown): Promise<OffersResult> => ({ success: true, result: [] }));
const promoValidate = vi.fn(async (input: { code: string }): Promise<PromoResult> =>
  input.code === "FLAT100"
    ? {
        success: true,
        result: {
          id: "00000000-0000-4000-8000-0000000000aa",
          code: "FLAT100",
          discountType: "fixed_amount",
          discountValue: 100,
          appliesToAllProducts: true,
          eligibleProductIds: [STRAPS],
          discountLabel: "100.00 EGP off",
        },
      }
    : { success: false, error: "n/a" },
);
let serverMethods: Array<{ id: string; label: string; description: string }> = [];

const orderCreate = vi.fn(async (_input: Record<string, unknown>) => ({
  success: true,
  result: { id: "order-1", total: "1389.00", reference: "ORD-1", confirmationToken: "tok" },
}));
const markConverted = vi.fn(async () => ({}));
const createSession = vi.fn(async (_input: Record<string, unknown>) => ({}));
const startCheckout = vi.fn(async (_input: Record<string, unknown>) => ({
  success: true as const,
  result: {
    kind: "redirect" as const,
    attemptId: ATTEMPT_ID,
    paymentUrl: "https://fawaterak.test/pay/x",
    resumed: false,
  },
}));
const navigate = vi.fn();

vi.mock("#root/shared/trpc/client", () => ({
  trpc: {
    promoCode: { validate: { query: (i: { code: string }) => promoValidate(i) } },
    settings: { getShippingFee: { query: () => shippingFee() } },
    offer: {
      evaluate: { query: (i: unknown) => offerEvaluate(i) },
      // Modern template's OfferProgressBanner.
      listActive: { query: async () => ({ success: true, result: [] }) },
    },
    product: {
      availability: {
        query: async (i: { ids: string[] }) => ({ success: true, result: { availableIds: i.ids } }),
      },
    },
    cartCapture: {
      sync: { mutate: async () => ({}) },
      markConverted: { mutate: () => markConverted() },
    },
    payment: {
      methods: { query: async () => ({ methods: serverMethods }) },
      createSession: { mutate: (i: Record<string, unknown>) => createSession(i) },
      startCheckout: { mutate: (i: Record<string, unknown>) => startCheckout(i) },
    },
    order: { create: { mutate: (i: Record<string, unknown>) => orderCreate(i) } },
  },
}));

let templateId = "checkout-editorial";
vi.mock("#root/lib/cart-session", () => ({ getCartSessionToken: () => "test-session" }));
vi.mock("vike/client/router", () => ({ navigate: (...a: unknown[]) => navigate(...a) }));
vi.mock("#root/frontend/contexts/TrackingContext", () => ({
  useTracking: () => ({ trackEvent: () => {} }),
}));
vi.mock("#root/frontend/contexts/TemplateContext", () => ({
  useTemplate: () => ({ getTemplateId: () => templateId }),
}));
vi.mock("#root/components/template-system/templateConfig", () => ({
  getTemplateComponent: (_page: string, id: string) => ({
    component: id === "checkout-modern" ? CheckoutPageModernTemplate : CheckoutPageEditorialTemplate,
  }),
}));
vi.mock("#root/lib/i18n/MinimalI18nContext", () => ({
  useMinimalI18n: () => ({ t: () => "" }),
}));
vi.mock("#root/components/template-system/editorial/EditorialChrome", () => ({
  EditorialChrome: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("#root/components/template-system/motion/Reveal", () => ({
  Reveal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("#root/components/template-system/motion/Stagger", () => ({
  StaggerContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StaggerItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("#root/components/checkout/BostaShippingFields", () => ({
  BostaShippingFields: ({ fallback }: { fallback: ReactNode }) => <>{fallback}</>,
}));
vi.mock("#root/components/checkout/CityCombobox", () => ({
  CityCombobox: () => <input aria-label="Governorate" />,
}));

const FAWATERAK = { id: "fawaterak", label: "Online Payment", description: "Pay securely online" };
const COD = { id: "cod", label: "Cash on Delivery", description: "Pay on delivery" };

let cart!: ReturnType<typeof useCart>;
function Probe() {
  cart = useCart();
  return null;
}

let container: HTMLDivElement;
let root: Root;
const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <CartProvider>
        <Probe />
        <CheckoutPage />
      </CartProvider>,
    ),
  );
  await settle();
}

async function mountWithItem(quantity = 1) {
  await mount();
  act(() => {
    cart.addItem({ id: STRAPS, name: "Mach – Figure 8 Straps", price: PRICE, stock: 20 } as never, quantity, {});
  });
  await settle();
}

const radios = () =>
  Array.from(container.querySelectorAll<HTMLInputElement>('input[name="paymentMethod"]'));
const radio = (value: string) =>
  container.querySelector<HTMLInputElement>(`input[name="paymentMethod"][value="${value}"]`);
const estimate = () =>
  container.querySelector('[data-testid="valu-installment-estimate"]')?.textContent ?? null;

async function choose(value: string) {
  const r = radio(value);
  expect(r).not.toBeNull();
  await act(async () => r!.click());
  await settle();
}

async function submit() {
  const form = container.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

const hrefSetter = vi.fn();
let originalLocation: Location;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  templateId = "checkout-editorial";
  serverMethods = [COD, FAWATERAK];
  shippingFee.mockReset().mockImplementation(async () => ({ success: true, result: 85 }));
  offerEvaluate.mockReset().mockImplementation(async () => ({ success: true, result: [] }));
  for (const m of [orderCreate, markConverted, createSession, startCheckout, navigate, hrefSetter, promoValidate]) {
    m.mockClear();
  }
  originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin: "http://localhost",
      get href() {
        return "http://localhost/checkout";
      },
      set href(v: string) {
        hrefSetter(v);
      },
    },
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

const EST_1389 = "Estimated EGP 463.00/month for 3 months";
const CALCULATING = "Calculating installment estimate…";

describe("valU option rendering", () => {
  it("shows PAY IN FULL (COD, Online) and INSTALLMENTS (valU) in ONE radio group", async () => {
    await mountWithItem();

    const legends = Array.from(container.querySelectorAll("legend")).map((l) => l.textContent);
    expect(legends).toEqual(["Pay in full", "Installments"]);

    const group = radios();
    expect(group.map((r) => r.value)).toEqual(["cod", "fawaterak", "valu_installments"]);
    // Same name + same form = one native radio group (arrow keys move across it).
    const form = container.querySelector("form");
    for (const r of group) {
      expect(r.name).toBe("paymentMethod");
      expect(r.form).toBe(form);
    }

    const valu = container.querySelector('[data-testid="valu-installments-option"]')!;
    expect(valu.textContent).toContain("Installments with valU");
    expect(valu.textContent).toContain("Pay over 3 months");
    expect(valu.textContent).toContain(
      "Final installment amount and any applicable fees are confirmed by valU.",
    );
    expect(valu.textContent).not.toMatch(/0\s*%|zero|interest[- ]free|no fees?/i);
  });

  it("valU radio is labelled and described for assistive tech", async () => {
    await mountWithItem();
    const r = radio("valu_installments")!;
    const labelId = r.getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelId)?.textContent).toBe("Installments with valU");
    const described = r.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual([
      "Pay over 3 months",
      EST_1389,
      "Final installment amount and any applicable fees are confirmed by valU.",
    ]);
  });

  it("no valU (and no group headings) when Fawaterak is not offered — COD-only card unchanged", async () => {
    serverMethods = [COD];
    await mountWithItem();
    expect(radio("valu_installments")).toBeNull();
    expect(container.querySelectorAll("legend")).toHaveLength(0);
    expect(radios().map((r) => r.value)).toEqual(["cod"]);
  });

  it("also rendered by the Modern template, in the same single group", async () => {
    templateId = "checkout-modern";
    await mountWithItem();
    expect(radios().map((r) => r.value)).toEqual(["cod", "fawaterak", "valu_installments"]);
    expect(estimate()).toBe(EST_1389);
    await choose("valu_installments");
    expect(radio("valu_installments")!.checked).toBe(true);
  });
});

describe("installment estimate", () => {
  it("EGP 1,389 → Estimated EGP 463.00/month for 3 months", async () => {
    await mountWithItem();
    expect(cart.total).toBe(1389);
    expect(container.textContent).toContain("EGP 1389.00");
    expect(estimate()).toBe(EST_1389);
  });

  it("quantity change: calculating while offers re-evaluate, then the new figure — never the old one", async () => {
    await mountWithItem();
    expect(estimate()).toBe(EST_1389);

    const pending = deferred<OffersResult>();
    offerEvaluate.mockImplementationOnce(() => pending.promise);
    act(() => {
      cart.updateQuantity(STRAPS, 2, {});
    });
    await settle();
    // 2 × 1304 + 85 = 2693 is displayed, but the offer answer could still change it.
    expect(estimate()).toBe(CALCULATING);
    expect(container.textContent).not.toContain("463.00");

    await act(async () => pending.resolve({ success: true, result: [] }));
    await settle();
    expect(estimate()).toBe("Estimated EGP 897.67/month for 3 months");
  });

  it("shipping change: a free-shipping offer drops shipping and the estimate follows", async () => {
    offerEvaluate.mockImplementation(async () => ({
      success: true,
      result: [
        {
          id: "offer-ship",
          name: "Free Shipping",
          description: null,
          reward: { type: "free_shipping" },
          discountAmount: 0,
          freeShipping: true,
          label: "Free shipping",
        },
      ],
    }));
    await mountWithItem();
    expect(cart.shipping).toBe(0);
    expect(cart.total).toBe(1304);
    expect(estimate()).toBe("Estimated EGP 434.67/month for 3 months");
  });

  it("promo code: calculating while it applies, then the discounted estimate; removing restores it", async () => {
    await mountWithItem();
    expect(estimate()).toBe(EST_1389);

    const pending = deferred<PromoResult>();
    promoValidate.mockImplementationOnce(() => pending.promise);
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="desktop-promo-code"] input[aria-label="Promo code"]',
    )!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, "FLAT100");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const apply = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid="desktop-promo-code"] button'),
    ).find((b) => b.textContent === "Apply")!;
    await act(async () => apply.click());
    expect(estimate()).toBe(CALCULATING);

    await act(async () =>
      pending.resolve({
        success: true,
        result: {
          id: "00000000-0000-4000-8000-0000000000aa",
          code: "FLAT100",
          discountType: "fixed_amount",
          discountValue: 100,
          appliesToAllProducts: true,
          eligibleProductIds: [STRAPS],
          discountLabel: "100.00 EGP off",
        },
      }),
    );
    await settle();
    expect(cart.total).toBe(1289);
    expect(estimate()).toBe("Estimated EGP 429.67/month for 3 months");

    act(() => cart.removePromoCode());
    await settle();
    expect(estimate()).toBe(EST_1389);
  });

  it("pending total on load: calculating until the shipping fee has loaded", async () => {
    const fee = deferred<ShippingResult>();
    shippingFee.mockImplementationOnce(() => fee.promise);
    localStorage.setItem(
      "cart",
      JSON.stringify([{ id: STRAPS, name: "Straps", price: PRICE, stock: 20, quantity: 1, selectedOptions: {} }]),
    );
    await mount();
    // Total shows 1304 (no shipping yet) — an estimate from it would be wrong.
    expect(estimate()).toBe(CALCULATING);
    expect(container.textContent).not.toContain("434.67");

    await act(async () => fee.resolve({ success: true, result: 85 }));
    await settle();
    expect(estimate()).toBe(EST_1389);
  });

  it("pending total on load: calculating while a saved promo code is being restored", async () => {
    const restore = deferred<PromoResult>();
    promoValidate.mockImplementationOnce(() => restore.promise);
    localStorage.setItem(
      "cart",
      JSON.stringify([{ id: STRAPS, name: "Straps", price: PRICE, stock: 20, quantity: 1, selectedOptions: {} }]),
    );
    localStorage.setItem("promoCode", JSON.stringify({ code: "FLAT100" }));
    await mount();
    expect(estimate()).toBe(CALCULATING);
    expect(container.textContent).not.toContain("463.00");

    await act(async () =>
      restore.resolve({
        success: true,
        result: {
          id: "00000000-0000-4000-8000-0000000000aa",
          code: "FLAT100",
          discountType: "fixed_amount",
          discountValue: 100,
          appliesToAllProducts: true,
          eligibleProductIds: [STRAPS],
          discountLabel: "100.00 EGP off",
        },
      }),
    );
    await settle();
    expect(estimate()).toBe("Estimated EGP 429.67/month for 3 months");
  });

  it("empty cart: no estimate figure (the displayed total would be shipping only)", async () => {
    await mount();
    expect(cart.total).toBe(85);
    expect(estimate()).toBe(CALCULATING);
  });
});

describe("selection", () => {
  it("switches between COD, Online and valU — exactly one checked, highlighted border follows", async () => {
    await mountWithItem();
    const checked = () => radios().filter((r) => r.checked).map((r) => r.value);
    expect(checked()).toEqual(["cod"]);

    await choose("valu_installments");
    expect(checked()).toEqual(["valu_installments"]);
    const valuLabel = container.querySelector('[data-testid="valu-installments-option"]')!;
    expect(valuLabel.className).toContain("border-stone-900");

    await choose("fawaterak");
    expect(checked()).toEqual(["fawaterak"]);
    expect(valuLabel.className).not.toContain("border-stone-900");

    await choose("cod");
    expect(checked()).toEqual(["cod"]);
    await choose("valu_installments");
    expect(checked()).toEqual(["valu_installments"]);
  });

  it("selecting valU creates no order, payment attempt or payment session", async () => {
    await mountWithItem();
    await choose("valu_installments");
    await choose("cod");
    await choose("valu_installments");
    expect(orderCreate).not.toHaveBeenCalled();
    expect(startCheckout).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(markConverted).not.toHaveBeenCalled();
    expect(hrefSetter).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("Place Order", () => {
  it("valU → existing Fawaterak payment-attempt flow and hosted page; no order, no valU value sent", async () => {
    await mountWithItem();
    await choose("valu_installments");
    await submit();

    expect(startCheckout).toHaveBeenCalledTimes(1);
    const input = startCheckout.mock.calls[0]![0];
    expect(input.paymentMethod).toBe("fawaterak");
    expect(JSON.stringify(input)).not.toContain("valu");
    expect(input.items).toEqual([{ productId: STRAPS, quantity: 1, selectedOptions: undefined }]);
    expect(hrefSetter).toHaveBeenCalledWith("https://fawaterak.test/pay/x");
    expect(orderCreate).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(markConverted).not.toHaveBeenCalled();
    expect(cart.items).toHaveLength(1);
    expect(sessionStorage.getItem(`pending_cart_clear:attempt:${ATTEMPT_ID}`)).toBe("1");
  });

  it("regression: Online Payment still starts the same Fawaterak attempt", async () => {
    await mountWithItem();
    await choose("fawaterak");
    await submit();
    expect(startCheckout).toHaveBeenCalledTimes(1);
    expect(startCheckout.mock.calls[0]![0].paymentMethod).toBe("fawaterak");
    expect(hrefSetter).toHaveBeenCalledWith("https://fawaterak.test/pay/x");
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("regression: valU and Online Payment send identical attempt payloads", async () => {
    await mountWithItem();
    await choose("fawaterak");
    await submit();
    const online = startCheckout.mock.calls[0]![0];
    await choose("valu_installments");
    await submit();
    expect(startCheckout).toHaveBeenCalledTimes(2);
    expect(startCheckout.mock.calls[1]![0]).toEqual(online);
  });

  it("regression: COD creates the order with paymentMethod cod — no payment attempt", async () => {
    await mountWithItem();
    await choose("valu_installments");
    await choose("cod");
    await submit();
    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect(orderCreate.mock.calls[0]![0].paymentMethod).toBe("cod");
    expect(startCheckout).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining("/order-confirmation?id=order-1"));
    expect(hrefSetter).not.toHaveBeenCalled();
  });
});
