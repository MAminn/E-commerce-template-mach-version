// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The online-payment return page (?attempt=…). The customer never sees an
 * order number before a real order exists; Purchase fires once, only for a
 * real order; the cart is cleared only after the payment is verified.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ATTEMPT_ID = "019a1b2c-aaaa-7bbb-8ccc-000000000001";
const ORDER_ID = ATTEMPT_ID; // a materialized order reuses the attempt id

type Status =
  | "pending"
  | "failed"
  | "cancelled"
  | "paid_pending_materialization"
  | "materialized";
let serverState: {
  status: Status;
  order: { id: string; reference?: string | null; total: string; customerEmail: string; onHold: boolean } | null;
};
const attemptStatus = vi.fn(async () => ({
  success: true as const,
  result: { attemptId: ATTEMPT_ID, amount: "484.00", ...serverState },
}));
const trackEvent = vi.fn();
const clearCart = vi.fn();

vi.mock("#root/shared/trpc/client", () => ({
  trpc: { payment: { attemptStatus: { query: () => attemptStatus() } } },
}));
vi.mock("#root/frontend/contexts/TrackingContext", () => ({
  useTracking: () => ({ trackEvent }),
}));
vi.mock("#root/lib/context/CartContext", () => ({
  useCart: () => ({ clearCart }),
}));
vi.mock("#root/components/utils/Link", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { AttemptConfirmation } from "../AttemptConfirmation";

let container: HTMLDivElement;
let root: Root;
const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

async function mount(returnedAs: string | null) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<AttemptConfirmation attemptId={ATTEMPT_ID} returnedAs={returnedAs} />));
  await settle();
}
function unmount() {
  act(() => root.unmount());
  container.remove();
}
const text = () => container.textContent ?? "";
const orderNumber = () => container.querySelector('[data-testid="order-number"]');
const state = () =>
  container.querySelector('[data-testid="attempt-confirmation"]')?.getAttribute("data-state");

beforeEach(() => {
  sessionStorage.clear();
  attemptStatus.mockClear();
  trackEvent.mockClear();
  clearCart.mockClear();
});
afterEach(() => {
  if (container?.isConnected) unmount();
});

describe("online payment return page", () => {
  it("pending: 'Payment Not Confirmed Yet', no order number, no Purchase, cart kept", async () => {
    serverState = { status: "pending", order: null };
    sessionStorage.setItem(`pending_cart_clear:attempt:${ATTEMPT_ID}`, "1");
    await mount("success");

    expect(state()).toBe("awaiting");
    expect(text()).toContain("Payment Not Confirmed Yet");
    expect(orderNumber()).toBeNull();
    expect(text()).not.toMatch(/Order Number|Order Confirmed/);
    expect(trackEvent).not.toHaveBeenCalled();
    expect(clearCart).not.toHaveBeenCalled();
  });

  it("L, O. failed/cancelled: 'Payment Wasn't Completed', not an order, cart kept, retry link", async () => {
    for (const [status, returnedAs] of [
      ["failed", "failed"],
      ["cancelled", "cancelled"],
      ["pending", "cancelled"], // hosted page 'back' before any webhook
    ] as const) {
      serverState = { status, order: null };
      sessionStorage.setItem(`pending_cart_clear:attempt:${ATTEMPT_ID}`, "1");
      await mount(returnedAs);

      expect(state()).toBe("not_completed");
      expect(text()).toContain("Payment Wasn't Completed");
      expect(text()).toContain("No order was placed");
      expect(orderNumber()).toBeNull();
      expect(container.querySelector('a[href="/checkout"]')).not.toBeNull();
      expect(clearCart).not.toHaveBeenCalled();
      expect(trackEvent).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("X. paid but order still being created: 'Payment Received', never 'failed', no order number yet, cart cleared", async () => {
    serverState = { status: "paid_pending_materialization", order: null };
    sessionStorage.setItem(`pending_cart_clear:attempt:${ATTEMPT_ID}`, "1");
    await mount("success");

    expect(state()).toBe("paid_processing");
    expect(text()).toContain("Payment Received");
    expect(text()).not.toMatch(/fail/i);
    expect(orderNumber()).toBeNull();
    expect(trackEvent).not.toHaveBeenCalled();
    expect(clearCart).toHaveBeenCalledTimes(1);
  });

  it("T, AF. materialized: real order number, Purchase once with the real order id, cart cleared once", async () => {
    serverState = {
      status: "materialized",
      order: { id: ORDER_ID, total: "484.00", customerEmail: "c@example.com", onHold: false },
    };
    sessionStorage.setItem(`pending_cart_clear:attempt:${ATTEMPT_ID}`, "1");
    sessionStorage.setItem(
      `checkout_items:attempt:${ATTEMPT_ID}`,
      JSON.stringify([{ itemId: "p1", itemName: "Straps", price: 399, quantity: 1 }]),
    );
    await mount("success");

    expect(state()).toBe("confirmed");
    expect(text()).toContain("Order Confirmed!");
    expect(orderNumber()?.textContent).toBe(`#${ORDER_ID.slice(0, 8).toUpperCase()}`);
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent.mock.calls[0]![1]).toMatchObject({
      ecommerce: {
        value: 484,
        transactionId: ORDER_ID,
        items: [{ itemId: "p1", itemName: "Straps", price: 399, quantity: 1 }],
      },
    });
    expect(clearCart).toHaveBeenCalledTimes(1);

    // A reload / second visit doesn't fire Purchase or clear the cart again.
    unmount();
    await mount("success");
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(clearCart).toHaveBeenCalledTimes(1);
  });

  it("REF. shows the order's unique reference, not the id prefix", async () => {
    serverState = {
      status: "materialized",
      order: { id: ORDER_ID, reference: "ORD-3F9A01C2", total: "484.00", customerEmail: "c@example.com", onHold: false },
    } as typeof serverState;
    await mount("success");
    expect(orderNumber()?.textContent).toBe("#3F9A01C2");
  });

  it("a confirmation link opened in a browser that didn't start the checkout never clears that browser's cart", async () => {
    serverState = {
      status: "materialized",
      order: { id: ORDER_ID, total: "484.00", customerEmail: "c@example.com", onHold: false },
    };
    await mount("success");
    expect(state()).toBe("confirmed");
    expect(clearCart).not.toHaveBeenCalled();
  });

  it("U. paid order on a stock hold: real order number, 'under review', no promise of normal fulfillment", async () => {
    serverState = {
      status: "materialized",
      order: { id: ORDER_ID, total: "484.00", customerEmail: "c@example.com", onHold: true },
    };
    await mount("success");
    expect(text()).toContain("Payment Received");
    expect(text()).toContain("Under review");
    expect(text()).not.toContain("Order Confirmed!");
    expect(orderNumber()).not.toBeNull();
  });
});
