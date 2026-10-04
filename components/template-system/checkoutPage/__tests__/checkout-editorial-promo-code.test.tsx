// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CheckoutOrderSummaryItem,
  CheckoutTotals,
} from "../CheckoutPageModernTemplate";
import {
  CheckoutPageEditorialTemplate,
  type CheckoutPageEditorialTemplateProps,
} from "../CheckoutPageEditorialTemplate";

/**
 * The promo-code box on the Editorial checkout — the checkout template Mach
 * runs in production (`checkoutPage: "checkout-editorial"`).
 *
 * Like the cart's box, it is only a UI over CartContext's one promo state:
 * these tests pin what the template does with the result and the applied
 * code it is handed. The shared-state behaviour across cart and checkout is
 * covered against the real CartContext in pages/checkout/__tests__.
 */

vi.mock("../../editorial/EditorialChrome", () => ({
  EditorialChrome: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../motion/Reveal", () => ({
  Reveal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../motion/Stagger", () => ({
  StaggerContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  StaggerItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
// Address pickers fetch on mount; the promo box doesn't care about them.
vi.mock("#root/components/checkout/BostaShippingFields", () => ({
  BostaShippingFields: ({ fallback }: { fallback: ReactNode }) => <>{fallback}</>,
}));
vi.mock("#root/components/checkout/CityCombobox", () => ({
  CityCombobox: () => <input aria-label="Governorate" />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type ApplyResult = { success: boolean; message: string };
type AppliedCoupon = { code: string; discountLabel?: string } | null;

const VALID_MSG = '"AGIZA20" applied — 20% off.';
const INVALID_MSG =
  '"THISCODEDOESNOTEXIST999" isn\'t a valid promo code. Check the spelling and try again.';
const INELIGIBLE_MSG =
  "This promo code doesn't apply to any of the items in your cart.";

const straps: CheckoutOrderSummaryItem = {
  id: "straps",
  name: "Mach – Figure 8 Straps",
  price: 399,
  quantity: 1,
};

const baseTotals: CheckoutTotals = { subtotal: 399, shipping: 85, grandTotal: 484 };
const discountedTotals: CheckoutTotals = {
  subtotal: 399,
  discount: 79.8,
  shipping: 85,
  grandTotal: 404.2,
};

/** Stands in for pages/checkout/+Page.tsx + CartContext. */
function Harness({
  apply,
  initialApplied = null,
  couponNotice = null,
  onDismissCouponNotice,
  onSubmit,
}: {
  apply: (
    code: string,
    setApplied: (c: AppliedCoupon) => void,
  ) => Promise<ApplyResult>;
  initialApplied?: AppliedCoupon;
  couponNotice?: string | null;
  onDismissCouponNotice?: () => void;
  onSubmit?: CheckoutPageEditorialTemplateProps["onSubmit"];
}) {
  const [applied, setApplied] = useState<AppliedCoupon>(initialApplied);
  return (
    <CheckoutPageEditorialTemplate
      items={[straps]}
      totals={applied ? discountedTotals : baseTotals}
      currency="EGP"
      onSubmit={onSubmit}
      onApplyCoupon={(code) => apply(code, setApplied)}
      appliedCoupon={applied}
      onRemoveCoupon={() => setApplied(null)}
      couponNotice={couponNotice}
      onDismissCouponNotice={onDismissCouponNotice}
    />
  );
}

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

type Placement = "desktop" | "mobile";
const box = (p: Placement = "desktop") =>
  container.querySelector<HTMLElement>(`[data-testid="${p}-promo-code"]`)!;
const input = (p: Placement = "desktop") =>
  box(p).querySelector<HTMLInputElement>('input[aria-label="Promo code"]');
const applyButton = (p: Placement = "desktop") =>
  [...box(p).querySelectorAll("button")].find((b) =>
    /^(Apply|Checking…)$/.test(b.textContent ?? ""),
  )!;
const feedback = (p: Placement = "desktop") =>
  container.querySelector(`#${p}-promo-code-feedback`)!.textContent ?? "";
const appliedBox = (p: Placement = "desktop") =>
  box(p).querySelector('[data-testid="applied-promo-code"]');
const placeOrderButtons = () =>
  [...container.querySelectorAll<HTMLButtonElement>('button[type="submit"]')];
const text = () => container.textContent ?? "";

function type(value: string, p: Placement = "desktop") {
  const el = input(p)!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickApply(p: Placement = "desktop") {
  await act(async () => {
    applyButton(p).click();
  });
}

async function pressEnter(p: Placement = "desktop") {
  await act(async () => {
    input(p)!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const acceptAgiza = vi.fn(
  async (code: string, setApplied: (c: AppliedCoupon) => void) => {
    setApplied({ code, discountLabel: "20% off" });
    return { success: true, message: VALID_MSG };
  },
);
const reject = (message: string) =>
  vi.fn(async () => ({ success: false, message }));

describe("Editorial checkout promo code — no code yet", () => {
  it("shows a labelled, empty Promo Code field with a disabled Apply", () => {
    render(<Harness apply={acceptAgiza} />);
    expect(box().textContent).toContain("Promo Code");
    expect(input()!.value).toBe("");
    expect(input()!.placeholder).toBe("Enter promo code");
    expect(applyButton().disabled).toBe(true);
    expect(appliedBox()).toBeNull();
    expect(text()).not.toContain("Discount");
  });

  it("is visible on mobile without expanding the order summary", () => {
    render(<Harness apply={acceptAgiza} />);
    const summaryToggle = container.querySelector("button[aria-expanded]")!;
    expect(summaryToggle.getAttribute("aria-expanded")).toBe("false");
    expect(input("mobile")).not.toBeNull();
  });

  it("renders no promo box when the page doesn't wire one", () => {
    render(<CheckoutPageEditorialTemplate items={[straps]} totals={baseTotals} />);
    expect(container.querySelector('[data-testid$="-promo-code"]')).toBeNull();
  });
});

describe("Editorial checkout promo code — apply", () => {
  it("applies a valid code: shows it, its label, the saving and Remove", async () => {
    render(<Harness apply={acceptAgiza} />);
    type("AGIZA20");
    await clickApply();

    expect(acceptAgiza).toHaveBeenCalledWith("AGIZA20", expect.any(Function));
    expect(feedback()).toContain(VALID_MSG);
    const applied = appliedBox()!;
    expect(applied.textContent).toContain("AGIZA20");
    expect(applied.textContent).toContain("20% off");
    expect(applied.textContent).toContain("You save EGP 79.80");
    expect(applied.textContent).toContain("Remove");
    expect(text()).toContain("Discount (AGIZA20)");
    expect(text()).toContain("EGP 404.20");
  });

  it("hides the input while a code is applied, so a second code can't be stacked", async () => {
    render(<Harness apply={acceptAgiza} />);
    type("AGIZA20");
    await clickApply();
    expect(input()).toBeNull();
    expect(input("mobile")).toBeNull();
  });

  it("shows a code that was already applied in the cart without re-entry", () => {
    const apply = vi.fn(acceptAgiza);
    render(
      <Harness
        apply={apply}
        initialApplied={{ code: "AGIZA20", discountLabel: "20% off" }}
      />,
    );
    expect(appliedBox()!.textContent).toContain("AGIZA20");
    expect(appliedBox("mobile")!.textContent).toContain("AGIZA20");
    expect(text()).toContain("EGP 404.20");
    expect(apply).not.toHaveBeenCalled();
  });

  it("shows Checking… and ignores repeat submissions while applying", async () => {
    const pending = deferred<ApplyResult>();
    const apply = vi.fn(() => pending.promise);
    render(<Harness apply={apply} />);
    type("AGIZA20");

    await act(async () => {
      applyButton().click();
      input()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(applyButton().textContent).toBe("Checking…");
    expect(applyButton().disabled).toBe(true);
    expect(input()!.disabled).toBe(true);
    // The mobile copy is the same box, so it can't fire a second request.
    expect(applyButton("mobile").disabled).toBe(true);
    await clickApply();
    expect(apply).toHaveBeenCalledTimes(1);

    await act(async () =>
      pending.resolve({ success: false, message: INVALID_MSG }),
    );
    expect(applyButton().textContent).toBe("Apply");
  });

  it("holds Place Order while a code is being checked", async () => {
    const pending = deferred<ApplyResult>();
    render(<Harness apply={() => pending.promise} />);
    type("AGIZA20");
    await clickApply();
    expect(placeOrderButtons().every((b) => b.disabled)).toBe(true);

    await act(async () =>
      pending.resolve({ success: false, message: INVALID_MSG }),
    );
    expect(placeOrderButtons().every((b) => !b.disabled)).toBe(true);
  });

  it("Enter applies the code and never submits the order form", async () => {
    const onSubmit = vi.fn();
    render(<Harness apply={acceptAgiza} onSubmit={onSubmit} />);
    type("AGIZA20");
    await pressEnter();

    expect(appliedBox()!.textContent).toContain("AGIZA20");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("the Apply button is not a submit button", async () => {
    const onSubmit = vi.fn();
    render(<Harness apply={reject(INVALID_MSG)} onSubmit={onSubmit} />);
    type("AGIZA20");
    expect(applyButton().type).toBe("button");
    await clickApply();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("Editorial checkout promo code — rejected code", () => {
  it("shows the exact invalid-code message and keeps the code editable", async () => {
    render(<Harness apply={reject(INVALID_MSG)} />);
    type("THISCODEDOESNOTEXIST999");
    await clickApply();

    expect(feedback()).toBe(INVALID_MSG);
    expect(input()!.value).toBe("THISCODEDOESNOTEXIST999");
    expect(input()!.disabled).toBe(false);
    expect(input()!.getAttribute("aria-invalid")).toBe("true");
    expect(appliedBox()).toBeNull();
    expect(text()).toContain("EGP 484.00");
  });

  it("shows the exact ineligible reason", async () => {
    render(<Harness apply={reject(INELIGIBLE_MSG)} />);
    type("AGIZA20");
    await clickApply();
    expect(feedback()).toBe(INELIGIBLE_MSG);
    expect(input()!.value).toBe("AGIZA20");
  });

  it("drops the stale message once the shopper edits the code", async () => {
    render(<Harness apply={reject(INVALID_MSG)} />);
    type("THISCODEDOESNOTEXIST999");
    await clickApply();
    type("AGIZA2");
    expect(feedback()).toBe("");
  });
});

describe("Editorial checkout promo code — remove and notices", () => {
  it("Remove takes the code off and brings the empty input back", async () => {
    render(
      <Harness
        apply={acceptAgiza}
        initialApplied={{ code: "AGIZA20", discountLabel: "20% off" }}
      />,
    );
    const remove = box().querySelector<HTMLButtonElement>(
      'button[aria-label="Remove promo code AGIZA20"]',
    )!;
    expect(remove.type).toBe("button");
    await act(async () => remove.click());

    expect(appliedBox()).toBeNull();
    expect(input()!.value).toBe("");
    expect(text()).not.toContain("Discount");
    expect(text()).toContain("EGP 484.00");
  });

  it("renders CartContext's notice and dismisses it on a new attempt", async () => {
    const notice = 'Your promo code "AGIZA20" was removed: it expired.';
    const dismiss = vi.fn();
    render(
      <Harness
        apply={reject(INVALID_MSG)}
        couponNotice={notice}
        onDismissCouponNotice={dismiss}
      />,
    );
    expect(feedback()).toContain(notice);
    type("SOMECODE");
    await clickApply();
    expect(dismiss).toHaveBeenCalled();
  });
});

describe("Editorial checkout promo code — no pricing logic in the template", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../CheckoutPageEditorialTemplate.tsx"),
    "utf8",
  );

  it("does not validate codes or compute discounts itself", () => {
    expect(source).not.toMatch(/trpc|validatePromoCode|promoCode\.validate/);
    expect(source).not.toMatch(/discountValue|discountType|\/\s*100/);
    expect(source).not.toMatch(/isn't a valid|doesn't apply to any/);
    expect(source).not.toMatch(/localStorage/);
  });

  it("renders the totals it is given rather than recomputing them", () => {
    render(
      <CheckoutPageEditorialTemplate
        items={[straps]}
        totals={{ subtotal: 399, discount: 1, shipping: 85, grandTotal: 123.45 }}
        appliedCoupon={{ code: "AGIZA20", discountLabel: "20% off" }}
        onApplyCoupon={async () => ({ success: true, message: "" })}
      />,
    );
    expect(text()).toContain("EGP 123.45");
    expect(appliedBox()!.textContent).toContain("You save EGP 1.00");
  });
});
