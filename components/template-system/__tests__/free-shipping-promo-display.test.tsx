// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CartPageEditorialTemplate } from "../cartPage/CartPageEditorialTemplate";
import { CheckoutPageEditorialTemplate } from "../checkoutPage/CheckoutPageEditorialTemplate";

/**
 * How the Editorial cart and checkout (the templates live in production)
 * show an applied Free Shipping code: the code and its "Free shipping" label,
 * Shipping as "Free", no product discount line, and a total without shipping.
 * The numbers come from CartContext (tested separately); this pins the view.
 */

vi.mock("../editorial/EditorialChrome", () => ({
  EditorialChrome: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../motion/Reveal", () => ({
  Reveal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../motion/Stagger", () => ({
  StaggerContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StaggerItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("#root/components/checkout/BostaShippingFields", () => ({
  BostaShippingFields: ({ fallback }: { fallback: ReactNode }) => <>{fallback}</>,
}));
vi.mock("#root/components/checkout/CityCombobox", () => ({
  CityCombobox: () => <input aria-label="Governorate" />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const whey = { id: "whey", name: "Mach Whey", price: 500, quantity: 2, stock: 10, available: true };
const freeShipTotals = { subtotal: 1000, discount: 0, shipping: 0, grandTotal: 1000 };
const applied = { code: "FREESHIP", discountLabel: "Free shipping" };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (ui: ReactNode) => act(() => root.render(ui));
const text = () => (container.textContent ?? "").replace(/\s+/g, " ");

/** The value shown next to a summary label, e.g. row("Shipping") → "Free". */
function rowValue(label: string): string[] {
  return [...container.querySelectorAll("div.flex.justify-between")]
    .filter((row) => row.firstElementChild?.textContent?.trim() === label)
    .map((row) => row.lastElementChild?.textContent?.trim() ?? "");
}

describe("Free Shipping code on the Editorial cart", () => {
  it("shows the code, its benefit, Shipping as Free and the total without shipping", () => {
    render(
      <CartPageEditorialTemplate
        items={[whey]}
        totals={freeShipTotals}
        currency="EGP"
        onApplyCoupon={async () => ({ success: true, message: "" })}
        appliedCoupon={applied}
        onRemoveCoupon={() => {}}
      />,
    );
    const box = container.querySelector('[data-testid="applied-promo-code"]');
    expect(box?.textContent).toContain("FREESHIP — Free shipping");
    expect(rowValue("Shipping")).toEqual(["Free"]);
    expect(rowValue("Subtotal")[0]).toMatch(/1000.00/);
    expect(rowValue("Total")[0]).toMatch(/1000.00/);
    // A zero product discount isn't shown as a discount line.
    expect(text()).not.toMatch(/Discount \(FREESHIP\)/);
  });
});

describe("Free Shipping code on the Editorial checkout", () => {
  it("shows the code with its benefit and Shipping as Free, with no 'You save' line", () => {
    render(
      <CheckoutPageEditorialTemplate
        items={[{ id: "whey", name: "Mach Whey", price: 500, quantity: 2 }]}
        totals={freeShipTotals}
        currency="EGP"
        onApplyCoupon={async () => ({ success: true, message: "" })}
        appliedCoupon={applied}
        onRemoveCoupon={() => {}}
      />,
    );
    const box = container.querySelector('[data-testid="desktop-promo-code"] [data-testid="applied-promo-code"]');
    expect(box?.textContent).toContain("FREESHIP — Free shipping");
    expect(box?.textContent).not.toContain("You save");
    expect(rowValue("Shipping").every((v) => v === "Free")).toBe(true);
    expect(rowValue("Shipping").length).toBeGreaterThan(0);
    expect(text()).not.toMatch(/Discount \(FREESHIP\)/);
  });
});
