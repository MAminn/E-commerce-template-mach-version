import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { eq, inArray } from "drizzle-orm";

/**
 * Restricted promo codes discount only their eligible cart lines — checked
 * end to end against a real database: the cart's validation call, the order
 * that gets stored, and the amount a payment gateway would be asked for.
 *
 * Runs only with TEST_DATABASE_URL. Creates its own categories, products,
 * promo codes and orders, and removes exactly those afterwards. Email is
 * stubbed and courier dispatch is switched off, so nothing leaves the test.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

describeIfDb("promo pricing scope (integration)", () => {
  let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
  let schema: typeof import("#root/shared/database/drizzle/schema");
  let dbModule: typeof import("#root/shared/database/drizzle/db");
  let validation: typeof import("#root/backend/promo-codes/validate-promo-code/validate-promo-code");
  let orders: typeof import("#root/backend/orders/create-order/service");
  let fawaterak: typeof import("#root/backend/payments/fawaterak-service");
  let emailModule: typeof import("#root/shared/email/service");
  let getShippingFeeRaw: typeof import("#root/backend/settings/get-shipping-fee").getShippingFeeRaw;
  let v7: () => string;

  const ids = {
    file: "",
    vendor: "",
    gymGear: "",
    supplements: "",
    promos: [] as string[],
    products: [] as string[],
    orders: [] as string[],
    offers: [] as string[],
  };
  // Products (prices in EGP)
  const p = { straps: "", wrap: "", creatine: "", shaker: "", scoop: "" };
  // Promo codes
  const code = { cat: "", prod: "", both: "", fixedBig: "", allPct: "", allFixed: "" };
  let shippingFee = 0;

  const run = <A, E>(effect: Effect.Effect<A, E, never>) =>
    Effect.runPromise(effect);

  const provideDb = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provideService(dbModule.DatabaseClientService, db as never));

  async function validate(promoCode: string, lines: [string, number][]) {
    const cartItems = lines.map(([id, quantity]) => ({ id, quantity, price: 0 }));
    return run(
      provideDb(
        validation.validatePromoCode({
          code: promoCode,
          cartItems,
          subtotal: 1_000_000, // min-purchase input only; pricing ignores it
        }),
      ).pipe(Effect.either),
    );
  }

  async function placeOrder(promoCodeId: string, lines: [string, number][]) {
    const result = await run(
      provideDb(
        orders
          .createOrder({
            customerName: "Promo Scope Test",
            customerEmail: "promo-scope-test@example.invalid",
            customerPhone: "01000000000",
            shippingAddress: "1 Test St",
            shippingCity: "Cairo",
            shippingState: "Cairo",
            shippingPostalCode: "11511",
            shippingCountry: "Egypt",
            items: lines.map(([productId, quantity]) => ({ productId, quantity })),
            promoCodeId,
            paymentMethod: "cod",
          })
          .pipe(
            Effect.provideService(
              emailModule.EmailService,
              emailModule.createDummyEmailService({ warn: () => {} }),
            ),
          ),
      ).pipe(Effect.either),
    );
    if (result._tag === "Right") ids.orders.push(result.right.id);
    return result;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    delete process.env.SYN_BOSTA_KEY;
    delete process.env.FINCART_ENABLED;

    const { drizzle } = await import("drizzle-orm/node-postgres");
    schema = await import("#root/shared/database/drizzle/schema");
    dbModule = await import("#root/shared/database/drizzle/db");
    db = drizzle(TEST_DB_URL!, { schema });
    validation = await import("#root/backend/promo-codes/validate-promo-code/validate-promo-code");
    orders = await import("#root/backend/orders/create-order/service");
    fawaterak = await import("#root/backend/payments/fawaterak-service");
    emailModule = await import("#root/shared/email/service");
    ({ getShippingFeeRaw } = await import("#root/backend/settings/get-shipping-fee"));
    ({ v7 } = await import("uuid"));

    // Offers already in the database would change every expected number.
    const liveOffers = await db
      .select({ id: schema.cartOffer.id })
      .from(schema.cartOffer)
      .where(eq(schema.cartOffer.isActive, true));
    if (liveOffers.length > 0) {
      throw new Error("Test database has active cart offers; use a clean database");
    }

    ids.file = v7();
    await db.insert(schema.file).values({ id: ids.file, diskname: "promo-scope.jpg" });
    ids.vendor = v7();
    await db.insert(schema.vendor).values({ id: ids.vendor, name: "Promo Scope Vendor" });
    ids.gymGear = v7();
    ids.supplements = v7();
    await db.insert(schema.category).values([
      { id: ids.gymGear, name: "PS Gym Gear", slug: `ps-gym-gear-${ids.gymGear}` },
      { id: ids.supplements, name: "PS Supplements", slug: `ps-supplements-${ids.supplements}` },
    ]);

    const mk = (name: string, price: string, categoryId: string, discountPrice?: string) => {
      const id = v7();
      ids.products.push(id);
      return {
        id,
        name,
        slug: `ps-${id}`,
        description: "d",
        price,
        discountPrice: discountPrice ?? null,
        imageId: ids.file,
        categoryId,
        vendorId: ids.vendor,
        stock: 100,
      };
    };
    const straps = mk("PS Figure 8 Straps", "399.00", ids.gymGear);
    const wrap = mk("PS Knee Wrap", "450.00", ids.gymGear, "400.00"); // effective price 400
    const creatine = mk("PS Creatine", "600.00", ids.supplements);
    const shaker = mk("PS Shaker", "150.00", ids.supplements);
    const scoop = mk("PS Scoop", "50.00", ids.gymGear);
    Object.assign(p, {
      straps: straps.id,
      wrap: wrap.id,
      creatine: creatine.id,
      shaker: shaker.id,
      scoop: scoop.id,
    });
    await db.insert(schema.product).values([straps, wrap, creatine, shaker, scoop]);

    const mkPromo = async (
      codeText: string,
      type: "percentage" | "fixed_amount",
      value: string,
      links: { categories?: string[]; products?: string[] } | null,
    ) => {
      const id = v7();
      ids.promos.push(id);
      await db.insert(schema.promoCode).values({
        id,
        code: codeText,
        discountType: type,
        discountValue: value,
        status: "active",
        appliesToAllProducts: links === null,
      });
      if (links?.categories?.length) {
        await db.insert(schema.promoCodeCategories).values(
          links.categories.map((categoryId) => ({ id: v7(), promoCodeId: id, categoryId })),
        );
      }
      if (links?.products?.length) {
        await db.insert(schema.promoCodeProducts).values(
          links.products.map((productId) => ({ id: v7(), promoCodeId: id, productId })),
        );
      }
      return id;
    };
    const tag = Date.now().toString(36).toUpperCase();
    code.cat = await mkPromo(`PSCAT${tag}`, "percentage", "20", { categories: [ids.gymGear] });
    code.prod = await mkPromo(`PSPROD${tag}`, "percentage", "20", { products: [p.shaker] });
    code.both = await mkPromo(`PSBOTH${tag}`, "percentage", "10", {
      categories: [ids.gymGear],
      products: [p.straps],
    });
    code.fixedBig = await mkPromo(`PSFIX${tag}`, "fixed_amount", "1000", { categories: [ids.gymGear] });
    code.allPct = await mkPromo(`PSALL${tag}`, "percentage", "20", null);
    code.allFixed = await mkPromo(`PSALLF${tag}`, "fixed_amount", "100", null);

    shippingFee = await getShippingFeeRaw(db as never);
  });

  afterAll(async () => {
    if (!db) return;
    if (ids.orders.length) {
      await db.delete(schema.orderItem).where(inArray(schema.orderItem.orderId, ids.orders));
      await db.delete(schema.order).where(inArray(schema.order.id, ids.orders));
    }
    if (ids.offers.length) {
      await db.delete(schema.cartOffer).where(inArray(schema.cartOffer.id, ids.offers));
    }
    if (ids.promos.length) {
      await db.delete(schema.promoCode).where(inArray(schema.promoCode.id, ids.promos));
    }
    if (ids.products.length) {
      await db.delete(schema.product).where(inArray(schema.product.id, ids.products));
    }
    await db
      .delete(schema.category)
      .where(inArray(schema.category.id, [ids.gymGear, ids.supplements]));
    await db.delete(schema.vendor).where(eq(schema.vendor.id, ids.vendor));
    await db.delete(schema.file).where(eq(schema.file.id, ids.file));
  });

  const codeOf = async (id: string) =>
    (await db.select().from(schema.promoCode).where(eq(schema.promoCode.id, id)))[0]!.code;

  /** Validate, then place the order, and check both agree with `expected`. */
  async function expectDiscount(
    promoId: string,
    lines: [string, number][],
    expected: { eligibleSubtotal: number; discount: number; subtotal: number },
  ) {
    const v = await validate(await codeOf(promoId), lines);
    if (v._tag === "Left") throw new Error(`validation failed: ${JSON.stringify(v.left)}`);
    expect(v.right.eligibleSubtotal).toBeCloseTo(expected.eligibleSubtotal, 2);
    expect(v.right.discountAmount).toBeCloseTo(expected.discount, 2);

    const o = await placeOrder(promoId, lines);
    if (o._tag === "Left") throw new Error(`order failed: ${JSON.stringify(o.left)}`);
    const [stored] = await db.select().from(schema.order).where(eq(schema.order.id, o.right.id));
    const expectedTotal = expected.subtotal - expected.discount + shippingFee;

    expect(Number(stored!.subtotal)).toBeCloseTo(expected.subtotal, 2);
    expect(Number(stored!.discount ?? 0)).toBeCloseTo(expected.discount, 2);
    expect(Number(stored!.total)).toBeCloseTo(expectedTotal, 2);
    // What validation showed the shopper is what the order charged.
    expect(Number(stored!.discount ?? 0)).toBeCloseTo(v.right.discountAmount, 2);
    return stored!;
  }

  describe("restricted by category", () => {
    it("eligible item only", async () => {
      await expectDiscount(code.cat, [[p.straps, 1]], {
        eligibleSubtotal: 399, discount: 79.8, subtotal: 399,
      });
    });

    it("ineligible item only: rejected by validation and at order time", async () => {
      const v = await validate(await codeOf(code.cat), [[p.creatine, 1]]);
      expect(v._tag).toBe("Left");
      expect(JSON.stringify(v)).toContain("doesn't apply to any of the items");
      const o = await placeOrder(code.cat, [[p.creatine, 1]]);
      expect(o._tag).toBe("Left");
      expect(JSON.stringify(o)).toContain("doesn't apply to any of the items");
    });

    it("mixed cart: only the eligible subtotal is discounted", async () => {
      // Straps 399 + Knee Wrap 400 (discount price) eligible; Creatine 600 not.
      await expectDiscount(code.cat, [[p.straps, 1], [p.wrap, 1], [p.creatine, 1]], {
        eligibleSubtotal: 799, discount: 159.8, subtotal: 1399,
      });
    });

    it("quantity changes recalculate the eligible subtotal", async () => {
      await expectDiscount(code.cat, [[p.straps, 3], [p.creatine, 2]], {
        eligibleSubtotal: 1197, discount: 239.4, subtotal: 2397,
      });
    });
  });

  describe("restricted by explicit product", () => {
    it("eligible item only", async () => {
      await expectDiscount(code.prod, [[p.shaker, 2]], {
        eligibleSubtotal: 300, discount: 60, subtotal: 300,
      });
    });

    it("ineligible item only: rejected", async () => {
      const v = await validate(await codeOf(code.prod), [[p.creatine, 1]]);
      expect(v._tag).toBe("Left");
    });

    it("mixed cart: only the linked product is discounted, not its category-mates", async () => {
      // Shaker is linked; Creatine shares its category but is not.
      await expectDiscount(code.prod, [[p.shaker, 1], [p.creatine, 1], [p.straps, 1]], {
        eligibleSubtotal: 150, discount: 30, subtotal: 1149,
      });
    });
  });

  it("a product matching both a linked product and a linked category counts once", async () => {
    // Straps is linked directly AND via Gym Gear. 10% of (399 + 50), not 10% of (399*2 + 50).
    await expectDiscount(code.both, [[p.straps, 1], [p.scoop, 1], [p.creatine, 1]], {
      eligibleSubtotal: 449, discount: 44.9, subtotal: 1049,
    });
  });

  it("a fixed discount larger than the eligible subtotal is capped at it", async () => {
    await expectDiscount(code.fixedBig, [[p.scoop, 1], [p.creatine, 1]], {
      eligibleSubtotal: 50, discount: 50, subtotal: 650,
    });
  });

  describe("codes that apply to all products (unchanged)", () => {
    it("percentage discounts the whole cart", async () => {
      await expectDiscount(code.allPct, [[p.straps, 1], [p.creatine, 1]], {
        eligibleSubtotal: 999, discount: 199.8, subtotal: 999,
      });
    });

    it("fixed amount discounts the whole cart", async () => {
      await expectDiscount(code.allFixed, [[p.straps, 1], [p.creatine, 1]], {
        eligibleSubtotal: 999, discount: 100, subtotal: 999,
      });
    });
  });

  it("payment amount is the stored, server-computed total", async () => {
    const stored = await expectDiscount(code.cat, [[p.straps, 1], [p.creatine, 1]], {
      eligibleSubtotal: 399, discount: 79.8, subtotal: 999,
    });
    const payload = fawaterak.buildFawaterakTransactionPayload({
      orderId: stored.id,
      total: stored.total,
      customerName: stored.customerName,
      customerEmail: stored.customerEmail,
    } as never);
    expect(Number(payload.cartTotal)).toBeCloseTo(999 - 79.8 + shippingFee, 2);
    expect(Number(payload.cartTotal)).toBeCloseTo(Number(stored.total), 2);
  });

  it("with a fixed-amount offer active, validation and the order still agree", async () => {
    const offerId = v7();
    ids.offers.push(offerId);
    await db.insert(schema.cartOffer).values({
      id: offerId,
      name: "PS 100 off",
      isActive: true,
      condition: { type: "always" },
      reward: { type: "fixed_off", amountOff: 100 },
    } as never);
    try {
      // 100 off a 999 cart; the eligible line (399) carries 100 * 399/999.
      const eligibleOffer = 100 * (399 / 999);
      const promo = (399 - eligibleOffer) * 0.2;
      const v = await validate(await codeOf(code.cat), [[p.straps, 1], [p.creatine, 1]]);
      if (v._tag === "Left") throw new Error("validation failed");
      expect(v.right.discountAmount).toBeCloseTo(promo, 2);

      const o = await placeOrder(code.cat, [[p.straps, 1], [p.creatine, 1]]);
      if (o._tag === "Left") throw new Error("order failed");
      const [row] = await db.select().from(schema.order).where(eq(schema.order.id, o.right.id));
      // Stored discount is offer + promo.
      expect(Number(row!.discount)).toBeCloseTo(100 + v.right.discountAmount, 2);
      expect(Number(row!.total)).toBeCloseTo(999 - 100 - promo + shippingFee, 2);
    } finally {
      await db.update(schema.cartOffer).set({ isActive: false }).where(eq(schema.cartOffer.id, offerId));
    }
  });
});
