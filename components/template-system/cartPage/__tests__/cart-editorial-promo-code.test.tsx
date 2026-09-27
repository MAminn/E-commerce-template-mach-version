// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CartPageCartItem, CartPageTotals } from "../CartPageModernTemplate";
import {
  CartPageEditorialTemplate,
  type CartPageEditorialTemplateProps,
} from "../CartPageEditorialTemplate";

/**
 * The promo-code box on the Editorial cart — the cart template Mach runs in
 * production (`cartPage: "cart-editorial"`).
 *
 * The code itself is validated by CartContext + the server; these tests only
 * pin down what the template does with the result it gets back: show the
 * reason, show which code is on, keep a rejected code editable, and never
 * double-submit. Unlike the static-markup section tests this one clicks and
 * types, so it runs in happy-dom.
 */

// Page chrome and motion wrappers are irrelevant to the promo box.
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type ApplyResult = { success: boolean; message: string };
type AppliedCoupon = { code: string; discountLabel?: string } | null;

const VALID_MSG = '"AGIZA20" applied — 20% off.';
const INVALID_MSG =
  '"THISCODEDOESNOTEXIST999" isn\'t a valid promo code. Check the spelling and try again.';
const INELIGIBLE_MSG =
  "This promo code doesn't apply to any of the items in your cart.";

const straps: CartPageCartItem = {
  id: "straps",
  name: "Mach – Figure 8 Straps",
  price: 399,
  quantity: 1,
  stock: 10,
  available: true,
};

const baseTotals: CartPageTotals = {
  subtotal: 399,
  shipping: 85,
  grandTotal: 484,
};
const discountedTotals: CartPageTotals = {
  subtotal: 399,
  discount: 79.8,
  shipping: 85,
  grandTotal: 404.2,
};

/**
 * Stands in for pages/cart/+Page.tsx: owns the applied code the way
 * CartContext does and hands the template the same props.
 */
function Harness({
  apply,
  initialApplied = null,
  couponNotice = null,
  onDismissCouponNotice,
}: {
  apply: (
    code: string,
    setApplied: (c: AppliedCoupon) => void,
  ) => Promise<ApplyResult>;
  initialApplied?: AppliedCoupon;
  couponNotice?: string | null;
  onDismissCouponNotice?: () => void;
}) {
  const [applied, setApplied] = useState<AppliedCoupon>(initialApplied);
  const props: CartPageEditorialTemplateProps = {
    items: [straps],
    totals: applied ? discountedTotals : baseTotals,
    currency: "EGP",
    onApplyCoupon: (code) => apply(code, setApplied),
    appliedCoupon: applied,
    onRemoveCoupon: () => setApplied(null),
    couponNotice,
    onDismissCouponNotice,
  };
  return <CartPageEditorialTemplate {...props} />;
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

function render(ui: ReactNode) {
  act(() => root.render(ui));
}

const input = () =>
  container.querySelector<HTMLInputElement>('input[aria-label="Promo code"]')!;
const applyButton = () =>
  [...container.querySelectorAll("button")].find((b) =>
    /^(Apply|Checking…)$/.test(b.textContent ?? ""),
  )!;
const feedback = () =>
  container.querySelector("#promo-code-feedback")!.textContent ?? "";
const appliedBox = () =>
  container.querySelector('[data-testid="applied-promo-code"]');
const text = () => container.textContent ?? "";

function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickApply() {
  await act(async () => {
    applyButton().click();
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Mirrors CartContext: sets the applied code, then resolves. */
const acceptAgiza = vi.fn(
  async (code: string, setApplied: (c: AppliedCoupon) => void) => {
    setApplied({ code, discountLabel: "20% off" });
    return { success: true, message: VALID_MSG };
  },
);
const reject = (message: string) =>
  vi.fn(async () => ({ success: false, message }));

describe("Editorial cart promo code — valid code", () => {
  it("awaits the apply result before showing anything", async () => {
    const pending = deferred<ApplyResult>();
    const apply = vi.fn((code: string, setApplied: (c: AppliedCoupon) => void) =>
      pending.promise.then((r) => {
        setApplied({ code, discountLabel: "20% off" });
        return r;
      }),
    );
    render(<Harness apply={apply} />);
    type("AGIZA20");
    await clickApply();

    expect(apply).toHaveBeenCalledWith("AGIZA20", expect.any(Function));
    // Still waiting: no message yet, code still in the box.
    expect(feedback()).toBe("");
    expect(input().value).toBe("AGIZA20");

    await act(async () => pending.resolve({ success: true, message: VALID_MSG }));
    expect(feedback()).toContain(VALID_MSG);
  });

  it("shows the success message, the applied code and its discount label", async () => {
    render(<Harness apply={acceptAgiza} />);
    type("AGIZA20");
    await clickApply();

    expect(feedback()).toContain(VALID_MSG);
    const box = appliedBox();
    expect(box).not.toBeNull();
    expect(box!.textContent).toContain("AGIZA20");
    expect(box!.textContent).toContain("20% off");
    expect(box!.textContent).toContain("Remove");
  });

  it("keeps the discount line (named after the code) and the recalculated total", async () => {
    render(<Harness apply={acceptAgiza} />);
    type("AGIZA20");
    await clickApply();

    expect(text()).toContain("Discount (AGIZA20)");
    expect(text()).toContain("−EGP 79.80");
    expect(text()).toContain("EGP 404.20");
  });

  it("clears the input only once the applied code is on screen", async () => {
    render(<Harness apply={acceptAgiza} />);
    type("AGIZA20");
    await clickApply();

    expect(input().value).toBe("");
    expect(appliedBox()?.textContent).toContain("AGIZA20");
  });
});

describe("Editorial cart promo code — rejected code", () => {
  it("shows the exact invalid-code message and keeps the code for correction", async () => {
    render(<Harness apply={reject(INVALID_MSG)} />);
    type("THISCODEDOESNOTEXIST999");
    await clickApply();

    expect(feedback()).toBe(INVALID_MSG);
    expect(input().value).toBe("THISCODEDOESNOTEXIST999");
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(appliedBox()).toBeNull();
  });

  it("shows the exact ineligible-code reason rather than a generic error", async () => {
    render(<Harness apply={reject(INELIGIBLE_MSG)} />);
    type("AGIZA20");
    await clickApply();

    expect(feedback()).toBe(INELIGIBLE_MSG);
    expect(feedback()).not.toMatch(/invalid promo code/i);
    expect(input().value).toBe("AGIZA20");
  });

  it("does not take off an already-applied code when a second code fails", async () => {
    render(
      <Harness
        apply={reject(INVALID_MSG)}
        initialApplied={{ code: "AGIZA20", discountLabel: "20% off" }}
      />,
    );
    type("THISCODEDOESNOTEXIST999");
    await clickApply();

    expect(feedback()).toBe(INVALID_MSG);
    expect(appliedBox()?.textContent).toContain("AGIZA20");
    expect(text()).toContain("EGP 404.20");
  });

  it("drops a stale message as soon as the shopper edits the code", async () => {
    render(<Harness apply={reject(INVALID_MSG)} />);
    type("THISCODEDOESNOTEXIST999");
    await clickApply();
    expect(feedback()).toBe(INVALID_MSG);

    type("AGIZA2");
    expect(feedback()).toBe("");
  });

  it("replaces the previous message on a new attempt", async () => {
    const apply = vi
      .fn()
      .mockResolvedValueOnce({ success: false, message: INVALID_MSG })
      .mockImplementationOnce(acceptAgiza);
    render(<Harness apply={apply} />);
    type("THISCODEDOESNOTEXIST999");
    await clickApply();
    type("AGIZA20");
    await clickApply();

    expect(feedback()).toBe(VALID_MSG);
    expect(feedback()).not.toContain("isn't a valid");
  });
});

describe("Editorial cart promo code — remove, notice, loading", () => {
  it("Remove clears the applied code and the stale success message", async () => {
    render(<Harness apply={acceptAgiza} />);
    type("AGIZA20");
    await clickApply();
    expect(appliedBox()).not.toBeNull();

    const remove = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Remove",
    )!;
    await act(async () => remove.click());

    expect(appliedBox()).toBeNull();
    expect(feedback()).toBe("");
    expect(text()).not.toContain("Discount");
    expect(text()).toContain("EGP 484.00");
  });

  it("still renders CartContext's couponNotice, and dismisses it on a new attempt", async () => {
    const notice =
      '"AGIZA20" was removed because it no longer applies to your cart.';
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

  it("shows a loading state and ignores repeat submissions while applying", async () => {
    const pending = deferred<ApplyResult>();
    const apply = vi.fn(() => pending.promise);
    render(<Harness apply={apply} />);
    type("AGIZA20");

    // Click and Enter in the same tick, then click again after re-render.
    await act(async () => {
      applyButton().click();
      input().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(applyButton().textContent).toBe("Checking…");
    expect(applyButton().disabled).toBe(true);
    expect(input().disabled).toBe(true);
    await clickApply();

    expect(apply).toHaveBeenCalledTimes(1);

    await act(async () =>
      pending.resolve({ success: false, message: INVALID_MSG }),
    );
    expect(applyButton().textContent).toBe("Apply");
    expect(input().disabled).toBe(false);
  });

  it("keeps an applied code on screen while another code is being checked", async () => {
    const pending = deferred<ApplyResult>();
    render(
      <Harness
        apply={() => pending.promise}
        initialApplied={{ code: "AGIZA20", discountLabel: "20% off" }}
      />,
    );
    type("OTHERCODE");
    await clickApply();
    expect(appliedBox()?.textContent).toContain("AGIZA20");

    await act(async () =>
      pending.resolve({ success: false, message: INVALID_MSG }),
    );
  });
});

describe("Editorial cart promo code — no pricing logic in the template", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../CartPageEditorialTemplate.tsx"),
    "utf8",
  );

  it("does not validate codes or compute discounts itself", () => {
    expect(source).not.toMatch(/trpc|validatePromoCode|promoCode\.validate/);
    expect(source).not.toMatch(/discountValue|discountType|\/\s*100/);
    expect(source).not.toMatch(/isn't a valid|doesn't apply to any/);
  });

  it("renders the totals it is given rather than recomputing them", () => {
    render(
      <CartPageEditorialTemplate
        items={[straps]}
        totals={{ subtotal: 399, discount: 1, shipping: 85, grandTotal: 123.45 }}
        appliedCoupon={{ code: "AGIZA20", discountLabel: "20% off" }}
        onApplyCoupon={async () => ({ success: true, message: "" })}
      />,
    );
    expect(text()).toContain("EGP 123.45");
  });
});
