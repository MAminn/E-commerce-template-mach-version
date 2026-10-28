import { describe, expect, it } from "vitest";
import {
  applyOffersToCart,
  createOfferSchema,
  findGiftStockShortfalls,
  offerShapeError,
  snapshotAppliedOffers,
  updateOfferSchema,
  type CartItemInput,
} from "../service";
import type { CartOfferRow, OfferCondition, OfferReward } from "#root/shared/database/drizzle/schema";
import { computeLinePromoDiscount } from "#root/shared/pricing/cart-math";

/**
 * Same-product "Buy X Get Y Free" offers: free units are ADDED (never a
 * discount on units already in the cart), per line (product + variant), and
 * never earn further gifts.
 */

const WHEY = "11111111-1111-4111-8111-111111111111";
const CREATINE = "22222222-2222-4222-8222-222222222222";
const SHAKER = "33333333-3333-4333-8333-333333333333";
const PROTEIN_CATEGORY = "44444444-4444-4444-8444-444444444444";

let nextId = 1;
function makeOffer(overrides: Partial<CartOfferRow>): CartOfferRow {
  return {
    id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    name: "Test offer",
    description: null,
    isActive: true,
    priority: 0,
    isExclusive: false,
    condition: { type: "always" },
    reward: { type: "free_shipping" },
    startsAt: null,
    endsAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CartOfferRow;
}

const bogoReward = (getQuantity = 1): OfferReward => ({
  type: "free_gift",
  getQuantity,
  sameProduct: true,
  autoAdd: true,
});

function bogo(
  condition: Partial<Extract<OfferCondition, { type: "buy_x_get_y" }>> = {},
  overrides: Partial<CartOfferRow> = {},
  getQuantity = 1,
): CartOfferRow {
  return makeOffer({
    name: "Buy 1 Get 1 Whey",
    condition: {
      type: "buy_x_get_y",
      buyQuantity: 1,
      productIds: [WHEY],
      repeatsPerMultiple: true,
      ...condition,
    },
    reward: bogoReward(getQuantity),
    ...overrides,
  });
}

const line = (
  id: string,
  quantity: number,
  price: number,
  extra: Partial<CartItemInput> = {},
): CartItemInput => ({ id, name: id === WHEY ? "Whey Protein" : id, quantity, price, ...extra });

const subtotalOf = (items: CartItemInput[]) => items.reduce((s, i) => s + i.price * i.quantity, 0);
const apply = (offers: CartOfferRow[], items: CartItemInput[]) =>
  applyOffersToCart(offers, items, subtotalOf(items));
const gifts = (offers: CartOfferRow[], items: CartItemInput[]) =>
  apply(offers, items).flatMap((o) => o.gifts ?? []);

describe("Buy 1 Get 1 — adding, changing and removing paid units", () => {
  const offer = bogo();

  it("one paid unit gets one free unit of the same product, charged nothing", () => {
    const cart = [line(WHEY, 1, 2000)];
    const [applied] = apply([offer], cart);
    expect(applied?.discountAmount).toBe(0);
    expect(applied?.label).toBe("Buy 1 Get 1 Free");
    expect(applied?.gifts).toEqual([
      {
        offerId: offer.id,
        offerName: offer.name,
        productId: WHEY,
        selectedOptions: null,
        name: "Whey Protein",
        quantity: 1,
        unitValue: 2000,
      },
    ]);
    // The subtotal (what is charged) is the paid unit only.
    expect(subtotalOf(cart)).toBe(2000);
  });

  it("follows the paid quantity up and down, and disappears with the line", () => {
    expect(gifts([offer], [line(WHEY, 2, 2000)])[0]?.quantity).toBe(2);
    expect(gifts([offer], [line(WHEY, 3, 2000)])[0]?.quantity).toBe(3);
    expect(gifts([offer], [line(WHEY, 1, 2000)])[0]?.quantity).toBe(1);
    expect(apply([offer], [line(CREATINE, 1, 500)])).toEqual([]);
    expect(apply([offer], [])).toEqual([]);
  });

  it("is deterministic and idempotent for the same cart", () => {
    const cart = [line(CREATINE, 2, 500), line(WHEY, 2, 2000, { selectedOptions: "Flavor: Vanilla" })];
    expect(apply([offer], cart)).toEqual(apply([offer], cart));
    // Evaluating does not mutate the cart it was given.
    expect(cart.map((i) => i.quantity)).toEqual([2, 2]);
  });
});

describe("Repeat per multiple", () => {
  it("on: every full set of buyQuantity earns getQuantity", () => {
    const buy2get1 = bogo({ buyQuantity: 2 });
    expect(gifts([buy2get1], [line(WHEY, 1, 100)])).toEqual([]);
    expect(gifts([buy2get1], [line(WHEY, 2, 100)])[0]?.quantity).toBe(1);
    expect(gifts([buy2get1], [line(WHEY, 3, 100)])[0]?.quantity).toBe(1);
    expect(gifts([buy2get1], [line(WHEY, 4, 100)])[0]?.quantity).toBe(2);

    const buy1get2 = bogo({}, {}, 2);
    expect(gifts([buy1get2], [line(WHEY, 3, 100)])[0]?.quantity).toBe(6);
  });

  it("off: one gift set per order, on the first eligible line that qualifies", () => {
    const once = bogo({ repeatsPerMultiple: false, buyQuantity: 2 });
    const cart = [
      line(WHEY, 1, 2000, { selectedOptions: "Flavor: Chocolate" }), // below buyQuantity
      line(WHEY, 4, 2000, { selectedOptions: "Flavor: Vanilla" }),
      line(WHEY, 2, 2000, { selectedOptions: "Flavor: Strawberry" }),
    ];
    expect(gifts([once], cart)).toEqual([
      expect.objectContaining({ selectedOptions: "Flavor: Vanilla", quantity: 1 }),
    ]);
  });
});

describe("Product, category and variant eligibility", () => {
  it("each variant line earns its own gift of that exact variant", () => {
    const cart = [
      line(WHEY, 2, 2000, { selectedOptions: "Flavor: Chocolate" }),
      line(WHEY, 1, 2000, { selectedOptions: "Flavor: Vanilla" }),
    ];
    expect(gifts([bogo()], cart)).toEqual([
      expect.objectContaining({ selectedOptions: "Flavor: Chocolate", quantity: 2 }),
      expect.objectContaining({ selectedOptions: "Flavor: Vanilla", quantity: 1 }),
    ]);
  });

  it("counts per variant, never across variants (1 Chocolate + 1 Vanilla is not 'buy 2')", () => {
    const cart = [
      line(WHEY, 1, 2000, { selectedOptions: "Flavor: Chocolate" }),
      line(WHEY, 1, 2000, { selectedOptions: "Flavor: Vanilla" }),
    ];
    expect(gifts([bogo({ buyQuantity: 2 })], cart)).toEqual([]);
  });

  it("splitting one line into several never earns more gifts than the merged line", () => {
    const offer = bogo({ buyQuantity: 2 });
    const merged = gifts([offer], [line(WHEY, 3, 100)]).reduce((s, g) => s + g.quantity, 0);
    const split = gifts([offer], [line(WHEY, 1, 100), line(WHEY, 1, 100), line(WHEY, 1, 100)]).reduce(
      (s, g) => s + g.quantity,
      0,
    );
    expect(split).toBeLessThanOrEqual(merged);
  });

  it("ignores products it doesn't cover", () => {
    const cart = [line(CREATINE, 3, 500), line(WHEY, 1, 2000)];
    expect(gifts([bogo()], cart)).toEqual([expect.objectContaining({ productId: WHEY, quantity: 1 })]);
  });

  it("covers products by their category as well as by id", () => {
    const offer = bogo({ productIds: [], categoryIds: [PROTEIN_CATEGORY] });
    const cart = [
      line(CREATINE, 1, 500, { categoryIds: ["55555555-5555-4555-8555-555555555555"] }),
      line(WHEY, 1, 2000, { categoryIds: [PROTEIN_CATEGORY] }),
    ];
    expect(gifts([offer], cart)).toEqual([expect.objectContaining({ productId: WHEY })]);
  });

  it("gift value is the paid line's effective (already discounted) price", () => {
    expect(gifts([bogo()], [line(WHEY, 1, 1500)])[0]?.unitValue).toBe(1500);
  });
});

describe("Offer conflicts — priority, exclusivity, overlap", () => {
  it("two BOGO offers on the same product never both give a gift for one line", () => {
    const first = bogo({}, { name: "First" });
    const second = bogo({}, { name: "Second" }, 2);
    const result = gifts([first, second], [line(WHEY, 1, 2000)]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ offerName: "First", quantity: 1 });
  });

  it("an overlapping lower-priority BOGO still applies to lines the first didn't claim", () => {
    const wheyOnly = bogo({}, { name: "Whey" });
    const both = bogo({ productIds: [WHEY, CREATINE] }, { name: "Both" });
    const result = gifts([wheyOnly, both], [line(WHEY, 1, 2000), line(CREATINE, 1, 500)]);
    expect(result).toEqual([
      expect.objectContaining({ offerName: "Whey", productId: WHEY }),
      expect.objectContaining({ offerName: "Both", productId: CREATINE }),
    ]);
  });

  it("a BOGO that can't give a gift doesn't block the next offer for that line", () => {
    const buy2 = bogo({ buyQuantity: 2 }, { name: "Buy 2" });
    const buy1 = bogo({}, { name: "Buy 1" });
    expect(gifts([buy2, buy1], [line(WHEY, 1, 2000)])).toEqual([
      expect.objectContaining({ offerName: "Buy 1" }),
    ]);
  });

  it("an exclusive BOGO that applies stops lower-priority offers", () => {
    const exclusive = bogo({}, { isExclusive: true });
    const tenPercent = makeOffer({ reward: { type: "percentage_off", percentOff: 10 } });
    const applied = apply([exclusive, tenPercent], [line(WHEY, 1, 2000)]);
    expect(applied.map((o) => o.id)).toEqual([exclusive.id]);
  });

  it("an exclusive BOGO that doesn't apply leaves other offers alone", () => {
    const exclusive = bogo({}, { isExclusive: true });
    const tenPercent = makeOffer({ reward: { type: "percentage_off", percentOff: 10 } });
    const applied = apply([exclusive, tenPercent], [line(CREATINE, 1, 500)]);
    expect(applied.map((o) => o.id)).toEqual([tenPercent.id]);
  });

  it("a higher-priority exclusive offer stops a BOGO", () => {
    const exclusive = makeOffer({ isExclusive: true, reward: { type: "free_shipping" } });
    expect(gifts([exclusive, bogo()], [line(WHEY, 1, 2000)])).toEqual([]);
  });

  it("stacks with a non-exclusive % offer, which applies to the paid units only", () => {
    const tenPercent = makeOffer({ reward: { type: "percentage_off", percentOff: 10 } });
    const applied = apply([bogo(), tenPercent], [line(WHEY, 1, 2000)]);
    expect(applied).toHaveLength(2);
    expect(applied.reduce((s, o) => s + o.discountAmount, 0)).toBe(200);
  });

  it("free units never count toward another offer's quantity threshold", () => {
    const buy2FreeShipping = makeOffer({
      condition: { type: "quantity_threshold", minQuantity: 2 },
      reward: { type: "free_shipping" },
    });
    const applied = apply([bogo(), buy2FreeShipping], [line(WHEY, 1, 2000)]);
    expect(applied.some((o) => o.freeShipping)).toBe(false);
  });

  it("a half-configured BOGO (condition without its reward, or vice versa) never applies", () => {
    const conditionOnly = makeOffer({
      condition: { type: "buy_x_get_y", buyQuantity: 1, productIds: [WHEY] },
      reward: { type: "percentage_off", percentOff: 50 },
    });
    const rewardOnly = makeOffer({ condition: { type: "always" }, reward: bogoReward() });
    expect(apply([conditionOnly, rewardOnly], [line(WHEY, 1, 2000)])).toEqual([]);
  });
});

describe("Promo codes on a BOGO cart", () => {
  it("a promo applies to the paid amount — free units are not discounted again", () => {
    const cart = [line(WHEY, 1, 2000), line(SHAKER, 1, 100)];
    const applied = apply([bogo()], cart);
    const promo = computeLinePromoDiscount(
      "percentage",
      10,
      cart.map((l) => ({ price: l.price, quantity: l.quantity, eligible: true })),
      applied,
    );
    expect(promo.discount).toBeCloseTo(210); // 10% of 2100, not of 4100
  });

  it("a restricted promo is unaffected by gifts on other lines", () => {
    const cart = [line(WHEY, 1, 2000), line(SHAKER, 1, 100)];
    const promo = computeLinePromoDiscount(
      "fixed_amount",
      50,
      cart.map((l) => ({ price: l.price, quantity: l.quantity, eligible: l.id === SHAKER })),
      apply([bogo()], cart),
    );
    expect(promo).toEqual({ eligibleSubtotal: 100, discount: 50 });
  });
});

describe("findGiftStockShortfalls — paid and free units share the product's stock", () => {
  const gift = (productId: string, quantity: number) => ({ productId, quantity });

  it("is empty when stock covers paid + free", () => {
    const result = findGiftStockShortfalls([line(WHEY, 1, 1)], [gift(WHEY, 1)], new Map([[WHEY, 2]]));
    expect(result.size).toBe(0);
  });

  it("flags a product whose stock covers the paid units but not the gift", () => {
    const result = findGiftStockShortfalls([line(WHEY, 1, 1)], [gift(WHEY, 1)], new Map([[WHEY, 1]]));
    expect(result.get(WHEY)).toEqual({ available: 1, required: 2 });
  });

  it("adds every variant line of the product together", () => {
    const result = findGiftStockShortfalls(
      [
        line(WHEY, 2, 1, { selectedOptions: "Flavor: Chocolate" }),
        line(WHEY, 1, 1, { selectedOptions: "Flavor: Vanilla" }),
      ],
      [gift(WHEY, 2), gift(WHEY, 1)],
      new Map([[WHEY, 5]]),
    );
    expect(result.get(WHEY)).toEqual({ available: 5, required: 6 });
  });

  it("ignores products that have no gift (their paid stock is checked elsewhere)", () => {
    const result = findGiftStockShortfalls([line(CREATINE, 9, 1)], [], new Map([[CREATINE, 1]]));
    expect(result.size).toBe(0);
  });
});

describe("Offer configuration rules", () => {
  const base = { name: "BOGO Whey", priority: 0 };
  const condition: OfferCondition = {
    type: "buy_x_get_y",
    buyQuantity: 1,
    productIds: [WHEY],
    repeatsPerMultiple: true,
  };

  it("accepts a complete Buy X Get Y offer", () => {
    const parsed = createOfferSchema.safeParse({ ...base, condition, reward: bogoReward() });
    expect(parsed.success).toBe(true);
  });

  it("refuses a Buy X Get Y condition without the Free Gift reward, and the reverse", () => {
    expect(
      createOfferSchema.safeParse({ ...base, condition, reward: { type: "percentage_off", percentOff: 10 } })
        .success,
    ).toBe(false);
    expect(createOfferSchema.safeParse({ ...base, condition: { type: "always" }, reward: bogoReward() }).success).toBe(
      false,
    );
  });

  it("refuses a BOGO that covers nothing", () => {
    expect(offerShapeError({ ...condition, productIds: [] }, bogoReward())).toMatch(/at least one/);
    expect(offerShapeError({ ...condition, productIds: [], categoryIds: [PROTEIN_CATEGORY] }, bogoReward())).toBeNull();
  });

  it("refuses zero, fractional and non-same-product quantities", () => {
    for (const bad of [
      { ...condition, buyQuantity: 0 },
      { ...condition, buyQuantity: 1.5 },
    ]) {
      expect(createOfferSchema.safeParse({ ...base, condition: bad, reward: bogoReward() }).success).toBe(false);
    }
    expect(
      createOfferSchema.safeParse({ ...base, condition, reward: { ...bogoReward(), getQuantity: 0 } }).success,
    ).toBe(false);
    expect(
      createOfferSchema.safeParse({ ...base, condition, reward: { ...bogoReward(), sameProduct: false } }).success,
    ).toBe(false);
  });

  it("still accepts every existing offer type unchanged", () => {
    const existing: Array<[OfferCondition, OfferReward]> = [
      [{ type: "always" }, { type: "free_shipping" }],
      [{ type: "quantity_threshold", minQuantity: 3, repeatsPerMultiple: true }, { type: "free_items", quantity: 1, which: "cheapest" }],
      [{ type: "cart_total", minTotal: 1500 }, { type: "fixed_off", amountOff: 100 }],
      [{ type: "product_bundle", requiredProductIds: [WHEY, CREATINE] }, { type: "percentage_off", percentOff: 15 }],
    ];
    for (const [c, r] of existing) {
      expect(createOfferSchema.safeParse({ ...base, condition: c, reward: r }).success).toBe(true);
    }
  });

  it("a partial update (e.g. only toggling Active) still parses", () => {
    expect(updateOfferSchema.safeParse({ id: WHEY, isActive: false }).success).toBe(true);
  });
});

describe("snapshotAppliedOffers — what the order keeps", () => {
  it("records condition, reward and gifts, without preview-only stock flags", () => {
    const offer = bogo();
    const applied = apply([offer], [line(WHEY, 1, 2000)]).map((o) => ({
      ...o,
      gifts: o.gifts?.map((g) => ({ ...g, insufficientStock: { available: 0, required: 2 } })),
    }));
    const [snap] = snapshotAppliedOffers(applied, [offer]);
    expect(snap).toEqual({
      id: offer.id,
      name: offer.name,
      condition: offer.condition,
      reward: offer.reward,
      discountAmount: 0,
      freeShipping: false,
      gifts: [expect.objectContaining({ productId: WHEY, quantity: 1, unitValue: 2000 })],
    });
    expect(snap?.gifts?.[0]).not.toHaveProperty("insufficientStock");
  });
});
