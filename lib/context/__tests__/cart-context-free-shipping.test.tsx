// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CartProvider, promoDiscountLabel, useCart } from "../CartContext";

/**
 * A Free Shipping code in the cart: shipping drops to 0, product prices and
 * the product discount stay untouched, and shipping comes back the moment
 * the code is removed or stops validating. The mocked validate endpoint
 * plays the server.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WHEY = "00000000-0000-4000-8000-000000000011";
const BELT = "00000000-0000-4000-8000-000000000012";
const SHIPPING_FEE = 85;

/** What the mocked server answers for each code. */
let codes: Record<string, "free_shipping" | "percentage" | "min_1000"> = {};

const validate = vi.fn(
  async (input: { code: string; cartItems: { id: string; quantity: number; price: number }[] }) => {
    const kind = codes[input.code];
    if (!kind) return { success: false, error: `"${input.code}" isn't a valid promo code.` };
    const subtotal = input.cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
    if (kind === "min_1000" && subtotal < 1000) {
      return { success: false, error: "This promo code needs a minimum order of 1000.00 EGP." };
    }
    const isFree = kind !== "percentage";
    return {
      success: true,
      result: {
        id: `promo-${input.code}`,
        code: input.code,
        discountType: isFree ? ("free_shipping" as const) : ("percentage" as const),
        discountValue: isFree ? 0 : 10,
        appliesToAllProducts: true,
        eligibleProductIds: input.cartItems.map((i) => i.id),
        discountAmount: isFree ? 0 : subtotal * 0.1,
        freeShipping: isFree,
        discountLabel: isFree ? "Free shipping" : "10% off",
      },
    };
  },
);

let offers: { freeShipping: boolean; discountAmount: number; name: string; reward: { type: string } }[] = [];

vi.mock("#root/shared/trpc/client", () => ({
  trpc: {
    promoCode: { validate: { query: (i: never) => validate(i) } },
    settings: { getShippingFee: { query: async () => ({ success: true, result: SHIPPING_FEE }) } },
    offer: { evaluate: { query: async () => ({ success: true, result: offers }) } },
    cartCapture: { sync: { mutate: async () => ({}) } },
  },
}));

vi.mock("#root/lib/cart-session", () => ({ getCartSessionToken: () => "test-session" }));

const product = (id: string, name: string, price: number) => ({ id, name, price, stock: 20 });

let cart!: ReturnType<typeof useCart>;
function Probe() {
  cart = useCart();
  return null;
}

let container: HTMLDivElement;
let root: Root;
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

beforeEach(async () => {
  localStorage.clear();
  codes = { FREESHIP: "free_shipping", TEN: "percentage", BIGFREE: "min_1000" };
  offers = [];
  validate.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    ),
  );
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function add(p: ReturnType<typeof product>, qty = 1) {
  act(() => {
    cart.addItem(p, qty, {});
  });
  await settle();
}

async function apply(code: string) {
  let result!: Awaited<ReturnType<typeof cart.applyPromoCode>>;
  await act(async () => {
    result = await cart.applyPromoCode(code);
  });
  await settle();
  return result;
}

describe("CartContext — Free Shipping promo code", () => {
  it("makes shipping 0 without touching product prices", async () => {
    await add(product(WHEY, "Whey", 500), 2);
    expect(cart.shipping).toBe(SHIPPING_FEE);
    expect(cart.total).toBe(1000 + SHIPPING_FEE);

    const result = await apply("FREESHIP");
    expect(result).toEqual({ success: true, message: '"FREESHIP" applied — Free shipping.' });
    expect(cart.promoCode?.discountType).toBe("free_shipping");
    expect(cart.subtotal).toBe(1000);
    expect(cart.discount).toBe(0);
    expect(cart.shipping).toBe(0);
    expect(cart.total).toBe(1000);
  });

  it("brings shipping back when the code is removed", async () => {
    await add(product(WHEY, "Whey", 500));
    await apply("FREESHIP");
    expect(cart.shipping).toBe(0);
    act(() => cart.removePromoCode());
    await settle();
    expect(cart.shipping).toBe(SHIPPING_FEE);
    expect(cart.total).toBe(500 + SHIPPING_FEE);
  });

  it("brings shipping back when a cart edit invalidates the code", async () => {
    await add(product(WHEY, "Whey", 500), 2);
    await apply("BIGFREE");
    expect(cart.shipping).toBe(0);

    act(() => {
      cart.updateQuantity(WHEY, 1, {});
    });
    await settle();
    expect(cart.promoCode).toBeNull();
    expect(cart.promoCodeNotice).toMatch(/minimum order of 1000.00 EGP/);
    expect(cart.shipping).toBe(SHIPPING_FEE);
  });

  it("is rejected like any other code when the server refuses it", async () => {
    await add(product(WHEY, "Whey", 500));
    const result = await apply("BIGFREE");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/minimum order/);
    expect(cart.shipping).toBe(SHIPPING_FEE);
  });

  it("a percentage code still discounts products and keeps shipping", async () => {
    await add(product(BELT, "Belt", 300));
    await apply("TEN");
    expect(cart.discount).toBeCloseTo(30, 2);
    expect(cart.shipping).toBe(SHIPPING_FEE);
    expect(cart.total).toBeCloseTo(300 - 30 + SHIPPING_FEE, 2);
  });

  it("stays 0 (never negative) alongside a free-shipping offer, and keeps offer savings", async () => {
    offers = [{ name: "Spend 400", freeShipping: true, discountAmount: 40, reward: { type: "free_shipping" } }];
    await add(product(WHEY, "Whey", 500));
    await apply("FREESHIP");
    expect(cart.shipping).toBe(0);
    expect(cart.offerDiscount).toBe(40);
    expect(cart.total).toBe(460);
  });
});

describe("promoDiscountLabel", () => {
  it("falls back to type-based wording when the server label is missing", () => {
    expect(promoDiscountLabel({ discountType: "free_shipping", discountValue: 0 })).toBe("Free shipping");
    expect(promoDiscountLabel({ discountType: "percentage", discountValue: 15 })).toBe("15% off");
    expect(promoDiscountLabel({ discountType: "fixed_amount", discountValue: 25 })).toBe("25.00 EGP off");
  });
});
