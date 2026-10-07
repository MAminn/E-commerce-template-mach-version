// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CartProvider, useCart } from "#root/lib/context/CartContext";
import { CheckoutPageEditorialTemplate } from "#root/components/template-system/checkoutPage/CheckoutPageEditorialTemplate";
import CheckoutPage from "../+Page";

/**
 * Online (Fawaterak) checkout submit with the production Editorial template:
 * it starts a payment ATTEMPT — it never creates an order, never marks the
 * cart converted and never clears the cart. A failure to start the payment
 * leaves the customer on checkout with their cart, free to retry.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STRAPS = "00000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "019a0000-aaaa-7bbb-8ccc-000000000001";

const orderCreate = vi.fn(async () => ({ success: true, result: { id: "order-1", total: "0" } }));
const markConverted = vi.fn(async () => ({}));
const createSession = vi.fn(async () => ({}));
type StartResult =
  | { success: true; result: { kind: "redirect"; attemptId: string; paymentUrl: string; resumed: boolean } }
  | { success: true; result: { kind: "already_paid"; attemptId: string } }
  | { success: false; error: string };
const startCheckout = vi.fn(async (_input: Record<string, unknown>): Promise<StartResult> => ({
  success: true,
  result: { kind: "redirect", attemptId: ATTEMPT_ID, paymentUrl: "https://fawaterak.test/pay/x", resumed: false },
}));
const navigate = vi.fn();

vi.mock("#root/shared/trpc/client", () => ({
  trpc: {
    promoCode: { validate: { query: async () => ({ success: false, error: "n/a" }) } },
    settings: { getShippingFee: { query: async () => ({ success: true, result: 85 }) } },
    offer: { evaluate: { query: async () => ({ success: true, result: [] }) } },
    cartCapture: {
      sync: { mutate: async () => ({}) },
      markConverted: { mutate: () => markConverted() },
    },
    payment: {
      methods: {
        query: async () => ({
          methods: [
            { id: "fawaterak", label: "Online Payment", description: "" },
            { id: "cod", label: "Cash on Delivery", description: "" },
          ],
        }),
      },
      createSession: { mutate: () => createSession() },
      startCheckout: { mutate: (i: Record<string, unknown>) => startCheckout(i) },
    },
    order: { create: { mutate: () => orderCreate() } },
  },
}));

vi.mock("#root/lib/cart-session", () => ({ getCartSessionToken: () => "test-session" }));
vi.mock("vike/client/router", () => ({ navigate: (...a: unknown[]) => navigate(...a) }));
vi.mock("#root/frontend/contexts/TrackingContext", () => ({
  useTracking: () => ({ trackEvent: () => {} }),
}));
vi.mock("#root/frontend/contexts/TemplateContext", () => ({
  useTemplate: () => ({ getTemplateId: () => "checkout-editorial" }),
}));
vi.mock("#root/components/template-system/templateConfig", () => ({
  getTemplateComponent: () => ({ component: CheckoutPageEditorialTemplate }),
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

let cart!: ReturnType<typeof useCart>;
function Probe() {
  cart = useCart();
  return null;
}

let container: HTMLDivElement;
let root: Root;
const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

async function mountCheckoutWithItem() {
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
  act(() => {
    cart.addItem({ id: STRAPS, name: "Mach – Figure 8 Straps", price: 399, stock: 20 }, 1, {});
  });
  await settle();
}

async function choose(method: "fawaterak" | "cod") {
  const radio = container.querySelector<HTMLInputElement>(`input[name="paymentMethod"][value="${method}"]`);
  expect(radio).not.toBeNull();
  await act(async () => radio!.click());
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
  for (const m of [orderCreate, markConverted, createSession, startCheckout, navigate, hrefSetter]) m.mockClear();
  originalLocation = window.location;
  // Capture the hosted-page redirect instead of navigating the test window.
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

describe("online checkout submit (Fawaterak)", () => {
  it("B. starts a payment attempt and redirects — no order.create, no cart conversion, cart kept", async () => {
    await mountCheckoutWithItem();
    await choose("fawaterak");
    await submit();

    expect(startCheckout).toHaveBeenCalledTimes(1);
    const input = startCheckout.mock.calls[0]![0];
    expect(input.paymentMethod).toBe("fawaterak");
    expect(input.cartSessionToken).toBe("test-session");
    expect(input.items).toEqual([{ productId: STRAPS, quantity: 1, selectedOptions: undefined }]);

    expect(orderCreate).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(markConverted).not.toHaveBeenCalled();
    expect(hrefSetter).toHaveBeenCalledWith("https://fawaterak.test/pay/x");
    // Cart untouched until the payment is verified on the confirmation page.
    expect(cart.items).toHaveLength(1);
    expect(sessionStorage.getItem(`pending_cart_clear:attempt:${ATTEMPT_ID}`)).toBe("1");
    expect(sessionStorage.getItem(`checkout_items:attempt:${ATTEMPT_ID}`)).toContain(STRAPS);
  });

  it("N, O. payment can't be started → retryable error on checkout, cart intact, no order, no redirect", async () => {
    startCheckout.mockResolvedValueOnce({
      success: false,
      error: "We couldn't start the online payment. Nothing was charged and your cart is still here — please try again.",
    });
    await mountCheckoutWithItem();
    await choose("fawaterak");
    await submit();

    expect(container.textContent).toContain("We couldn't start the online payment");
    expect(cart.items).toHaveLength(1);
    expect(orderCreate).not.toHaveBeenCalled();
    expect(markConverted).not.toHaveBeenCalled();
    expect(hrefSetter).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    // Retry works from the same page.
    await submit();
    expect(startCheckout).toHaveBeenCalledTimes(2);
    expect(hrefSetter).toHaveBeenCalledWith("https://fawaterak.test/pay/x");
  });

  it("R. resuming a checkout Fawaterak already reports paid goes straight to its confirmation", async () => {
    startCheckout.mockResolvedValueOnce({
      success: true,
      result: { kind: "already_paid", attemptId: ATTEMPT_ID },
    });
    await mountCheckoutWithItem();
    await choose("fawaterak");
    await submit();
    expect(navigate).toHaveBeenCalledWith(`/order-confirmation?attempt=${ATTEMPT_ID}&payment=success`);
    expect(hrefSetter).not.toHaveBeenCalled();
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("A. COD is unchanged — order.create, then cart cleared", async () => {
    await mountCheckoutWithItem();
    await choose("cod");
    await submit();

    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect(startCheckout).not.toHaveBeenCalled();
    expect(cart.items).toHaveLength(0);
  });
});
