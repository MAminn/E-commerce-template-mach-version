// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromoCodeForm } from "../components/PromoCodeForm";
import { formatPromoDiscountCell } from "../components/format";

/**
 * The Create / Edit Promo Code dialog with Free Shipping as a standard type:
 * - Percentage, Fixed Amount and Free Shipping are all offered (default
 *   Percentage, as before);
 * - choosing Free Shipping hides the value field and submits no value;
 * - percentage codes still need a value.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const create = vi.fn(async (_input: unknown) => ({ success: true, result: { id: "new" } }));
const update = vi.fn(async (_input: unknown) => ({ success: true, result: { id: "p1" } }));
const getById = vi.fn(async (_input: unknown) => ({
  success: true,
  result: {
    id: "p1",
    code: "SHIPFREE",
    description: "",
    discountType: "free_shipping",
    discountValue: 0,
    status: "active",
    startDate: null,
    endDate: null,
    usageLimit: 100,
    usageLimitPerUser: null,
    minPurchaseAmount: 300,
    appliesToAllProducts: true,
    applicableProductIds: [],
    applicableCategoryIds: [],
    showOnOffersPage: false,
  },
}));

vi.mock("#root/shared/trpc/client", () => ({
  trpc: {
    promoCode: {
      create: { mutate: (i: unknown) => create(i) },
      update: { mutate: (i: unknown) => update(i) },
      getById: { query: (i: unknown) => getById(i) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  create.mockClear();
  update.mockClear();
  getById.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });

async function renderForm(props: Partial<Parameters<typeof PromoCodeForm>[0]> = {}) {
  const onSuccess = vi.fn();
  await act(async () =>
    root.render(
      <PromoCodeForm
        isOpen
        onClose={() => {}}
        promoCodeId={null}
        onSuccess={onSuccess}
        products={[]}
        categories={[]}
        {...props}
      />,
    ),
  );
  await settle();
  return { onSuccess };
}

// Radix renders the dialog in a portal on document.body.
const dialog = () => document.body;
const valueInput = () =>
  dialog().querySelector<HTMLInputElement>(
    'input[type="number"][placeholder="10"], input[type="number"][placeholder="25.00"]',
  );
const codeInput = () => dialog().querySelector<HTMLInputElement>('input[placeholder="e.g. SUMMER2023"]')!;
const typeTrigger = () =>
  [...dialog().querySelectorAll("label")].find((l) => l.textContent === "Discount Type")!
    .parentElement!.querySelector("button")!;

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// Dispatched on the form itself: happy-dom's native constraint check
// misreads step="0.01" (10 / 0.01 is not an exact float) and would block a
// button click that a real browser lets through.
async function submit() {
  const form = dialog().querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

/** Radix Select's hidden native <select> (kept for forms/autofill) drives it. */
async function chooseType(value: string) {
  const native = typeTrigger().parentElement!.querySelector("select")!;
  await act(async () => {
    native.value = value;
    native.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

describe("PromoCodeForm — Free Shipping type", () => {
  it("offers all three types", async () => {
    await renderForm();
    const native = typeTrigger().parentElement!.querySelector("select")!;
    expect([...native.options].map((o) => o.value).filter(Boolean)).toEqual([
      "percentage",
      "fixed_amount",
      "free_shipping",
    ]);
  });

  it("choosing Free Shipping hides the value field", async () => {
    await renderForm();
    expect(valueInput()).not.toBeNull();
    await chooseType("free_shipping");
    expect(typeTrigger().textContent).toContain("Free Shipping");
    expect(valueInput()).toBeNull();
    expect(dialog().querySelector('[data-testid="free-shipping-note"]')?.textContent).toMatch(
      /pays no shipping/,
    );
  });

  it("creates a Free Shipping code without a discount value", async () => {
    const { onSuccess } = await renderForm();
    await chooseType("free_shipping");
    type(codeInput(), "SHIPFREE");
    await submit();
    expect(create).toHaveBeenCalledTimes(1);
    const sent = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.code).toBe("SHIPFREE");
    expect(sent.discountType).toBe("free_shipping");
    expect(sent.discountValue).toBeUndefined();
    expect(onSuccess).toHaveBeenCalled();
  });

  it("edits an existing Free Shipping code and can deactivate it", async () => {
    await renderForm({ promoCodeId: "p1" });
    expect(getById).toHaveBeenCalledWith({ id: "p1" });
    expect(codeInput().value).toBe("SHIPFREE");
    expect(valueInput()).toBeNull();
    await submit();
    expect(update).toHaveBeenCalledTimes(1);
    const sent = update.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      id: "p1",
      discountType: "free_shipping",
      usageLimit: 100,
      minPurchaseAmount: 300,
      status: "active",
    });
    expect(sent.discountValue).toBeUndefined();
  });
});

describe("PromoCodeForm — existing types (unchanged)", () => {
  it("defaults to a percentage code with a value field", async () => {
    await renderForm();
    expect(typeTrigger().textContent).toContain("Percentage");
    expect(valueInput()).not.toBeNull();
  });

  it("won't submit a percentage code without a value", async () => {
    await renderForm();
    type(codeInput(), "TENOFF");
    await submit();
    expect(create).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("Enter a discount value greater than 0");
  });

  it("submits a percentage code with its value", async () => {
    await renderForm();
    type(codeInput(), "TENOFF");
    type(valueInput()!, "10");
    await submit();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({
      code: "TENOFF",
      discountType: "percentage",
      discountValue: 10,
    });
  });
});

describe("promo list Discount column", () => {
  it("labels each type", () => {
    expect(formatPromoDiscountCell({ discountType: "free_shipping", discountValue: 0 })).toBe("Free shipping");
    expect(formatPromoDiscountCell({ discountType: "percentage", discountValue: 10 })).toBe("10%");
    expect(formatPromoDiscountCell({ discountType: "fixed_amount", discountValue: 50 })).toBe("50 (fixed)");
  });
});
