import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { eq, inArray } from "drizzle-orm";
import type { ClientSession } from "#root/backend/auth/shared/entities";

/**
 * Free Shipping promo codes, end to end against a real database:
 * an admin creates and manages the code (media buyers stay refused), the
 * cart validates it, a COD
 * order and an online payment attempt are priced with shipping 0, the promo
 * report attributes the order, and the Bosta input is still built from it.
 *
 * Runs only with TEST_DATABASE_URL. Creates its own users, categories,
 * products, promo codes, offers, orders and attempts and removes exactly
 * those afterwards. Email is stubbed, Bosta and Fincart are switched off and
 * the payment provider is a local fake, so nothing leaves the test.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

describeIfDb("free shipping promo codes (integration)", () => {
  let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
  let schema: typeof import("#root/shared/database/drizzle/schema");
  let dbModule: typeof import("#root/shared/database/drizzle/db");
  let createModule: typeof import("#root/backend/promo-codes/create-promo-code/create-promo-code");
  let updateModule: typeof import("#root/backend/promo-codes/update-promo-code/update-promo-code");
  let viewModule: typeof import("#root/backend/promo-codes/view-promo-codes/view-promo-codes");
  let validation: typeof import("#root/backend/promo-codes/validate-promo-code/validate-promo-code");
  let orders: typeof import("#root/backend/orders/create-order/service");
  let attempts: typeof import("#root/backend/payments/payment-attempts/service");
  let report: typeof import("#root/backend/promo-performance/service");
  let bosta: typeof import("#root/backend/orders/bosta/order-input");
  let emailModule: typeof import("#root/shared/email/service");
  let v7: () => string;

  const SHIPPING_FEE = 85;
  const tag = Date.now().toString(36).toUpperCase();
  const ids = {
    file: "",
    vendor: "",
    gear: "",
    supps: "",
    products: [] as string[],
    promos: [] as string[],
    orders: [] as string[],
    attempts: [] as string[],
    offers: [] as string[],
    users: [] as string[],
  };
  /** A 300 EGP gear item and a 500 EGP supplement. */
  const p = { gear: "", supp: "" };
  const shippingSettings: { insertedId: string | null; previousFee: string | null } = {
    insertedId: null,
    previousFee: null,
  };

  const session = (role: ClientSession["role"], email: string): ClientSession => ({
    id: `s-${role}`,
    token: "t",
    email,
    name: role,
    phone: "",
    expiresAt: new Date(Date.now() + 3_600_000),
    role,
  });
  let buyer: ClientSession;
  let admin: ClientSession;

  const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);
  const provideDb = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provideService(dbModule.DatabaseClientService, db as never));
  const either = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    run(provideDb(effect).pipe(Effect.either) as Effect.Effect<never, never, never>) as Promise<
      { _tag: "Right"; right: A } | { _tag: "Left"; left: E }
    >;

  async function createAs(s: ClientSession, input: Record<string, unknown>) {
    const parsed = createModule.createPromoCodeSchema.parse(input);
    const result = await either(createModule.createPromoCode(parsed, s));
    if (result._tag === "Right") ids.promos.push(result.right.id);
    return result;
  }

  async function updateAs(s: ClientSession, input: Record<string, unknown>) {
    return either(updateModule.updatePromoCode(updateModule.updatePromoCodeSchema.parse(input), s));
  }

  /** Insert a code directly (states the dashboard form can't produce). */
  async function insertPromo(values: Partial<typeof schema.promoCode.$inferInsert>) {
    const id = v7();
    ids.promos.push(id);
    await db.insert(schema.promoCode).values({
      id,
      code: `FS${ids.promos.length}X${tag}`,
      discountType: "free_shipping",
      discountValue: "0",
      status: "active",
      appliesToAllProducts: true,
      ...values,
    });
    return (await db.select().from(schema.promoCode).where(eq(schema.promoCode.id, id)))[0]!;
  }

  async function validate(code: string, lines: [string, number][], subtotal?: number) {
    const priceOf = (id: string) => (id === p.gear ? 300 : 500);
    const cartItems = lines.map(([id, quantity]) => ({ id, quantity, price: priceOf(id) }));
    return either(
      validation.validatePromoCode({
        code,
        cartItems,
        subtotal: subtotal ?? cartItems.reduce((s, i) => s + i.price * i.quantity, 0),
      }),
    );
  }

  const address = (email: string) => ({
    customerName: "Free Ship Test",
    customerEmail: email,
    customerPhone: "01000000000",
    shippingAddress: "1 Test St",
    shippingCity: "Nasr City",
    shippingState: "Cairo",
    shippingPostalCode: "11511",
    shippingCountry: "Egypt",
  });

  async function placeOrder(
    promoCodeId: string | undefined,
    lines: [string, number][],
    email = `free-ship-${tag.toLowerCase()}@example.invalid`,
  ) {
    const result = await either(
      orders
        .createOrder({
          ...address(email),
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
    );
    if (result._tag === "Right") ids.orders.push(result.right.id);
    return result;
  }

  async function orderRow(id: string) {
    return (await db.select().from(schema.order).where(eq(schema.order.id, id)))[0]!;
  }

  async function promoRow(id: string) {
    return (await db.select().from(schema.promoCode).where(eq(schema.promoCode.id, id)))[0]!;
  }

  const message = (r: { _tag: string; left?: unknown }) =>
    r._tag === "Left" ? String((r.left as { clientMessage?: string }).clientMessage) : "";

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    delete process.env.SYN_BOSTA_KEY;
    delete process.env.FINCART_ENABLED;

    const { drizzle } = await import("drizzle-orm/node-postgres");
    schema = await import("#root/shared/database/drizzle/schema");
    dbModule = await import("#root/shared/database/drizzle/db");
    db = drizzle(TEST_DB_URL!, { schema });
    createModule = await import("#root/backend/promo-codes/create-promo-code/create-promo-code");
    updateModule = await import("#root/backend/promo-codes/update-promo-code/update-promo-code");
    viewModule = await import("#root/backend/promo-codes/view-promo-codes/view-promo-codes");
    validation = await import("#root/backend/promo-codes/validate-promo-code/validate-promo-code");
    orders = await import("#root/backend/orders/create-order/service");
    attempts = await import("#root/backend/payments/payment-attempts/service");
    report = await import("#root/backend/promo-performance/service");
    bosta = await import("#root/backend/orders/bosta/order-input");
    emailModule = await import("#root/shared/email/service");
    ({ v7 } = await import("uuid"));

    const liveOffers = await db
      .select({ id: schema.cartOffer.id })
      .from(schema.cartOffer)
      .where(eq(schema.cartOffer.isActive, true));
    if (liveOffers.length > 0) {
      throw new Error("Test database has active cart offers; use a clean database");
    }

    // A non-zero shipping fee, or "shipping became 0" proves nothing.
    const [settings] = await db
      .select()
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.key, "default"));
    if (!settings) {
      shippingSettings.insertedId = v7();
      await db.insert(schema.storeSettings).values({
        id: shippingSettings.insertedId,
        key: "default",
        shippingFee: String(SHIPPING_FEE),
      } as never);
    } else {
      shippingSettings.previousFee = settings.shippingFee;
      await db
        .update(schema.storeSettings)
        .set({ shippingFee: String(SHIPPING_FEE) })
        .where(eq(schema.storeSettings.key, "default"));
    }

    const buyerEmail = `fs-buyer-${tag.toLowerCase()}@example.invalid`;
    const adminEmail = `fs-admin-${tag.toLowerCase()}@example.invalid`;
    const buyerId = v7();
    const adminId = v7();
    ids.users.push(buyerId, adminId);
    await db.insert(schema.user).values([
      { id: buyerId, name: "FS Buyer", email: buyerEmail, role: "media_buyer" },
      { id: adminId, name: "FS Admin", email: adminEmail, role: "admin" },
    ]);
    buyer = session("media_buyer", buyerEmail);
    admin = session("admin", adminEmail);

    ids.file = v7();
    await db.insert(schema.file).values({ id: ids.file, diskname: "free-ship.jpg" });
    ids.vendor = v7();
    await db.insert(schema.vendor).values({ id: ids.vendor, name: "Free Ship Vendor" });
    ids.gear = v7();
    ids.supps = v7();
    await db.insert(schema.category).values([
      { id: ids.gear, name: "FS Gear", slug: `fs-gear-${ids.gear}` },
      { id: ids.supps, name: "FS Supps", slug: `fs-supps-${ids.supps}` },
    ]);
    const mk = (name: string, price: string, categoryId: string) => {
      const id = v7();
      ids.products.push(id);
      return {
        id,
        name,
        slug: `fs-${id}`,
        description: "d",
        price,
        imageId: ids.file,
        categoryId,
        vendorId: ids.vendor,
        stock: 100,
      };
    };
    const gear = mk("FS Lifting Belt", "300.00", ids.gear);
    const supp = mk("FS Whey", "500.00", ids.supps);
    p.gear = gear.id;
    p.supp = supp.id;
    await db.insert(schema.product).values([gear, supp]);
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
    await db.delete(schema.category).where(inArray(schema.category.id, [ids.gear, ids.supps]));
    await db.delete(schema.vendor).where(eq(schema.vendor.id, ids.vendor));
    await db.delete(schema.file).where(eq(schema.file.id, ids.file));
    if (ids.users.length) {
      await db.delete(schema.user).where(inArray(schema.user.id, ids.users));
    }
    if (shippingSettings.insertedId) {
      await db.delete(schema.storeSettings).where(eq(schema.storeSettings.id, shippingSettings.insertedId));
    } else if (shippingSettings.previousFee !== null) {
      await db
        .update(schema.storeSettings)
        .set({ shippingFee: shippingSettings.previousFee })
        .where(eq(schema.storeSettings.key, "default"));
    }
  });

  // ─── 1. Promo managers (admins) manage Free Shipping codes ──────────────────

  describe("dashboard management", () => {
    let codeId = "";
    let codeText = "";

    it("an admin creates a Free Shipping code without any discount value", async () => {
      codeText = `FSHIP${tag}`;
      const result = await createAs(admin, {
        code: codeText,
        description: "Campaign free shipping",
        discountType: "free_shipping",
        usageLimit: 50,
        usageLimitPerUser: 3,
      });
      if (result._tag === "Left") throw new Error(message(result));
      codeId = result.right.id;
      const row = await promoRow(codeId);
      expect(row.discountType).toBe("free_shipping");
      expect(Number(row.discountValue)).toBe(0);
      expect(row.status).toBe("active");
      expect(row.usageLimit).toBe(50);
      expect(row.usageLimitPerUser).toBe(3);
      expect(row.createdBy).toBe(ids.users[1]);
    });

    it("a value sent with a Free Shipping code is ignored (stored as 0)", async () => {
      const result = await createAs(admin, {
        code: `FSVAL${tag}`,
        discountType: "free_shipping",
        discountValue: 40,
      });
      if (result._tag === "Left") throw new Error(message(result));
      expect(Number((await promoRow(result.right.id)).discountValue)).toBe(0);
    });

    it("percentage and fixed codes still require a value", () => {
      for (const discountType of ["percentage", "fixed_amount"]) {
        expect(() =>
          createModule.createPromoCodeSchema.parse({ code: `NOVAL${tag}`, discountType }),
        ).toThrow(/Discount value must be positive/);
      }
    });

    it("Free Shipping codes are listed and read like any other code", async () => {
      const pct = await createAs(admin, { code: `FSPCT${tag}`, discountType: "percentage", discountValue: 10 });
      if (pct._tag === "Left") throw new Error(message(pct));
      const list = await either(
        viewModule.viewPromoCodes(viewModule.viewPromoCodesSchema.parse({ searchCode: tag, limit: 100 }), admin),
      );
      if (list._tag === "Left") throw new Error("list failed");
      expect(list.right.items.map((c) => c.id)).toEqual(expect.arrayContaining([codeId, pct.right.id]));
      const read = await either(viewModule.getPromoCodeById({ id: codeId }, admin));
      if (read._tag === "Left") throw new Error("read failed");
      expect(read.right.discountType).toBe("free_shipping");
      expect(read.right.discountValue).toBe(0);
    });

    it("an admin edits, deactivates and reactivates a Free Shipping code", async () => {
      const edited = await updateAs(admin, { id: codeId, description: "Edited", minPurchaseAmount: 200 });
      if (edited._tag === "Left") throw new Error(message(edited));
      expect((await promoRow(codeId)).description).toBe("Edited");
      expect(Number((await promoRow(codeId)).minPurchaseAmount)).toBe(200);
      expect((await promoRow(codeId)).discountType).toBe("free_shipping");

      const off = await updateAs(admin, { id: codeId, status: "inactive" });
      if (off._tag === "Left") throw new Error(message(off));
      expect(message(await validate(codeText, [[p.supp, 1]]))).toMatch(/isn't active right now/);

      const on = await updateAs(admin, { id: codeId, status: "active" });
      if (on._tag === "Left") throw new Error(message(on));
      expect((await validate(codeText, [[p.supp, 1]]))._tag).toBe("Right");
    });

    it("switching a code from Free Shipping to percentage needs a value, and back stores 0", async () => {
      const id = (await insertPromo({})).id;
      const noValue = await updateAs(admin, { id, discountType: "percentage" });
      expect(message(noValue)).toMatch(/Percentage discount must be between/);
      const withValue = await updateAs(admin, { id, discountType: "percentage", discountValue: 15 });
      if (withValue._tag === "Left") throw new Error(message(withValue));
      expect(Number((await promoRow(id)).discountValue)).toBe(15);
      const back = await updateAs(admin, { id, discountType: "free_shipping" });
      if (back._tag === "Left") throw new Error(message(back));
      expect(Number((await promoRow(id)).discountValue)).toBe(0);
    });

    it("a media buyer is still refused by every promo service (401), unchanged", async () => {
      const create = await createAs(buyer, { code: `MBFS${tag}`, discountType: "free_shipping" });
      const update = await updateAs(buyer, { id: codeId, status: "inactive" });
      const list = await either(viewModule.viewPromoCodes(viewModule.viewPromoCodesSchema.parse({}), buyer));
      const read = await either(viewModule.getPromoCodeById({ id: codeId }, buyer));
      for (const r of [create, update, list, read]) {
        expect(r._tag).toBe("Left");
        expect((r as { left: { statusCode: number } }).left.statusCode).toBe(401);
      }
      expect((await promoRow(codeId)).status).toBe("active");
    });
  });

  // ─── 2-5. Checkout ──────────────────────────────────────────────────────────

  describe("checkout", () => {
    it("validation reports free shipping and no product discount", async () => {
      const promo = await insertPromo({});
      const v = await validate(promo.code, [[p.gear, 1], [p.supp, 1]]);
      if (v._tag === "Left") throw new Error(message(v));
      expect(v.right.discountType).toBe("free_shipping");
      expect(v.right.freeShipping).toBe(true);
      expect(v.right.discountAmount).toBe(0);
      expect(v.right.discountLabel).toBe("Free shipping");
      expect(v.right.eligibleSubtotal).toBe(800);
    });

    it("a COD order charges EGP 0 shipping, full product prices, correct total", async () => {
      const promo = await insertPromo({ usageLimit: 10 });
      const o = await placeOrder(promo.id, [[p.gear, 1], [p.supp, 1]]);
      if (o._tag === "Left") throw new Error(message(o));
      const row = await orderRow(o.right.id);
      expect(row.promoCodeId).toBe(promo.id);
      expect(Number(row.subtotal)).toBe(800);
      expect(row.discount).toBeNull();
      expect(Number(row.shipping)).toBe(0);
      expect(Number(row.total)).toBe(800);
      // Items keep their real prices.
      const items = await db.select().from(schema.orderItem).where(eq(schema.orderItem.orderId, row.id));
      expect(items.map((i) => Number(i.price)).sort()).toEqual([300, 500]);
      // Usage is counted like any other code.
      expect((await promoRow(promo.id)).usedCount).toBe(1);
      // Courier dispatch is untouched by the promo (Bosta is off in tests, so
      // nothing marked it skipped/cancelled).
      expect(row.bostaSyncStatus).toBeNull();
    });

    it("without a code — and with a percentage code — shipping is still charged", async () => {
      const none = await placeOrder(undefined, [[p.supp, 1]]);
      if (none._tag === "Left") throw new Error(message(none));
      const noneRow = await orderRow(none.right.id);
      expect(Number(noneRow.shipping)).toBe(SHIPPING_FEE);
      expect(Number(noneRow.total)).toBe(500 + SHIPPING_FEE);

      const pct = await insertPromo({ discountType: "percentage", discountValue: "10" });
      const v = await validate(pct.code, [[p.supp, 1]]);
      if (v._tag === "Left") throw new Error(message(v));
      expect(v.right.freeShipping).toBe(false);
      expect(v.right.discountAmount).toBe(50);
      const o = await placeOrder(pct.id, [[p.supp, 1]]);
      if (o._tag === "Left") throw new Error(message(o));
      const row = await orderRow(o.right.id);
      expect(Number(row.discount)).toBe(50);
      expect(Number(row.shipping)).toBe(SHIPPING_FEE);
      expect(Number(row.total)).toBe(500 - 50 + SHIPPING_FEE);

      const fixed = await insertPromo({ discountType: "fixed_amount", discountValue: "70" });
      const f = await placeOrder(fixed.id, [[p.supp, 1]]);
      if (f._tag === "Left") throw new Error(message(f));
      const fixedRow = await orderRow(f.right.id);
      expect(Number(fixedRow.discount)).toBe(70);
      expect(Number(fixedRow.total)).toBe(500 - 70 + SHIPPING_FEE);
    });

    it("a product-restricted code needs an eligible item in the cart", async () => {
      const promo = await insertPromo({ appliesToAllProducts: false });
      await db.insert(schema.promoCodeCategories).values({ id: v7(), promoCodeId: promo.id, categoryId: ids.gear });

      const v = await validate(promo.code, [[p.supp, 1]]);
      expect(message(v)).toMatch(/doesn't apply to any of the items/);
      const o = await placeOrder(promo.id, [[p.supp, 1]]);
      expect(message(o)).toMatch(/doesn't apply to any of the items/);

      const ok = await placeOrder(promo.id, [[p.gear, 1], [p.supp, 1]]);
      if (ok._tag === "Left") throw new Error(message(ok));
      const row = await orderRow(ok.right.id);
      expect(Number(row.shipping)).toBe(0);
      expect(Number(row.total)).toBe(800);
    });

    it("the minimum order is enforced at validation and at order time", async () => {
      const promo = await insertPromo({ minPurchaseAmount: "600" });
      expect(message(await validate(promo.code, [[p.supp, 1]]))).toMatch(/minimum order of 600.00 EGP/);
      // A forged client subtotal doesn't get past order creation.
      expect((await validate(promo.code, [[p.supp, 1]], 10_000))._tag).toBe("Right");
      expect(message(await placeOrder(promo.id, [[p.supp, 1]]))).toMatch(/minimum order of 600.00 EGP/);
      const ok = await placeOrder(promo.id, [[p.supp, 1], [p.gear, 1]]);
      expect(ok._tag).toBe("Right");
    });

    it.each([
      ["expired", { endDate: new Date(Date.now() - 86_400_000) }, /expired/],
      ["inactive", { status: "inactive" as const }, /isn't active right now/],
      ["exhausted", { usageLimit: 1, usedCount: 1 }, /usage limit/],
      ["not started", { status: "scheduled" as const, startDate: new Date(Date.now() + 86_400_000) }, /isn't active yet/],
    ])("a %s code is rejected by validation and at order time", async (_name, values, pattern) => {
      const promo = await insertPromo(values);
      const v = await validate(promo.code, [[p.supp, 1]]);
      expect(v._tag).toBe("Left");
      expect(message(v)).toMatch(pattern);
      const o = await placeOrder(promo.id, [[p.supp, 1]]);
      expect(o._tag).toBe("Left");
      expect(message(o)).toMatch(pattern);
    });

    it("an unknown code is rejected", async () => {
      expect(message(await validate(`NOPE${tag}`, [[p.supp, 1]]))).toMatch(/isn't a valid promo code/);
    });

    it("the per-customer limit holds", async () => {
      const promo = await insertPromo({ usageLimitPerUser: 1 });
      const email = `fs-once-${tag.toLowerCase()}@example.invalid`;
      expect((await placeOrder(promo.id, [[p.supp, 1]], email))._tag).toBe("Right");
      expect(message(await placeOrder(promo.id, [[p.supp, 1]], email))).toMatch(/already used this promo code/);
    });

    it("the last use exhausts the code", async () => {
      const promo = await insertPromo({ usageLimit: 1 });
      expect((await placeOrder(promo.id, [[p.supp, 1]]))._tag).toBe("Right");
      expect((await promoRow(promo.id)).status).toBe("exhausted");
      expect(message(await placeOrder(promo.id, [[p.supp, 1]]))).toMatch(/usage limit/);
    });

    it("stacks with automatic offers: the offer discount stays, shipping is 0", async () => {
      const offerId = v7();
      ids.offers.push(offerId);
      await db.insert(schema.cartOffer).values({
        id: offerId,
        name: "FS 10% off",
        isActive: true,
        condition: { type: "always" },
        reward: { type: "percentage_off", percentOff: 10 },
      } as never);
      try {
        const promo = await insertPromo({});
        const o = await placeOrder(promo.id, [[p.gear, 1], [p.supp, 1]]);
        if (o._tag === "Left") throw new Error(message(o));
        const row = await orderRow(o.right.id);
        expect(Number(row.discount)).toBe(80); // the offer only
        expect(Number(row.shipping)).toBe(0);
        expect(Number(row.total)).toBe(720);
      } finally {
        await db.update(schema.cartOffer).set({ isActive: false }).where(eq(schema.cartOffer.id, offerId));
      }
    });

    it("an online payment attempt is priced the same way (amount sent to the provider)", async () => {
      const promo = await insertPromo({});
      const sent: string[] = [];
      const fakeProvider = {
        createTransaction: async (input: { total: string }) => {
          sent.push(String(input.total));
          return { sessionId: `fake-${v7()}`, paymentUrl: "https://fake-provider.test/pay", expiresIn: null };
        },
        fetchTransaction: async () => {
          throw new Error("not used");
        },
      };
      const parsed = attempts.startCheckoutSchema.parse({
        ...address(`fs-online-${tag.toLowerCase()}@example.invalid`),
        items: [{ productId: p.supp, quantity: 2 }],
        paymentMethod: "fawaterak",
        promoCodeId: promo.id,
        cartSessionToken: `fs-${v7()}`,
      });
      const result = await attempts.startOnlineCheckout(db as never, parsed, undefined, fakeProvider as never);
      ids.attempts.push(result.attemptId);
      const [attempt] = await db
        .select()
        .from(schema.paymentAttempt)
        .where(eq(schema.paymentAttempt.id, result.attemptId));
      expect(Number(attempt!.subtotal)).toBe(1000);
      expect(Number(attempt!.shipping)).toBe(0);
      expect(Number(attempt!.promoDiscount)).toBe(0);
      expect(Number(attempt!.total)).toBe(1000);
      expect(attempt!.promoCodeId).toBe(promo.id);
      expect(attempt!.promoCode).toBe(promo.code);
      expect(sent.map(Number)).toEqual([1000]);
      // Nothing is used or ordered until payment is verified.
      expect((await promoRow(promo.id)).usedCount).toBe(0);
    });
  });

  // ─── 8-9. Reporting and Bosta ───────────────────────────────────────────────

  describe("records, reporting and courier", () => {
    let orderId = "";
    let code = "";

    beforeAll(async () => {
      const promo = await insertPromo({});
      code = promo.code;
      const o = await placeOrder(promo.id, [[p.gear, 2]]);
      if (o._tag === "Left") throw new Error(message(o));
      orderId = o.right.id;
    });

    it("the promo report attributes the order to the code, with no review flags", async () => {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
      const page = await report.getPromoOrders(db as never, {
        range: { from: today, to: today },
        code,
        limit: 100,
        offset: 0,
      });
      const row = page.rows.find((r) => r.id === orderId);
      expect(row).toBeDefined();
      expect(row!.attribution).toBe("promo_link");
      expect(row!.subtotal).toBe("600.00");
      expect(row!.discount).toBe("0.00");
      expect(row!.promoOnlyDiscount).toBe("0.00");
      expect(row!.net).toBe("600.00");
      expect(row!.shipping).toBe("0.00");
      expect(row!.total).toBe("600.00");
      expect(row!.reasons).not.toContain("total_mismatch");
      expect(page.totals.orders).toBe(1);
      expect(page.totals.netSales).toBe("600.00");
    });

    it("the Bosta shipment input is still built, collecting exactly the order total", async () => {
      const row = await orderRow(orderId);
      const items = await db.select().from(schema.orderItem).where(eq(schema.orderItem.orderId, orderId));
      const built = bosta.buildBostaInputFromOrder(row, items);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(built.input.cod).toBe(600);
      expect(built.input.goodsAmount).toBe(600);
      expect(built.input.itemsCount).toBe(2);
    });
  });
});
