import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { asc, eq, inArray } from "drizzle-orm";

/**
 * Buy X Get Y Free (same product) end to end against a real Postgres: the
 * dashboard's offer lifecycle, the cart preview, COD orders, the online
 * payment-attempt snapshot and its materialization, stock (including
 * concurrent checkouts) and the order's audit snapshot.
 *
 * Runs only with TEST_DATABASE_URL (a disposable database — never
 * production). Creates its own products, offers, promo codes and orders and
 * removes exactly those afterwards. Email is stubbed, courier dispatch is off
 * and the payment provider is an in-process fake, so nothing leaves the test.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

describeIfDb("Buy X Get Y free gifts (integration)", () => {
  let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
  let schema: typeof import("#root/shared/database/drizzle/schema");
  let dbModule: typeof import("#root/shared/database/drizzle/db");
  let offers: typeof import("#root/backend/offers/service");
  let orders: typeof import("#root/backend/orders/create-order/service");
  let deleteOrderModule: typeof import("#root/backend/orders/delete-order/service");
  let attempts: typeof import("#root/backend/payments/payment-attempts/service");
  let emailModule: typeof import("#root/shared/email/service");
  let getShippingFeeRaw: typeof import("#root/backend/settings/get-shipping-fee").getShippingFeeRaw;
  let v7: () => string;

  const ids = {
    file: "",
    vendor: "",
    category: "",
    otherCategory: "",
    products: [] as string[],
    offers: [] as string[],
    promos: [] as string[],
    orders: [] as string[],
    attempts: [] as string[],
  };
  let shippingFee = 0;

  const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);
  const provideDb = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provideService(dbModule.DatabaseClientService, db as never));

  const admin = {
    id: "bogo-admin",
    token: "t",
    email: "bogo-admin@example.invalid",
    name: "Admin",
    phone: "0",
    expiresAt: new Date(Date.now() + 60_000),
    role: "admin" as const,
  };

  const checkoutFields = {
    customerName: "BOGO Test",
    customerEmail: "bogo-test@example.invalid",
    customerPhone: "01000000000",
    shippingAddress: "1 Test St",
    shippingCity: "Cairo",
    shippingState: "Cairo",
    shippingPostalCode: "11511",
    shippingCountry: "Egypt",
  };

  type Line = [productId: string, quantity: number, selectedOptions?: string];
  const toItems = (lines: Line[]) =>
    lines.map(([productId, quantity, selectedOptions]) => ({ productId, quantity, selectedOptions }));

  async function mkProduct(stock: number, price = "2000.00", opts: { discountPrice?: string; categoryId?: string } = {}) {
    const id = v7();
    ids.products.push(id);
    await db.insert(schema.product).values({
      id,
      name: `BOGO Whey ${id.slice(-6)}`,
      slug: `bogo-${id}`,
      description: "d",
      price,
      discountPrice: opts.discountPrice ?? null,
      imageId: ids.file,
      categoryId: opts.categoryId ?? ids.otherCategory,
      vendorId: ids.vendor,
      stock,
    });
    return id;
  }

  async function mkBogo(
    productIds: string[],
    extra: {
      buyQuantity?: number;
      getQuantity?: number;
      repeatsPerMultiple?: boolean;
      categoryIds?: string[];
      priority?: number;
      isExclusive?: boolean;
      isActive?: boolean;
      startsAt?: Date;
      endsAt?: Date;
    } = {},
  ) {
    const created = await run(
      provideDb(
        offers.createOffer(
          offers.createOfferSchema.parse({
            name: `Buy ${extra.buyQuantity ?? 1} Get ${extra.getQuantity ?? 1} Free`,
            isActive: extra.isActive ?? true,
            priority: extra.priority ?? 0,
            isExclusive: extra.isExclusive ?? false,
            startsAt: extra.startsAt,
            endsAt: extra.endsAt,
            condition: {
              type: "buy_x_get_y",
              buyQuantity: extra.buyQuantity ?? 1,
              productIds,
              categoryIds: extra.categoryIds,
              repeatsPerMultiple: extra.repeatsPerMultiple ?? true,
            },
            reward: { type: "free_gift", getQuantity: extra.getQuantity ?? 1, sameProduct: true, autoAdd: true },
          }),
        ),
      ),
    );
    ids.offers.push(created.id);
    return created;
  }

  async function placeOrder(lines: Line[], extra: { promoCodeId?: string } = {}) {
    const result = await run(
      provideDb(
        orders
          .createOrder(
            orders.createOrderSchema.parse({
              ...checkoutFields,
              items: toItems(lines),
              paymentMethod: "cod",
              ...extra,
            }),
          )
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

  const evaluate = (lines: Array<{ id: string; quantity: number; price?: number; selectedOptions?: string }>) =>
    run(
      provideDb(
        offers.evaluateOffers({
          cartItems: lines.map((l) => ({ name: "client name", price: 0, ...l })),
          subtotal: 0,
        }),
      ),
    );

  const stockOf = async (id: string) =>
    (await db.select({ stock: schema.product.stock }).from(schema.product).where(eq(schema.product.id, id)))[0]!.stock;

  const itemsOf = (orderId: string) =>
    db
      .select()
      .from(schema.orderItem)
      .where(eq(schema.orderItem.orderId, orderId))
      .orderBy(asc(schema.orderItem.isFreeGift), asc(schema.orderItem.createdAt));

  const orderRow = async (orderId: string) =>
    (await db.select().from(schema.order).where(eq(schema.order.id, orderId)))[0]!;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    delete process.env.SYN_BOSTA_KEY;
    delete process.env.FINCART_ENABLED;

    const { drizzle } = await import("drizzle-orm/node-postgres");
    schema = await import("#root/shared/database/drizzle/schema");
    dbModule = await import("#root/shared/database/drizzle/db");
    db = drizzle(TEST_DB_URL!, { schema });
    offers = await import("#root/backend/offers/service");
    orders = await import("#root/backend/orders/create-order/service");
    deleteOrderModule = await import("#root/backend/orders/delete-order/service");
    attempts = await import("#root/backend/payments/payment-attempts/service");
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
    await db.insert(schema.file).values({ id: ids.file, diskname: "bogo.jpg" });
    ids.vendor = v7();
    await db.insert(schema.vendor).values({ id: ids.vendor, name: "BOGO Vendor" });
    ids.category = v7();
    ids.otherCategory = v7();
    await db
      .insert(schema.category)
      .values([
        { id: ids.category, name: "BOGO Protein", slug: `bogo-protein-${ids.category}` },
        { id: ids.otherCategory, name: "BOGO Other", slug: `bogo-other-${ids.otherCategory}` },
      ]);

    shippingFee = await getShippingFeeRaw(db as never);
  });

  // Every test starts with no active offer of ours.
  afterEach(async () => {
    if (ids.offers.length) {
      await db
        .update(schema.cartOffer)
        .set({ isActive: false })
        .where(inArray(schema.cartOffer.id, ids.offers));
    }
  });

  afterAll(async () => {
    if (!db) return;
    if (ids.attempts.length) {
      await db.delete(schema.paymentAttempt).where(inArray(schema.paymentAttempt.id, ids.attempts));
    }
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
    await db.delete(schema.category).where(inArray(schema.category.id, [ids.category, ids.otherCategory]));
    await db.delete(schema.vendor).where(eq(schema.vendor.id, ids.vendor));
    await db.delete(schema.file).where(eq(schema.file.id, ids.file));
  });

  it("1. dashboard lifecycle: create, edit, deactivate and reactivate a BOGO offer", async () => {
    const whey = await mkProduct(10);
    const offer = await mkBogo([whey]);
    expect(offer.condition).toEqual({
      type: "buy_x_get_y",
      buyQuantity: 1,
      productIds: [whey],
      repeatsPerMultiple: true,
    });
    expect(offer.reward).toEqual({ type: "free_gift", getQuantity: 1, sameProduct: true, autoAdd: true });

    // Changing one half of the pair into something that no longer fits is refused.
    const broken = await run(
      provideDb(offers.updateOffer({ id: offer.id, reward: { type: "percentage_off", percentOff: 50 } })).pipe(
        Effect.either,
      ),
    );
    expect(broken._tag).toBe("Left");
    if (broken._tag === "Left") expect(broken.left).toMatchObject({ statusCode: 400 });

    // A valid edit is kept.
    await run(
      provideDb(
        offers.updateOffer({
          id: offer.id,
          reward: { type: "free_gift", getQuantity: 2, sameProduct: true, autoAdd: true },
        }),
      ),
    );
    expect((await evaluate([{ id: whey, quantity: 1 }]))[0]?.gifts?.[0]?.quantity).toBe(2);

    await run(provideDb(offers.updateOffer({ id: offer.id, isActive: false })));
    expect(await evaluate([{ id: whey, quantity: 1 }])).toEqual([]);

    await run(provideDb(offers.updateOffer({ id: offer.id, isActive: true })));
    expect((await evaluate([{ id: whey, quantity: 1 }]))[0]?.gifts).toHaveLength(1);
  });

  it("2. cart preview prices from the database and keeps the variant", async () => {
    const whey = await mkProduct(10, "2000.00", { discountPrice: "1800.00" });
    await mkBogo([whey]);

    // The client claims a price of 0.01 — ignored.
    const [applied] = await evaluate([{ id: whey, quantity: 2, price: 0.01, selectedOptions: "Flavor: Vanilla" }]);
    expect(applied?.discountAmount).toBe(0);
    expect(applied?.gifts).toEqual([
      expect.objectContaining({
        productId: whey,
        selectedOptions: "Flavor: Vanilla",
        quantity: 2,
        unitValue: 1800,
      }),
    ]);
    expect(applied?.gifts?.[0]).not.toHaveProperty("insufficientStock");
  });

  it("3. inactive, expired and not-yet-started offers give nothing", async () => {
    const whey = await mkProduct(10);
    await mkBogo([whey], { isActive: false });
    await mkBogo([whey], { endsAt: new Date(Date.now() - 60_000) });
    await mkBogo([whey], { startsAt: new Date(Date.now() + 3_600_000) });
    expect(await evaluate([{ id: whey, quantity: 1 }])).toEqual([]);
  });

  it("4. COD order: one paid unit + one free unit, stock for both, auditable snapshot", async () => {
    const whey = await mkProduct(10);
    const offer = await mkBogo([whey]);

    const result = await placeOrder([[whey, 1, "Flavor: Chocolate"]]);
    if (result._tag === "Left") throw new Error(JSON.stringify(result.left));
    const orderId = result.right.id;

    const stored = await orderRow(orderId);
    expect(Number(stored.subtotal)).toBe(2000);
    expect(stored.discount).toBeNull();
    expect(Number(stored.tax)).toBe(0);
    expect(Number(stored.shipping)).toBe(shippingFee);
    expect(Number(stored.total)).toBe(2000 + shippingFee);

    const [paid, gift] = await itemsOf(orderId);
    expect(paid).toMatchObject({ quantity: 1, price: "2000.00", isFreeGift: false, offerId: null });
    expect(gift).toMatchObject({
      productId: whey,
      quantity: 1,
      price: "0.00",
      discountPrice: null,
      isFreeGift: true,
      offerId: offer.id,
    });
    expect(gift?.name).toMatch(/\(Flavor: Chocolate\) \(Free gift\)$/);
    expect(await stockOf(whey)).toBe(8);

    expect(stored.appliedOffers).toEqual([
      expect.objectContaining({
        id: offer.id,
        condition: offer.condition,
        reward: offer.reward,
        discountAmount: 0,
        freeShipping: false,
        gifts: [expect.objectContaining({ productId: whey, quantity: 1, unitValue: 2000, selectedOptions: "Flavor: Chocolate" })],
      }),
    ]);

    // Editing or deleting the offer later never rewrites the order.
    await run(provideDb(offers.updateOffer({ id: offer.id, name: "Renamed" })));
    await run(provideDb(offers.deleteOffer(offer.id)));
    ids.offers = ids.offers.filter((id) => id !== offer.id);
    const after = await orderRow(orderId);
    expect(after.appliedOffers).toEqual(stored.appliedOffers);
    expect((await itemsOf(orderId))[1]).toMatchObject({ isFreeGift: true, offerId: offer.id });

    // Deleting the order gives back every physical unit, free ones included.
    await run(provideDb(deleteOrderModule.deleteOrder({ orderId }, admin)));
    ids.orders = ids.orders.filter((id) => id !== orderId);
    expect(await stockOf(whey)).toBe(10);
  });

  it("5. repeat per multiple scales with the paid quantity at checkout", async () => {
    const whey = await mkProduct(10);
    await mkBogo([whey]);
    const result = await placeOrder([[whey, 3]]);
    if (result._tag === "Left") throw new Error(JSON.stringify(result.left));
    const [paid, gift] = await itemsOf(result.right.id);
    expect(paid?.quantity).toBe(3);
    expect(gift?.quantity).toBe(3);
    expect(Number((await orderRow(result.right.id)).subtotal)).toBe(6000);
    expect(await stockOf(whey)).toBe(4);
  });

  it("6. an offer that ends while the item is in the cart no longer gives a gift", async () => {
    const whey = await mkProduct(10);
    const offer = await mkBogo([whey]);
    expect((await evaluate([{ id: whey, quantity: 1 }]))[0]?.gifts).toHaveLength(1);

    await run(provideDb(offers.updateOffer({ id: offer.id, endsAt: new Date(Date.now() - 1000) })));
    const result = await placeOrder([[whey, 1]]);
    if (result._tag === "Left") throw new Error(JSON.stringify(result.left));
    expect(await itemsOf(result.right.id)).toHaveLength(1);
    expect((await orderRow(result.right.id)).appliedOffers).toBeNull();
    expect(await stockOf(whey)).toBe(9);
  });

  it("7. stock that covers the paid unit but not the gift is refused, clearly, with nothing changed", async () => {
    const whey = await mkProduct(1);
    await mkBogo([whey]);

    const [preview] = await evaluate([{ id: whey, quantity: 1 }]);
    expect(preview?.gifts?.[0]?.insufficientStock).toEqual({ available: 1, required: 2 });

    const result = await placeOrder([[whey, 1]]);
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toMatchObject({ statusCode: 400 });
      expect((result.left as { clientMessage?: string }).clientMessage).toMatch(/free gift/);
    }
    expect(await stockOf(whey)).toBe(1);
  });

  it("8. stock is shared across variant lines of one product", async () => {
    const whey = await mkProduct(3);
    await mkBogo([whey]);
    // 1 Chocolate + 1 Vanilla paid → 2 free → 4 units needed, 3 in stock.
    const result = await placeOrder([
      [whey, 1, "Flavor: Chocolate"],
      [whey, 1, "Flavor: Vanilla"],
    ]);
    expect(result._tag).toBe("Left");
    expect(await stockOf(whey)).toBe(3);
  });

  it("9. concurrent checkouts can't oversell paid + free units", async () => {
    const whey = await mkProduct(2);
    await mkBogo([whey]);
    const results = await Promise.all([placeOrder([[whey, 1]]), placeOrder([[whey, 1]])]);
    expect(results.filter((r) => r._tag === "Right")).toHaveLength(1);
    expect(results.filter((r) => r._tag === "Left")).toHaveLength(1);
    expect(await stockOf(whey)).toBe(0);
  });

  it("10. client-sent prices, gift flags and free quantities are ignored", async () => {
    const whey = await mkProduct(10);
    await mkBogo([whey]);
    const parsed = orders.createOrderSchema.parse({
      ...checkoutFields,
      paymentMethod: "cod",
      items: [
        { productId: whey, quantity: 1, price: 0, isFreeGift: true, freeQuantity: 5 },
        // A shopper "adding the gift themselves" just buys a second unit.
        { productId: whey, quantity: 1, price: 0, isFreeGift: true },
      ],
      subtotal: 0,
      total: 0,
      discount: 999,
    });
    expect(parsed.items[0]).toEqual({ productId: whey, quantity: 1 });
    expect(parsed).not.toHaveProperty("total");

    const result = await placeOrder([
      [whey, 1],
      [whey, 1],
    ]);
    if (result._tag === "Left") throw new Error(JSON.stringify(result.left));
    const stored = await orderRow(result.right.id);
    expect(Number(stored.subtotal)).toBe(4000);
    expect(Number(stored.total)).toBe(4000 + shippingFee);
    const items = await itemsOf(result.right.id);
    expect(items.filter((i) => i.isFreeGift).reduce((s, i) => s + i.quantity, 0)).toBe(2);
    expect(await stockOf(whey)).toBe(6);
  });

  it("11. priority, exclusivity and a promo code on a BOGO cart", async () => {
    const whey = await mkProduct(10);
    await mkBogo([whey], { priority: 0, isExclusive: true });
    const tenPercent = await run(
      provideDb(
        offers.createOffer(
          offers.createOfferSchema.parse({
            name: "10% everything",
            priority: 1,
            condition: { type: "always" },
            reward: { type: "percentage_off", percentOff: 10 },
          }),
        ),
      ),
    );
    ids.offers.push(tenPercent.id);

    // Exclusive BOGO first: the 10% offer never applies.
    const applied = await evaluate([{ id: whey, quantity: 1 }]);
    expect(applied.map((o) => o.reward.type)).toEqual(["free_gift"]);

    // A promo code still stacks (existing rule) and applies to the paid amount only.
    const promoId = v7();
    ids.promos.push(promoId);
    await db.insert(schema.promoCode).values({
      id: promoId,
      code: `BOGO${Date.now().toString(36).toUpperCase()}`,
      discountType: "percentage",
      discountValue: "10",
      status: "active",
      appliesToAllProducts: true,
    });
    const result = await placeOrder([[whey, 1]], { promoCodeId: promoId });
    if (result._tag === "Left") throw new Error(JSON.stringify(result.left));
    const stored = await orderRow(result.right.id);
    expect(Number(stored.subtotal)).toBe(2000);
    expect(Number(stored.discount)).toBe(200);
    expect(Number(stored.total)).toBe(1800 + shippingFee);
    expect(await itemsOf(result.right.id)).toHaveLength(2);
  });

  it("12. category eligibility", async () => {
    const inCategory = await mkProduct(10, "500.00", { categoryId: ids.category });
    const outside = await mkProduct(10, "500.00");
    await mkBogo([], { categoryIds: [ids.category] });
    const gifts = (await evaluate([{ id: outside, quantity: 1 }, { id: inCategory, quantity: 1 }])).flatMap(
      (o) => o.gifts ?? [],
    );
    expect(gifts).toEqual([expect.objectContaining({ productId: inCategory, quantity: 1 })]);
  });

  it("13. online checkout: the attempt freezes the gift line and materialization takes stock for it", async () => {
    const whey = await mkProduct(10);
    const offer = await mkBogo([whey]);
    const provider = {
      createTransaction: async () => ({
        sessionId: `intent-${v7()}`,
        paymentUrl: "https://pay.test/x",
        expiresIn: null,
      }),
      fetchTransaction: async () => {
        throw new Error("not used");
      },
    };
    const input = attempts.startCheckoutSchema.parse({
      ...checkoutFields,
      items: toItems([[whey, 2, "Flavor: Vanilla"]]),
      paymentMethod: "fawaterak",
    });
    const started = await attempts.startOnlineCheckout(db as never, input, undefined, provider as never);
    if (started.kind !== "redirect") throw new Error("expected a redirect");
    ids.attempts.push(started.attemptId);

    const [att] = await db
      .select()
      .from(schema.paymentAttempt)
      .where(eq(schema.paymentAttempt.id, started.attemptId));
    expect(Number(att!.subtotal)).toBe(4000);
    expect(Number(att!.total)).toBe(4000 + shippingFee);
    expect(att!.itemsSnapshot).toEqual([
      expect.objectContaining({ productId: whey, quantity: 2, unitPrice: 2000 }),
      expect.objectContaining({
        productId: whey,
        selectedOptions: "Flavor: Vanilla",
        quantity: 2,
        unitPrice: 0,
        lineTotal: 0,
        listPrice: "0.00",
        freeGift: { offerId: offer.id, offerName: offer.name, unitValue: 2000 },
      }),
    ]);
    expect(await stockOf(whey)).toBe(10); // nothing taken before payment

    await db
      .update(schema.paymentAttempt)
      .set({ status: "paid_pending_materialization", paidAt: new Date() })
      .where(eq(schema.paymentAttempt.id, started.attemptId));
    const outcome = await attempts.materializeAttempt(db as never, started.attemptId);
    expect(outcome).toMatchObject({ kind: "materialized", held: false });
    ids.orders.push(started.attemptId);

    const items = await itemsOf(started.attemptId);
    expect(items.map((i) => [i.quantity, i.price, i.isFreeGift])).toEqual([
      [2, "2000.00", false],
      [2, "0.00", true],
    ]);
    expect(items[1]?.offerId).toBe(offer.id);
    expect(await stockOf(whey)).toBe(6);
    expect((await orderRow(started.attemptId)).appliedOffers?.[0]?.gifts?.[0]).toMatchObject({ quantity: 2 });
  });
});
