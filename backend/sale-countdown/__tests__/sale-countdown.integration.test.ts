import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { eq, inArray, sql } from "drizzle-orm";

/**
 * Sale countdown end to end against a real Postgres: dashboard actions, the
 * single server deadline, the atomic/idempotent expiry, checkout enforcement
 * (COD, online payment start, stale bags), rollback and the audit trail.
 *
 * Runs only with TEST_DATABASE_URL (a disposable database — never
 * production). The sale_countdown tables are emptied before each test; the
 * products, orders and attempts it creates are removed afterwards. Email is
 * stubbed, couriers are off and the payment provider is an in-process fake.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

describeIfDb("sale countdown (integration)", () => {
  let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
  let schema: typeof import("#root/shared/database/drizzle/schema");
  let dbModule: typeof import("#root/shared/database/drizzle/db");
  let sc: typeof import("#root/backend/sale-countdown/service");
  let orders: typeof import("#root/backend/orders/create-order/service");
  let attempts: typeof import("#root/backend/payments/payment-attempts/service");
  let emailModule: typeof import("#root/shared/email/service");
  let v7: () => string;

  const ids = { file: "", vendor: "", category: "", products: [] as string[], orders: [] as string[], attempts: [] as string[] };
  const ADMIN = "admin@example.invalid";

  const checkoutFields = {
    customerName: "Countdown Test",
    customerEmail: "countdown-test@example.invalid",
    customerPhone: "01000000000",
    shippingAddress: "1 Test St",
    shippingCity: "Cairo",
    shippingState: "Cairo",
    shippingPostalCode: "11511",
    shippingCountry: "Egypt",
  };

  const client = () => db as unknown as import("#root/shared/database/drizzle/db").DatabaseClient;

  async function mkProduct(price: string, discountPrice: string | null) {
    const id = v7();
    ids.products.push(id);
    await db.insert(schema.product).values({
      id,
      name: `Countdown Whey ${id.slice(-6)}`,
      slug: `countdown-${id}`,
      description: "d",
      price,
      discountPrice,
      imageId: ids.file,
      categoryId: ids.category,
      vendorId: ids.vendor,
      stock: 100,
    });
    return id;
  }

  const pricesOf = async (productIds: string[]) => {
    const rows = await db
      .select({ id: schema.product.id, price: schema.product.price, discountPrice: schema.product.discountPrice })
      .from(schema.product)
      .where(inArray(schema.product.id, productIds));
    return Object.fromEntries(rows.map((r) => [r.id, { price: r.price, discountPrice: r.discountPrice }]));
  };

  const countdownRow = async () =>
    (await db.select().from(schema.saleCountdown).where(eq(schema.saleCountdown.id, "default")))[0];

  const events = (type?: string) =>
    db
      .select()
      .from(schema.saleCountdownEvent)
      .where(type ? eq(schema.saleCountdownEvent.type, type) : undefined)
      .orderBy(schema.saleCountdownEvent.createdAt);

  /** Simulate "the deadline passed and nothing has finalized it yet". */
  const forceOverdue = () =>
    db
      .update(schema.saleCountdown)
      .set({ endsAt: new Date(Date.now() - 1000) })
      .where(eq(schema.saleCountdown.id, "default"));

  async function placeOrder(lines: Array<{ productId: string; quantity: number; expectedUnitPrice?: number }>) {
    const result = await Effect.runPromise(
      orders
        .createOrder(orders.createOrderSchema.parse({ ...checkoutFields, items: lines, paymentMethod: "cod" }))
        .pipe(
          Effect.provideService(emailModule.EmailService, emailModule.createDummyEmailService({ warn: () => {} })),
          Effect.provideService(dbModule.DatabaseClientService, db as never),
          Effect.either,
        ),
    );
    if (result._tag === "Right") ids.orders.push(result.right.id);
    return result;
  }

  const fakeProvider = {
    createTransaction: async () => ({ sessionId: `intent-${v7()}`, paymentUrl: "https://pay.test/x", expiresIn: null }),
    fetchTransaction: async () => {
      throw new Error("not used");
    },
  };

  /** Two sale products, one product with an unrelated discount, configured and auto-ending. */
  async function configuredSale() {
    const whey = await mkProduct("2700.00", "1400.00");
    const creatine = await mkProduct("600.00", "300.00");
    const unrelated = await mkProduct("800.00", "699.00");
    await sc.updateCountdownSettings(client(), { enabled: true }, ADMIN);
    await sc.setSaleItems(
      client(),
      { items: [{ productId: whey, postSalePrice: 2500 }, { productId: creatine, postSalePrice: 600 }] },
      ADMIN,
    );
    await sc.updateCountdownSettings(client(), { autoEndSale: true }, ADMIN);
    return { whey, creatine, unrelated };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    delete process.env.SYN_BOSTA_KEY;
    delete process.env.FINCART_ENABLED;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    schema = await import("#root/shared/database/drizzle/schema");
    dbModule = await import("#root/shared/database/drizzle/db");
    db = drizzle(TEST_DB_URL!, { schema });
    sc = await import("#root/backend/sale-countdown/service");
    orders = await import("#root/backend/orders/create-order/service");
    attempts = await import("#root/backend/payments/payment-attempts/service");
    emailModule = await import("#root/shared/email/service");
    ({ v7 } = await import("uuid"));

    ids.file = v7();
    await db.insert(schema.file).values({ id: ids.file, diskname: "countdown.jpg" });
    ids.vendor = v7();
    await db.insert(schema.vendor).values({ id: ids.vendor, name: "Countdown Vendor" });
    ids.category = v7();
    await db.insert(schema.category).values({ id: ids.category, name: "Countdown", slug: `countdown-${ids.category}` });
  });

  beforeEach(async () => {
    await db.delete(schema.saleCountdownEvent);
    await db.delete(schema.saleCountdownItem);
    await db.delete(schema.saleCountdown);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.saleCountdownEvent);
    await db.delete(schema.saleCountdownItem);
    await db.delete(schema.saleCountdown);
    if (ids.attempts.length) await db.delete(schema.paymentAttempt).where(inArray(schema.paymentAttempt.id, ids.attempts));
    if (ids.orders.length) {
      await db
        .delete(schema.scheduledEmail)
        .where(sql`${schema.scheduledEmail.payload}->>'orderId' in (${sql.join(ids.orders.map((id) => sql`${id}`), sql`, `)})`);
      await db.delete(schema.orderLog).where(inArray(schema.orderLog.orderId, ids.orders));
      await db.delete(schema.orderItem).where(inArray(schema.orderItem.orderId, ids.orders));
      await db.delete(schema.order).where(inArray(schema.order.id, ids.orders));
    }
    if (ids.products.length) await db.delete(schema.product).where(inArray(schema.product.id, ids.products));
    await db.delete(schema.category).where(eq(schema.category.id, ids.category));
    await db.delete(schema.vendor).where(eq(schema.vendor.id, ids.vendor));
    await db.delete(schema.file).where(eq(schema.file.id, ids.file));
  });

  it("1. starts inactive and off: nothing public, start refused while disabled", async () => {
    const state = await sc.getAdminCountdownState(client());
    expect(state.status).toBe("inactive");
    expect(state.settings).toEqual({ enabled: false, durationMinutes: 60, label: "Sale ends in", autoEndSale: false });
    expect((await sc.getPublicCountdown(client())).active).toBe(false);
    await expect(sc.startCountdown(client(), { mode: "duration" }, ADMIN)).rejects.toMatchObject({
      clientMessage: "Turn on the countdown before starting it.",
    });
  });

  it("2. setting up sale products never changes a price; auto end stays blocked until every price is explicit", async () => {
    const whey = await mkProduct("2700.00", "1400.00");
    const bars = await mkProduct("960.00", "480.00");
    const before = await pricesOf([whey, bars]);

    await sc.setSaleItems(
      client(),
      { items: [{ productId: whey, postSalePrice: 2500 }, { productId: bars, postSalePrice: null }] },
      ADMIN,
    );
    expect(await pricesOf([whey, bars])).toEqual(before);

    const state = await sc.getAdminCountdownState(client());
    expect(state.autoEndProblems).toEqual([expect.stringContaining("post-sale price is not set")]);
    await expect(sc.updateCountdownSettings(client(), { autoEndSale: true }, ADMIN)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect((await countdownRow())!.autoEndSale).toBe(false);

    // Above the list price is refused too (we never raise past list price).
    await sc.setSaleItems(
      client(),
      { items: [{ productId: whey, postSalePrice: 2500 }, { productId: bars, postSalePrice: 1000 }] },
      ADMIN,
    );
    await expect(sc.updateCountdownSettings(client(), { autoEndSale: true }, ADMIN)).rejects.toMatchObject({
      clientMessage: expect.stringContaining("above the list price"),
    });

    // Explicit, valid prices: allowed. And once on, the list can't be made incomplete.
    await sc.setSaleItems(
      client(),
      { items: [{ productId: whey, postSalePrice: 2500 }, { productId: bars, postSalePrice: 960 }] },
      ADMIN,
    );
    await sc.updateCountdownSettings(client(), { autoEndSale: true }, ADMIN);
    await expect(
      sc.setSaleItems(client(), { items: [{ productId: whey, postSalePrice: null }] }, ADMIN),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await pricesOf([whey, bars])).toEqual(before);
  });

  it("3. one server deadline: every read returns the same endsAt; start/extend/stop", async () => {
    await sc.updateCountdownSettings(client(), { enabled: true, durationMinutes: 60 }, ADMIN);
    const t0 = new Date();
    const started = await sc.startCountdown(client(), { mode: "duration" }, ADMIN, t0);
    expect(Date.parse(started.endsAt) - t0.getTime()).toBe(60 * 60_000);

    // "Refreshes" and "other devices" — later reads, same deadline.
    const reads = await Promise.all([1, 2, 3].map(() => sc.getPublicCountdown(client())));
    for (const r of reads) {
      expect(r).toMatchObject({ active: true, endsAt: started.endsAt, label: "Sale ends in" });
    }
    await expect(sc.startCountdown(client(), { mode: "duration" }, ADMIN)).rejects.toMatchObject({
      clientMessage: expect.stringContaining("already running"),
    });

    const later = new Date(Date.now() + 2 * 3600_000);
    await sc.updateCountdownExpiration(client(), { endsAt: later }, ADMIN);
    expect((await sc.getPublicCountdown(client())).endsAt).toBe(later.toISOString());

    await sc.stopCountdown(client(), ADMIN);
    expect(await sc.getPublicCountdown(client())).toMatchObject({ active: false, endsAt: null });
    expect((await sc.getAdminCountdownState(client())).status).toBe("inactive");
    expect((await events()).map((e) => e.type)).toEqual([
      "settings_changed",
      "started",
      "expiration_changed",
      "stopped",
    ]);

    // A scheduled expiration must be in the future.
    await expect(
      sc.startCountdown(client(), { mode: "until", endsAt: new Date(Date.now() - 1000) }, ADMIN),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("4. expiry is atomic and idempotent: one of many concurrent finalizers changes prices, unrelated discounts untouched", async () => {
    const { whey, creatine, unrelated } = await configuredSale();
    const before = await pricesOf([whey, creatine, unrelated]);
    const { endsAt } = await sc.startCountdown(client(), { mode: "duration", durationMinutes: 60 }, ADMIN);

    // Before the deadline nothing happens.
    expect(await sc.finalizeDueSaleCountdown(client())).toEqual({ finalized: false });
    expect(await pricesOf([whey, creatine, unrelated])).toEqual(before);

    const afterDeadline = new Date(Date.parse(endsAt) + 1);
    // Server truth flips at the deadline even before anything finalizes.
    expect((await sc.getPublicCountdown(client(), afterDeadline)).active).toBe(false);

    const results = await Promise.all(
      Array.from({ length: 6 }, () => sc.finalizeDueSaleCountdown(client(), afterDeadline)),
    );
    expect(results.filter((r) => r.finalized)).toHaveLength(1);

    const after = await pricesOf([whey, creatine, unrelated]);
    expect(after[whey]).toEqual({ price: "2700.00", discountPrice: "2500.00" });
    expect(after[creatine]).toEqual({ price: "600.00", discountPrice: null }); // post = list → no discount
    expect(after[unrelated]).toEqual(before[unrelated]);

    const expired = await events("expired");
    expect(expired).toHaveLength(1);
    expect(expired[0]!.actor).toBe("system");
    expect((expired[0]!.details as { saleEnd: { changes: unknown[] } }).saleEnd.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: whey,
          before: { price: "2700.00", discountPrice: "1400.00" },
          after: { discountPrice: "2500.00" },
        }),
        expect.objectContaining({
          productId: creatine,
          before: { price: "600.00", discountPrice: "300.00" },
          after: { discountPrice: null },
        }),
      ]),
    );
    const row = await countdownRow();
    expect(row).toMatchObject({ status: "expired" });
    expect(row!.saleEndedAt).not.toBeNull();

    // Again, later: still nothing.
    expect(await sc.finalizeDueSaleCountdown(client(), new Date(Date.parse(endsAt) + 60_000))).toEqual({
      finalized: false,
    });
  });

  it("5. checkout after the deadline but before the ticker: COD finalizes first and charges post-sale prices", async () => {
    const { whey, unrelated } = await configuredSale();
    await sc.startCountdown(client(), { mode: "duration" }, ADMIN);
    await forceOverdue();

    // The shared pricing function refuses while the expiry is pending…
    await expect(
      orders.priceCheckout(
        db as never,
        orders.createOrderSchema.parse({ ...checkoutFields, items: [{ productId: whey, quantity: 1 }] }),
        null,
      ),
    ).rejects.toMatchObject({ _tag: "SalePricesChanging", statusCode: 409 });

    // …and the order path applies it first, so the order is post-sale.
    const placed = await placeOrder([
      { productId: whey, quantity: 2 },
      { productId: unrelated, quantity: 1 },
    ]);
    expect(placed._tag).toBe("Right");
    if (placed._tag !== "Right") return;
    const [orderRow] = await db.select().from(schema.order).where(eq(schema.order.id, placed.right.id));
    expect(Number(orderRow!.subtotal)).toBe(2 * 2500 + 699);
    expect((await countdownRow())!.status).toBe("expired");
  });

  it("6. a stale bag is refused rather than charged more than it showed", async () => {
    const { whey } = await configuredSale();
    await sc.startCountdown(client(), { mode: "duration" }, ADMIN);
    await forceOverdue();
    await sc.finalizeDueSaleCountdown(client());

    // Bag cached at the sale price (1400) — server price is now 2500.
    const stale = await placeOrder([{ productId: whey, quantity: 1, expectedUnitPrice: 1400 }]);
    expect(stale._tag).toBe("Left");
    if (stale._tag === "Left") expect(stale.left).toMatchObject({ _tag: "PriceChanged", statusCode: 409 });

    // The refreshed bag goes through at the shown price.
    const fresh = await placeOrder([{ productId: whey, quantity: 1, expectedUnitPrice: 2500 }]);
    expect(fresh._tag).toBe("Right");
  });

  it("7. online payment started after the deadline is priced post-sale (never frozen at the sale price)", async () => {
    const { whey } = await configuredSale();
    await sc.startCountdown(client(), { mode: "duration" }, ADMIN);
    await forceOverdue();

    const input = attempts.startCheckoutSchema.parse({
      ...checkoutFields,
      items: [{ productId: whey, quantity: 1 }],
      paymentMethod: "fawaterak",
    });
    const started = await attempts.startOnlineCheckout(db as never, input, undefined, fakeProvider as never);
    if (started.kind !== "redirect") throw new Error("expected a redirect");
    ids.attempts.push(started.attemptId);
    const [att] = await db
      .select()
      .from(schema.paymentAttempt)
      .where(eq(schema.paymentAttempt.id, started.attemptId));
    expect(Number(att!.subtotal)).toBe(2500);
  });

  it("8. checkouts racing the expiry neither deadlock nor sell at the ended price", async () => {
    const { whey } = await configuredSale();
    await sc.startCountdown(client(), { mode: "duration" }, ADMIN);
    await forceOverdue();

    const [a, b, c] = await Promise.all([
      placeOrder([{ productId: whey, quantity: 1 }]),
      sc.finalizeDueSaleCountdown(client()),
      placeOrder([{ productId: whey, quantity: 1 }]),
    ]);
    for (const placed of [a, c]) {
      // Either priced post-sale, or refused with a retryable 409 — never the sale price.
      if (placed._tag === "Right") {
        const [row] = await db.select().from(schema.order).where(eq(schema.order.id, placed.right.id));
        expect(Number(row!.subtotal)).toBe(2500);
      } else {
        expect(placed.left).toMatchObject({ statusCode: 409 });
      }
    }
    expect(b).toBeDefined();
    expect(await events("expired")).toHaveLength(1);
  });

  it("9. rollback restores the sale prices it replaced, leaves products edited since alone, and runs once", async () => {
    const { whey, creatine } = await configuredSale();
    const { endsAt } = await sc.startCountdown(client(), { mode: "duration" }, ADMIN);
    await sc.finalizeDueSaleCountdown(client(), new Date(Date.parse(endsAt) + 1));

    // An admin edits one product after the sale ended.
    await db.update(schema.product).set({ discountPrice: "550.00" }).where(eq(schema.product.id, creatine));

    const state = await sc.getAdminCountdownState(client());
    expect(state.rollbackableEventId).not.toBeNull();
    const rolled = await sc.rollbackSaleEnd(client(), { eventId: state.rollbackableEventId! }, ADMIN);
    expect(rolled.restored).toBe(1);
    expect(rolled.conflicts).toEqual([expect.objectContaining({ productId: creatine })]);

    expect(await pricesOf([whey, creatine])).toEqual({
      [whey]: { price: "2700.00", discountPrice: "1400.00" },
      [creatine]: { price: "600.00", discountPrice: "550.00" },
    });
    expect((await sc.getAdminCountdownState(client())).rollbackableEventId).toBeNull();
    await expect(
      sc.rollbackSaleEnd(client(), { eventId: state.rollbackableEventId! }, ADMIN),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("10. auto end off: expiry only hides the countdown; disabling stops a running one", async () => {
    const whey = await mkProduct("2700.00", "1400.00");
    await sc.updateCountdownSettings(client(), { enabled: true }, ADMIN);
    await sc.setSaleItems(client(), { items: [{ productId: whey, postSalePrice: 2500 }] }, ADMIN);
    const { endsAt } = await sc.startCountdown(client(), { mode: "duration" }, ADMIN);
    const result = await sc.finalizeDueSaleCountdown(client(), new Date(Date.parse(endsAt) + 1));
    expect(result).toMatchObject({ finalized: true, saleEnded: false, changed: 0 });
    expect((await pricesOf([whey]))[whey]!.discountPrice).toBe("1400.00");

    // A new countdown later; then switched off mid-run.
    await sc.startCountdown(client(), { mode: "duration", durationMinutes: 5 }, ADMIN);
    await sc.updateCountdownSettings(client(), { enabled: false }, ADMIN);
    expect((await countdownRow())!.status).toBe("inactive");
    expect((await sc.getPublicCountdown(client())).active).toBe(false);
    expect((await pricesOf([whey]))[whey]!.discountPrice).toBe("1400.00");
  });

  it("11. a post-sale price above a since-lowered list price falls back to the list price, never above it", async () => {
    const whey = await mkProduct("2700.00", "1400.00");
    await sc.updateCountdownSettings(client(), { enabled: true }, ADMIN);
    await sc.setSaleItems(client(), { items: [{ productId: whey, postSalePrice: 2600 }] }, ADMIN);
    await sc.updateCountdownSettings(client(), { autoEndSale: true }, ADMIN);
    const { endsAt } = await sc.startCountdown(client(), { mode: "duration" }, ADMIN);
    await db.update(schema.product).set({ price: "2000.00" }).where(eq(schema.product.id, whey));
    await sc.finalizeDueSaleCountdown(client(), new Date(Date.parse(endsAt) + 1));
    expect((await pricesOf([whey]))[whey]).toEqual({ price: "2000.00", discountPrice: null });
    const [expired] = await events("expired");
    expect((expired!.details as { saleEnd: { changes: Array<{ cappedAtListPrice?: boolean }> } }).saleEnd.changes[0])
      .toMatchObject({ cappedAtListPrice: true });
  });
  it("12. deploy safety: if migration 0065 had not applied, checkout still prices (inside its transaction)", async () => {
    const whey = await mkProduct("2700.00", "1400.00");
    sc.resetCountdownTableCheck();
    const sentinel = new Error("rollback");
    let priced: Awaited<ReturnType<typeof orders.priceCheckout>> | null = null;
    await db
      .transaction(async (tx) => {
        // The table is invisible inside this transaction only; rolled back below.
        await tx.execute(sql`alter table sale_countdown rename to sale_countdown_hidden_for_test`);
        expect(await sc.readCountdown(tx as never)).toBeNull();
        priced = await orders.priceCheckout(
          tx as never,
          orders.createOrderSchema.parse({ ...checkoutFields, items: [{ productId: whey, quantity: 1 }] }),
          null,
        );
        throw sentinel;
      })
      .catch((error) => {
        if (error !== sentinel) throw error;
      });
    expect(priced).not.toBeNull();
    expect(priced!.subtotal).toBe(1400);
    // The table is back and is found again on the next read.
    sc.resetCountdownTableCheck();
    expect(await sc.getPublicCountdown(client())).toMatchObject({ active: false });
  });
});
