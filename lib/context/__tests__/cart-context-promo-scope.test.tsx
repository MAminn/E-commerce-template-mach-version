// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CartProvider, useCart } from "../CartContext";

/**
 * The cart's promo discount for a code restricted to some products.
 *
 * Eligibility is the server's call: the mocked validate endpoint below plays
 * the server, answering with which cart products the code covers. These
 * tests pin that the cart discounts only those lines, recalculates on
 * quantity changes, and picks up an eligible product added after the code.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const STRAPS = "00000000-0000-4000-8000-000000000001";
const WRAP = "00000000-0000-4000-8000-000000000002";
const CREATINE = "00000000-0000-4000-8000-000000000003";

// Server-side truth for the mock: AGIZA20 covers the Gym Gear products.
let restrictedTo: Set<string> | null = new Set([STRAPS, WRAP]);

const validate = vi.fn(
  async (input: { code: string; cartItems: { id: string }[] }) => {
    const ids = input.cartItems.map((i) => i.id);
    const eligible = restrictedTo ? ids.filter((id) => restrictedTo!.has(id)) : ids;
    if (eligible.length === 0) {
      return {
        success: false,
        error: "This promo code doesn't apply to any of the items in your cart.",
      };
    }
    return {
      success: true,
      result: {
        id: "promo-1",
        code: input.code,
        discountType: "percentage" as const,
        discountValue: 20,
        appliesToAllProducts: restrictedTo === null,
        eligibleProductIds: eligible,
        discountLabel: "20% off",
      },
    };
  },
);

vi.mock("#root/shared/trpc/client", () => ({
  trpc: {
    promoCode: { validate: { query: (i: never) => validate(i) } },
    settings: {
      getShippingFee: { query: async () => ({ success: true, result: 85 }) },
    },
    offer: { evaluate: { query: async () => ({ success: true, result: [] }) } },
    cartCapture: { sync: { mutate: async () => ({}) } },
  },
}));

vi.mock("#root/lib/cart-session", () => ({
  getCartSessionToken: () => "test-session",
}));

const product = (id: string, name: string, price: number) => ({
  id,
  name,
  price,
  stock: 20,
});

let cart!: ReturnType<typeof useCart>;
function Probe() {
  cart = useCart();
  return null;
}

let container: HTMLDivElement;
let root: Root;

/** Let pending mocked requests resolve and their state updates land. */
const settle = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
});

beforeEach(async () => {
  localStorage.clear();
  restrictedTo = new Set([STRAPS, WRAP]);
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

describe("CartContext — restricted promo discount scope", () => {
  it("discounts only the eligible line in a mixed cart", async () => {
    await add(product(STRAPS, "Mach – Figure 8 Straps", 399));
    await add(product(CREATINE, "Mach Creatine", 600));

    let result!: { success: boolean };
    await act(async () => {
      result = await cart.applyPromoCode("AGIZA20");
    });
    await settle();

    expect(result.success).toBe(true);
    expect(cart.subtotal).toBe(999);
    expect(cart.discount).toBeCloseTo(79.8);
    expect(cart.discount).not.toBeCloseTo(199.8);
    expect(cart.total).toBeCloseTo(999 - 79.8 + 85);
  });

  it("recalculates on quantity changes, and only eligible quantity counts", async () => {
    await add(product(STRAPS, "Mach – Figure 8 Straps", 399));
    await add(product(CREATINE, "Mach Creatine", 600));
    await act(async () => {
      await cart.applyPromoCode("AGIZA20");
    });
    await settle();

    act(() => {
      cart.updateQuantity(STRAPS, 2, {});
    });
    await settle();
    expect(cart.discount).toBeCloseTo(159.6);

    act(() => {
      cart.updateQuantity(CREATINE, 3, {});
    });
    await settle();
    expect(cart.discount).toBeCloseTo(159.6);
    expect(cart.total).toBeCloseTo(798 + 1800 - 159.6 + 85);
  });

  it("picks up an eligible product added after the code was applied", async () => {
    await add(product(STRAPS, "Mach – Figure 8 Straps", 399));
    await add(product(CREATINE, "Mach Creatine", 600));
    await act(async () => {
      await cart.applyPromoCode("AGIZA20");
    });
    await settle();

    await add(product(WRAP, "Mach – Wrist Wrap", 399));
    expect(cart.promoCode?.eligibleProductIds?.sort()).toEqual([STRAPS, WRAP].sort());
    expect(cart.discount).toBeCloseTo(159.6);
  });

  it("rejects the code when no cart item is eligible", async () => {
    await add(product(CREATINE, "Mach Creatine", 600));
    let result!: { success: boolean; message: string };
    await act(async () => {
      result = await cart.applyPromoCode("AGIZA20");
    });
    expect(result.success).toBe(false);
    expect(result.message).toBe(
      "This promo code doesn't apply to any of the items in your cart.",
    );
    expect(cart.promoCode).toBeNull();
    expect(cart.discount).toBe(0);
  });

  it("still discounts the whole cart for a code that applies to all products", async () => {
    restrictedTo = null;
    await add(product(STRAPS, "Mach – Figure 8 Straps", 399));
    await add(product(CREATINE, "Mach Creatine", 600));
    await act(async () => {
      await cart.applyPromoCode("ALL20");
    });
    await settle();
    expect(cart.discount).toBeCloseTo(199.8);

    // A new product counts straight away, no re-validation needed.
    await add(product(WRAP, "Mach – Wrist Wrap", 399));
    expect(cart.discount).toBeCloseTo(279.6);
  });

  it("re-validation that finds the same eligible set doesn't loop", async () => {
    await add(product(STRAPS, "Mach – Figure 8 Straps", 399));
    await act(async () => {
      await cart.applyPromoCode("AGIZA20");
    });
    await settle();
    await settle();
    const calls = validate.mock.calls.length;
    await settle();
    await settle();
    expect(validate.mock.calls.length).toBe(calls);
  });
});
