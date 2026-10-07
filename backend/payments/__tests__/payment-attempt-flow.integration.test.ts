import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Payment-attempt-first online checkout, end to end against a real Postgres.
 *
 * Runs only with TEST_DATABASE_URL (a disposable database — never
 * production). The Fawaterak HTTP API is a local fetch stub that behaves like
 * the provider (createTransaction / getTransactionData, keyed by intent);
 * webhooks are signed with the test vendor key and go through the exact
 * production deps (buildFawaterakWebhookDeps). Bosta's HTTP call is the only
 * other stub — the real dispatcher (payment gate, hold gate, claim) runs.
 *
 * Every test creates its own products/promos, so stock and usage numbers are
 * exact. Everything created is removed afterwards.
 */

vi.mock("#root/backend/orders/bosta/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#root/backend/orders/bosta/service")>();
  return {
    ...actual,
    createBostaDelivery: vi.fn(async () => ({
      success: true as const,
      result: {
        deliveryId: `dlv-${Math.random().toString(36).slice(2)}`,
        trackingNumber: `${Math.floor(Math.random() * 1e9)}`,
        stateCode: 10,
        stateValue: "Pickup requested",
      },
    })),
  };
});

vi.mock("#root/backend/orders/bosta/dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#root/backend/orders/bosta/dispatch")>();
  return { ...actual, dispatchOrderToBosta: vi.fn(actual.dispatchOrderToBosta) };
});

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

describeIfDb("payment-attempt-first online checkout (integration)", () => {
  let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
  let schema: typeof import("#root/shared/database/drizzle/schema");
  let dbModule: typeof import("#root/shared/database/drizzle/db");
  let attempts: typeof import("#root/backend/payments/payment-attempts/service");
  let webhook: typeof import("#root/backend/payments/fawaterak-webhook");
  let orders: typeof import("#root/backend/orders/create-order/service");
  let viewOrdersModule: typeof import("#root/backend/orders/view-orders/service");
  let statusModule: typeof import("#root/backend/orders/update-order-status/service");
  let holdModule: typeof import("#root/backend/orders/fulfillment-hold/service");
  let editModule: typeof import("#root/backend/orders/edit-order/service");
  let referenceModule: typeof import("#root/backend/orders/order-reference");
  let paymentRouter: typeof import("#root/backend/payments/trpc").paymentRouter;
  let utils: typeof import("./fawaterak-test-utils");
  let emailModule: typeof import("#root/shared/email/service");
  let dispatchMock: ReturnType<typeof vi.fn>;
  let createBostaMock: ReturnType<typeof vi.fn>;
  let v7: () => string;
  let originalShippingFee: string | null = null;

  const tag = Date.now().toString(36);
  const ids = {
    file: "",
    vendor: "",
    category: "",
    products: [] as string[],
    promos: [] as string[],
    orders: [] as string[],
    attempts: [] as string[],
    carts: [] as string[],
  };

  // ── Fawaterak stub ────────────────────────────────────────────────────────
  /** intent_key → what getTransactionData returns. */
  const providerTx = new Map<string, Record<string, unknown>>();
  const createRequests: Array<Record<string, unknown>> = [];
  let failCreate = false;
  let nextTxn = 900_000;

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/oauth/token")) {
      return json({ token_type: "Bearer", access_token: "test-token", expires_in: 3600 });
    }
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (url.endsWith("/api/v3/createTransaction")) {
      createRequests.push(body);
      if (failCreate) return json({ status: "error", message: "Gateway unavailable" }, 503);
      const intentKey = randomUUID();
      providerTx.set(intentKey, {
        intent_key: intentKey,
        paid: 0,
        status_text: "pending",
        total: body.cartTotal,
        currency: "EGP",
        pay_load: body.pay_load,
        transaction_id: 0,
      });
      return json({
        status: "success",
        data: { intent_key: intentKey, url: `https://fawaterak.test/pay/${intentKey.slice(0, 8)}`, expires_in: 1 },
      });
    }
    if (url.endsWith("/api/v3/getTransactionData")) {
      const tx = providerTx.get(String(body.intent_key));
      if (!tx) return json({ status: "error", message: "not found" }, 404);
      return json({ status: "success", data: tx });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  // ── Email spy ─────────────────────────────────────────────────────────────
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  let emailSpy: import("#root/shared/email/service").EmailServiceInterface;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const silentLog = { info: () => {}, warn: () => {}, error: () => {} };
  const email = `attempt-${tag}@example.invalid`;

  async function mkProduct(stock: number, price = "100.00") {
    const id = v7();
    ids.products.push(id);
    await db.insert(schema.product).values({
      id,
      name: `PA Product ${id.slice(-6)}`,
      slug: `pa-${id}`,
      description: "d",
      price,
      imageId: ids.file,
      categoryId: ids.category,
      vendorId: ids.vendor,
      stock,
    });
    return id;
  }

  async function mkPromo(opts: { usageLimit?: number | null; usageLimitPerUser?: number | null; value?: string }) {
    const id = v7();
    ids.promos.push(id);
    await db.insert(schema.promoCode).values({
      id,
      code: `PA${id.slice(-8).toUpperCase()}`,
      discountType: "fixed_amount",
      discountValue: opts.value ?? "10",
      status: "active",
      appliesToAllProducts: true,
      usageLimit: opts.usageLimit ?? null,
      usageLimitPerUser: opts.usageLimitPerUser ?? null,
    });
    return id;
  }

  async function mkCart() {
    const token = `pa-cart-${randomUUID()}`;
    const [row] = await db
      .insert(schema.capturedCart)
      .values({ sessionToken: token, email, items: [], subtotal: "0" })
      .returning({ id: schema.capturedCart.id });
    ids.carts.push(row!.id);
    return token;
  }

  function checkoutInput(
    lines: Array<[string, number]>,
    extra: Partial<{ promoCodeId: string; cartSessionToken: string; customerEmail: string }> = {},
  ) {
    return {
      customerName: "Attempt Test",
      customerEmail: extra.customerEmail ?? email,
      customerPhone: "01000000000",
      shippingAddress: "1 Test St",
      shippingCity: "Nasr City",
      shippingState: "Cairo",
      shippingPostalCode: "11511",
      shippingCountry: "Egypt",
      items: lines.map(([productId, quantity]) => ({ productId, quantity })),
      paymentMethod: "fawaterak" as const,
      ...(extra.promoCodeId ? { promoCodeId: extra.promoCodeId } : {}),
      ...(extra.cartSessionToken ? { cartSessionToken: extra.cartSessionToken } : {}),
    };
  }

  async function start(
    lines: Array<[string, number]>,
    extra: Parameters<typeof checkoutInput>[1] = {},
  ) {
    const parsed = attempts.startCheckoutSchema.parse(checkoutInput(lines, extra));
    const result = await attempts.startOnlineCheckout(db as never, parsed);
    ids.attempts.push(result.attemptId);
    return result;
  }

  async function attemptRow(id: string) {
    const [row] = await db.select().from(schema.paymentAttempt).where(eq(schema.paymentAttempt.id, id));
    return row!;
  }

  /** Fawaterak marks the attempt's transaction paid (what getTransactionData will report). */
  async function providerPays(attemptId: string, overrides: Record<string, unknown> = {}) {
    const row = await attemptRow(attemptId);
    const txn = nextTxn++;
    providerTx.set(row.intentKey!, {
      intent_key: row.intentKey,
      transaction_id: txn,
      paid: 1,
      paid_at: "2026-10-07 12:00:00",
      status_text: "paid",
      total: row.total,
      currency: "EGP",
      payment_method: "Visa-Mastercard",
      pay_load: { orderId: attemptId },
      ...overrides,
    });
    return { intentKey: row.intentKey!, txn };
  }

  function paidWebhookBody(intentKey: string, attemptId: string, txn: number) {
    const fields = { transaction_id: txn, transaction_key: intentKey, payment_method: "Visa-Mastercard" };
    return {
      ...fields,
      status: "paid",
      pay_load: JSON.stringify({ orderId: attemptId }),
      transactionHashKey: utils.signPaid(fields),
    };
  }

  const deps = () => webhook.buildFawaterakWebhookDeps(db as never, silentLog);

  async function sendPaidWebhook(attemptId: string, intentKey: string, txn: number) {
    return webhook.processFawaterakPaidWebhook(paidWebhookBody(intentKey, attemptId, txn), deps());
  }

  function caller() {
    return paymentRouter.createCaller({
      db: db as never,
      clientSession: null as never,
      emailService: null as never,
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    } as never);
  }

  async function browserVerify(attemptId: string) {
    const res = await caller().attemptStatus({ attemptId });
    if (!res.success) throw new Error(String(res.error));
    return res.result;
  }

  async function ordersWithId(id: string) {
    return db.select().from(schema.order).where(eq(schema.order.id, id));
  }
  async function stockOf(productId: string) {
    const [row] = await db.select({ stock: schema.product.stock }).from(schema.product).where(eq(schema.product.id, productId));
    return row!.stock;
  }
  async function promoOf(promoId: string) {
    const [row] = await db.select().from(schema.promoCode).where(eq(schema.promoCode.id, promoId));
    return row!;
  }
  const emailsTo = (to: string) => sent.filter((m) => m.to === to);
  const dispatchCallsFor = (orderId: string) =>
    dispatchMock.mock.calls.filter((c) => c[1] === orderId);

  // ── Setup / teardown ──────────────────────────────────────────────────────

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    process.env.SYN_BOSTA_KEY = "test-bosta-key";
    delete process.env.FINCART_ENABLED;

    utils = await import("./fawaterak-test-utils");
    utils.setFawaterakEnv();
    vi.stubGlobal("fetch", fetchStub);

    const { drizzle } = await import("drizzle-orm/node-postgres");
    schema = await import("#root/shared/database/drizzle/schema");
    dbModule = await import("#root/shared/database/drizzle/db");
    db = drizzle(TEST_DB_URL!, { schema });
    attempts = await import("#root/backend/payments/payment-attempts/service");
    webhook = await import("#root/backend/payments/fawaterak-webhook");
    orders = await import("#root/backend/orders/create-order/service");
    viewOrdersModule = await import("#root/backend/orders/view-orders/service");
    statusModule = await import("#root/backend/orders/update-order-status/service");
    holdModule = await import("#root/backend/orders/fulfillment-hold/service");
    editModule = await import("#root/backend/orders/edit-order/service");
    referenceModule = await import("#root/backend/orders/order-reference");
    ({ paymentRouter } = await import("#root/backend/payments/trpc"));
    emailModule = await import("#root/shared/email/service");
    dispatchMock = vi.mocked((await import("#root/backend/orders/bosta/dispatch")).dispatchOrderToBosta) as never;
    createBostaMock = vi.mocked((await import("#root/backend/orders/bosta/service")).createBostaDelivery) as never;
    ({ v7 } = await import("uuid"));

    emailSpy = {
      sendEmail: (to: string, subject: string, html: string) =>
        Effect.sync(() => {
          sent.push({ to, subject, html });
          return { success: true };
        }),
    };
    attempts.__setPaymentAttemptEmailService(emailSpy);

    const liveOffers = await db
      .select({ id: schema.cartOffer.id })
      .from(schema.cartOffer)
      .where(eq(schema.cartOffer.isActive, true));
    if (liveOffers.length > 0) {
      throw new Error("Test database has active cart offers; use a clean database");
    }

    // Expected totals below assume an 85 EGP shipping fee.
    const [settings] = await db.select({ fee: schema.storeSettings.shippingFee }).from(schema.storeSettings);
    originalShippingFee = settings?.fee ?? null;
    await db.update(schema.storeSettings).set({ shippingFee: "85.00" });

    ids.file = v7();
    await db.insert(schema.file).values({ id: ids.file, diskname: "pa.jpg" });
    ids.vendor = v7();
    await db.insert(schema.vendor).values({ id: ids.vendor, name: "PA Vendor" });
    ids.category = v7();
    await db.insert(schema.category).values({ id: ids.category, name: "PA Cat", slug: `pa-cat-${ids.category}` });
  });

  beforeEach(() => {
    sent.length = 0;
    failCreate = false;
    dispatchMock.mockClear();
    createBostaMock.mockClear();
  });

  afterAll(async () => {
    if (!db) return;
    attempts?.__setPaymentAttemptEmailService(null);
    const orderIds = [
      ...ids.orders,
      ...(ids.attempts.length
        ? (
            await db
              .select({ id: schema.order.id })
              .from(schema.order)
              .where(inArray(schema.order.id, ids.attempts))
          ).map((r) => r.id)
        : []),
    ];
    if (ids.carts.length) await db.delete(schema.capturedCart).where(inArray(schema.capturedCart.id, ids.carts));
    const refOwners = [...ids.attempts, ...ids.orders];
    if (refOwners.length) {
      await db.delete(schema.orderReference).where(inArray(schema.orderReference.ownerId, refOwners));
    }
    if (ids.attempts.length) await db.delete(schema.paymentAttempt).where(inArray(schema.paymentAttempt.id, ids.attempts));
    if (orderIds.length) {
      await db.delete(schema.orderLog).where(inArray(schema.orderLog.orderId, orderIds));
      await db.delete(schema.orderItem).where(inArray(schema.orderItem.orderId, orderIds));
      await db.delete(schema.order).where(inArray(schema.order.id, orderIds));
    }
    if (ids.promos.length) await db.delete(schema.promoCode).where(inArray(schema.promoCode.id, ids.promos));
    if (ids.products.length) await db.delete(schema.product).where(inArray(schema.product.id, ids.products));
    if (ids.category) await db.delete(schema.category).where(eq(schema.category.id, ids.category));
    if (ids.vendor) await db.delete(schema.vendor).where(eq(schema.vendor.id, ids.vendor));
    if (ids.file) await db.delete(schema.file).where(eq(schema.file.id, ids.file));
    if (originalShippingFee !== null) {
      await db.update(schema.storeSettings).set({ shippingFee: originalShippingFee });
    }
    vi.unstubAllGlobals();
    utils?.clearFawaterakEnv();
    delete process.env.SYN_BOSTA_KEY;
  });

  // ── A. COD unchanged ──────────────────────────────────────────────────────

  it("A. COD still creates the order immediately (stock, promo, emails, Bosta at checkout)", async () => {
    const productId = await mkProduct(10);
    const promoId = await mkPromo({ usageLimit: 5 });
    const result = await Effect.runPromise(
      orders
        .createOrder({ ...checkoutInput([[productId, 2]], { promoCodeId: promoId }), paymentMethod: "cod" })
        .pipe(
          Effect.provideService(dbModule.DatabaseClientService, db as never),
          Effect.provideService(emailModule.EmailService, emailSpy),
        ),
    );
    ids.orders.push(result.id);

    const [row] = await ordersWithId(result.id);
    expect(row?.paymentMethod).toBe("cod");
    expect(row?.paymentStatus).toBe("not_required");
    expect(row?.total).toBe("275.00"); // 200 - 10 promo + 85 shipping
    expect(await stockOf(productId)).toBe(8);
    expect((await promoOf(promoId)).usedCount).toBe(1);
    expect(emailsTo(email)).toHaveLength(1);
    expect(dispatchCallsFor(result.id)).toHaveLength(1);
    expect(dispatchCallsFor(result.id)[0]?.[2]).toEqual({ trigger: "checkout_cod" });
    // No payment attempt is involved in COD.
    expect(
      await db.select().from(schema.paymentAttempt).where(eq(schema.paymentAttempt.id, result.id)),
    ).toHaveLength(0);
  });

  it("A2. order.create refuses fawaterak — an online checkout can never create an unpaid order", async () => {
    const productId = await mkProduct(10);
    const result = await Effect.runPromise(
      Effect.either(
        orders
          .createOrder(checkoutInput([[productId, 1]]))
          .pipe(
            Effect.provideService(dbModule.DatabaseClientService, db as never),
            Effect.provideService(emailModule.EmailService, emailSpy),
          ),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(await stockOf(productId)).toBe(10);
    expect(sent).toHaveLength(0);
  });

  // ── B–F. attempt, no order ────────────────────────────────────────────────

  it("B–F, Q. online submit creates one attempt and ZERO orders, consumes nothing, sends nothing, charges the snapshot", async () => {
    const productId = await mkProduct(10, "150.00");
    const promoId = await mkPromo({ usageLimit: 3 });
    const token = await mkCart();
    const before = createRequests.length;

    const result = await start([[productId, 2]], { promoCodeId: promoId, cartSessionToken: token });
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") throw new Error();
    expect(result.paymentUrl).toMatch(/^https:\/\/fawaterak\.test\/pay\//);

    const row = await attemptRow(result.attemptId);
    expect(row.status).toBe("pending");
    expect(row.total).toBe("375.00"); // 300 - 10 + 85
    expect(row.intentKey).toBeTruthy();
    expect(row.orderId).toBeNull();

    // B: zero orders
    expect(await ordersWithId(result.attemptId)).toHaveLength(0);
    // C: zero stock
    expect(await stockOf(productId)).toBe(10);
    // D: zero promo usage
    expect((await promoOf(promoId)).usedCount).toBe(0);
    // E: zero emails
    expect(sent).toHaveLength(0);
    // F: Bosta never touched
    expect(dispatchMock).not.toHaveBeenCalled();
    // Cart not converted
    const [cart] = await db.select().from(schema.capturedCart).where(eq(schema.capturedCart.sessionToken, token));
    expect(cart?.convertedOrderId).toBeNull();

    // Q: the provider was asked for exactly the frozen total, referenced by
    // the attempt id in the same UUID-shaped positions as before.
    expect(createRequests.length).toBe(before + 1);
    const req = createRequests.at(-1)!;
    expect(req.cartTotal).toBe("375.00");
    expect(req.pay_load).toEqual({ orderId: result.attemptId });
    // tr_number is the attempt's registered unique reference (random tail of the id).
    expect(row.reference).toBe(`ORD-${result.attemptId.replace(/-/g, "").slice(-8).toUpperCase()}`);
    expect(req.tr_number).toBe(row.reference);
    const [registered] = await db
      .select()
      .from(schema.orderReference)
      .where(eq(schema.orderReference.reference, row.reference!));
    expect(registered).toMatchObject({ kind: "attempt", ownerId: result.attemptId });
    expect((req.customer as Record<string, unknown>).customer_unique_id).toBe(result.attemptId);
    const urls = req.redirectionUrls as Record<string, string>;
    expect(urls.successUrl).toContain(`attempt=${result.attemptId}`);
    expect(urls.successUrl).not.toContain("id=");
    expect(urls.successUrl).not.toContain("email=");

    // The customer-facing status exposes no order before payment.
    const status = await browserVerify(result.attemptId);
    expect(status.status).toBe("pending");
    expect(status.order).toBeNull();
  });

  // ── G, P. paid webhook (browser never returns) ───────────────────────────

  it("G, P, T, AG, V. paid webhook alone creates exactly one paid order and runs every post-order effect once", async () => {
    const productId = await mkProduct(10, "150.00");
    const promoId = await mkPromo({ usageLimit: 3 });
    const token = await mkCart();
    const r = await start([[productId, 3]], { promoCodeId: promoId, cartSessionToken: token });
    const { intentKey, txn } = await providerPays(r.attemptId);

    const outcome = await sendPaidWebhook(r.attemptId, intentKey, txn);
    expect(outcome.statusCode).toBe(200);
    expect(outcome.body.result).toBe("paid");

    const [o] = await ordersWithId(r.attemptId);
    expect(o?.paymentStatus).toBe("paid");
    expect(o?.status).toBe("processing");
    expect(o?.paymentMethod).toBe("fawaterak");
    expect(o?.paymentSessionId).toBe(intentKey);
    expect(o?.paymentTransactionId).toBe(String(txn));
    expect(o?.total).toBe("525.00"); // 450 - 10 + 85
    expect(o?.discount).toBe("10.00");
    expect(o?.promoCodeId).toBe(promoId);
    expect(o?.fulfillmentHold).toBeNull();

    const items = await db.select().from(schema.orderItem).where(eq(schema.orderItem.orderId, r.attemptId));
    expect(items).toHaveLength(1);
    expect(items[0]?.quantity).toBe(3);
    expect(items[0]?.price).toBe("150.00");

    const att = await attemptRow(r.attemptId);
    expect(att.status).toBe("materialized");
    expect(att.orderId).toBe(r.attemptId);
    expect(att.effectsClaimedAt).not.toBeNull();

    // T: stock decremented once, atomically
    expect(await stockOf(productId)).toBe(7);
    // S: promo usage recorded at materialization
    expect((await promoOf(promoId)).usedCount).toBe(1);
    // AG: confirmation email to the customer + admin email(s), once
    expect(emailsTo(email)).toHaveLength(1);
    expect(emailsTo(email)[0]?.subject).toMatch(/Order Confirmation/);
    // V: Bosta only now, once, via the payment-confirmed path
    expect(dispatchCallsFor(r.attemptId)).toHaveLength(1);
    expect(dispatchCallsFor(r.attemptId)[0]?.[2]).toEqual({ trigger: "payment_confirmed" });
    expect(createBostaMock).toHaveBeenCalledTimes(1);
    // Cart conversion happens server-side at paid time
    const [cart] = await db.select().from(schema.capturedCart).where(eq(schema.capturedCart.sessionToken, token));
    expect(cart?.convertedOrderId).toBe(r.attemptId);
    // Audit trail written with the order
    const log = await db.select().from(schema.orderLog).where(eq(schema.orderLog.orderId, r.attemptId));
    expect(log.map((l) => l.action).sort()).toEqual(
      expect.arrayContaining(["created", "payment_confirmed", "bosta_sent"]),
    );

    // The customer now sees the real order.
    const status = await browserVerify(r.attemptId);
    expect(status.status).toBe("materialized");
    expect(status.order?.id).toBe(r.attemptId);
    expect(status.order?.onHold).toBe(false);
  });

  // ── H, I, J. verify / webhook / duplicates ───────────────────────────────

  it("H, I. browser verify first creates the order; the later webhook is already_materialized (one order)", async () => {
    const productId = await mkProduct(5);
    const r = await start([[productId, 1]]);
    const { intentKey, txn } = await providerPays(r.attemptId);

    const status = await browserVerify(r.attemptId);
    expect(status.status).toBe("materialized");
    expect(status.order?.id).toBe(r.attemptId);

    const outcome = await sendPaidWebhook(r.attemptId, intentKey, txn);
    expect(outcome.statusCode).toBe(200);
    expect(outcome.body.result).toBe("already_materialized");

    expect(await ordersWithId(r.attemptId)).toHaveLength(1);
    expect(await stockOf(productId)).toBe(4);
    expect(emailsTo(email)).toHaveLength(1);
    expect(dispatchCallsFor(r.attemptId)).toHaveLength(1);
  });

  it("I2, J. webhook first, then browser verify, then the same webhook twice more → still one order", async () => {
    const productId = await mkProduct(5);
    const promoId = await mkPromo({});
    const r = await start([[productId, 2]], { promoCodeId: promoId });
    const { intentKey, txn } = await providerPays(r.attemptId);

    expect((await sendPaidWebhook(r.attemptId, intentKey, txn)).body.result).toBe("paid");
    expect((await browserVerify(r.attemptId)).order?.id).toBe(r.attemptId);
    expect((await sendPaidWebhook(r.attemptId, intentKey, txn)).body.result).toBe("already_materialized");
    expect((await sendPaidWebhook(r.attemptId, intentKey, txn)).body.result).toBe("already_materialized");

    expect(await ordersWithId(r.attemptId)).toHaveLength(1);
    expect(await stockOf(productId)).toBe(3);
    expect((await promoOf(promoId)).usedCount).toBe(1);
    expect(emailsTo(email)).toHaveLength(1);
    expect(dispatchCallsFor(r.attemptId)).toHaveLength(1);
  });

  it("K. concurrent paid finalization (webhooks + polls + sweep in parallel) → exactly one order, one stock decrement, one promo use, effects once", async () => {
    const productId = await mkProduct(20);
    const promoId = await mkPromo({ usageLimit: 10 });
    const r = await start([[productId, 4]], { promoCodeId: promoId });
    const { intentKey, txn } = await providerPays(r.attemptId);

    const results = await Promise.all([
      sendPaidWebhook(r.attemptId, intentKey, txn),
      sendPaidWebhook(r.attemptId, intentKey, txn),
      browserVerify(r.attemptId),
      sendPaidWebhook(r.attemptId, intentKey, txn),
      browserVerify(r.attemptId),
      attempts.checkProviderAndFinalize(db as never, await attemptRow(r.attemptId)),
      sendPaidWebhook(r.attemptId, intentKey, txn),
      browserVerify(r.attemptId),
    ]);

    const webhookResults = [results[0], results[1], results[3], results[6]] as Array<{ body: { result?: unknown } }>;
    expect(webhookResults.filter((w) => w.body.result === "paid").length).toBeLessThanOrEqual(1);
    expect(await ordersWithId(r.attemptId)).toHaveLength(1);
    expect(
      await db.select().from(schema.orderItem).where(eq(schema.orderItem.orderId, r.attemptId)),
    ).toHaveLength(1);
    expect(await stockOf(productId)).toBe(16);
    expect((await promoOf(promoId)).usedCount).toBe(1);
    expect(emailsTo(email)).toHaveLength(1);
    expect(dispatchCallsFor(r.attemptId)).toHaveLength(1);
    const createdLogs = (
      await db.select().from(schema.orderLog).where(eq(schema.orderLog.orderId, r.attemptId))
    ).filter((l) => l.action === "created");
    expect(createdLogs).toHaveLength(1);
  });

  // ── L, M, N. no order without payment ────────────────────────────────────

  it("L. failed payment → no order, nothing consumed; the same hosted transaction paying later still creates one order", async () => {
    const productId = await mkProduct(5);
    const promoId = await mkPromo({ usageLimit: 1 });
    const r = await start([[productId, 1]], { promoCodeId: promoId });
    const row = await attemptRow(r.attemptId);

    const failFields = { transaction_id: 7001, transaction_key: row.intentKey!, payment_method: "Visa-Mastercard" };
    const failed = await webhook.processFawaterakFailedWebhook(
      {
        ...failFields,
        pay_load: JSON.stringify({ orderId: r.attemptId }),
        errorMessage: "Declined",
        hashKey: utils.signPaid(failFields),
      },
      deps(),
    );
    expect(failed.statusCode).toBe(200);
    expect((await attemptRow(r.attemptId)).status).toBe("failed");
    expect(await ordersWithId(r.attemptId)).toHaveLength(0);
    expect(await stockOf(productId)).toBe(5);
    expect((await promoOf(promoId)).usedCount).toBe(0);
    expect(sent).toHaveLength(0);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect((await browserVerify(r.attemptId)).order).toBeNull();

    // "failed" is not terminal — the customer retries on the same hosted page.
    await providerPays(r.attemptId);
    const status = await browserVerify(r.attemptId); // the poll checks failed attempts too
    expect(status.status).toBe("materialized");
    expect(await ordersWithId(r.attemptId)).toHaveLength(1);
    expect(await stockOf(productId)).toBe(4);
    expect((await promoOf(promoId)).usedCount).toBe(1);
  });

  it("M. cancelled and provider-EXPIRED webhooks → no order; recorded as cancelled / expired", async () => {
    for (const providerStatus of ["CANCELLED", "EXPIRED"]) {
      const productId = await mkProduct(5);
      const r = await start([[productId, 1]]);
      const row = await attemptRow(r.attemptId);
      const out = await webhook.processFawaterakCancelWebhook(
        {
          referenceId: 5544,
          paymentMethod: "Fawry",
          status: providerStatus,
          transactionKey: row.intentKey,
          pay_load: JSON.stringify({ orderId: r.attemptId }),
          hashKey: utils.signCancel({ referenceId: 5544, paymentMethod: "Fawry" }),
        },
        deps(),
      );
      expect(out.statusCode).toBe(200);
      expect((await attemptRow(r.attemptId)).status).toBe(providerStatus === "EXPIRED" ? "expired" : "cancelled");
      expect(await ordersWithId(r.attemptId)).toHaveLength(0);
      expect(await stockOf(productId)).toBe(5);
    }
    expect(sent).toHaveLength(0);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("M2. a failed/cancel webhook can never downgrade a paid attempt", async () => {
    const productId = await mkProduct(5);
    const r = await start([[productId, 1]]);
    const { intentKey, txn } = await providerPays(r.attemptId);
    await sendPaidWebhook(r.attemptId, intentKey, txn);

    const failFields = { transaction_id: txn, transaction_key: intentKey, payment_method: "Visa-Mastercard" };
    const out = await webhook.processFawaterakFailedWebhook(
      { ...failFields, pay_load: JSON.stringify({ orderId: r.attemptId }), hashKey: utils.signPaid(failFields) },
      deps(),
    );
    expect(out.body.result).toBe("already_paid");
    expect((await attemptRow(r.attemptId)).status).toBe("materialized");
    expect(await attempts.recordAttemptOutcome(db as never, r.attemptId, "cancelled", { gatewayData: {} })).toBe(false);
    expect((await attemptRow(r.attemptId)).status).toBe("materialized");
  });

  it("N. Fawaterak createTransaction failure → no order, nothing consumed, retryable error, attempt kept as session_failed", async () => {
    const productId = await mkProduct(5);
    const promoId = await mkPromo({ usageLimit: 1 });
    const token = await mkCart();
    failCreate = true;
    const parsed = attempts.startCheckoutSchema.parse(
      checkoutInput([[productId, 2]], { promoCodeId: promoId, cartSessionToken: token }),
    );
    const error = await attempts.startOnlineCheckout(db as never, parsed).catch((e: unknown) => e);
    expect((error as { clientMessage?: string }).clientMessage).toMatch(/Nothing was charged/);

    const failedRows = await db
      .select()
      .from(schema.paymentAttempt)
      .where(eq(schema.paymentAttempt.cartSessionToken, token));
    expect(failedRows).toHaveLength(1);
    ids.attempts.push(failedRows[0]!.id);
    expect(failedRows[0]?.status).toBe("session_failed");
    expect(failedRows[0]?.intentKey).toBeNull();
    expect(await ordersWithId(failedRows[0]!.id)).toHaveLength(0);
    expect(await stockOf(productId)).toBe(5);
    expect((await promoOf(promoId)).usedCount).toBe(0);
    expect(sent).toHaveLength(0);
    expect(dispatchMock).not.toHaveBeenCalled();

    // Retry works and opens a fresh attempt (a session_failed one is never resumed).
    failCreate = false;
    const retry = await start([[productId, 2]], { promoCodeId: promoId, cartSessionToken: token });
    expect(retry.kind).toBe("redirect");
    expect(retry.attemptId).not.toBe(failedRows[0]!.id);
  });

  // ── R. retry / resume ─────────────────────────────────────────────────────

  it("R. resubmitting the same checkout resumes the open attempt (no second payable intent); a changed cart opens a new one", async () => {
    const productId = await mkProduct(10);
    const token = await mkCart();
    const first = await start([[productId, 1]], { cartSessionToken: token });
    const creates = createRequests.length;

    const again = await start([[productId, 1]], { cartSessionToken: token });
    expect(again.attemptId).toBe(first.attemptId);
    expect(again.kind === "redirect" && again.resumed).toBe(true);
    expect(createRequests.length).toBe(creates);

    // Resuming after a failed try on the hosted page also reuses it.
    await attempts.recordAttemptOutcome(db as never, first.attemptId, "failed", { gatewayData: {} });
    const afterFail = await start([[productId, 1]], { cartSessionToken: token });
    expect(afterFail.attemptId).toBe(first.attemptId);

    const changed = await start([[productId, 2]], { cartSessionToken: token });
    expect(changed.attemptId).not.toBe(first.attemptId);

    // Resuming an attempt that Fawaterak reports paid (lost webhook) finalizes
    // it instead of asking the customer to pay again.
    await providerPays(first.attemptId);
    const paid = await start([[productId, 1]], { cartSessionToken: token });
    expect(paid).toEqual({ kind: "already_paid", attemptId: first.attemptId });
    expect(await ordersWithId(first.attemptId)).toHaveLength(1);
    expect(await ordersWithId(changed.attemptId)).toHaveLength(0);
  });

  // ── Q, R/S. snapshot honored ──────────────────────────────────────────────

  it("Q. a price change while the customer is paying does not change the paid order", async () => {
    const productId = await mkProduct(10, "200.00");
    const r = await start([[productId, 1]]);
    await db.update(schema.product).set({ price: "999.00" }).where(eq(schema.product.id, productId));

    const { intentKey, txn } = await providerPays(r.attemptId);
    await sendPaidWebhook(r.attemptId, intentKey, txn);

    const [o] = await ordersWithId(r.attemptId);
    expect(o?.total).toBe("285.00");
    const [item] = await db.select().from(schema.orderItem).where(eq(schema.orderItem.orderId, r.attemptId));
    expect(item?.price).toBe("200.00");
  });

  it("Q2. a provider amount that differs from the snapshot never creates an order", async () => {
    const productId = await mkProduct(10, "200.00");
    const r = await start([[productId, 1]]);
    const { intentKey, txn } = await providerPays(r.attemptId, { total: "1.00" });
    const out = await sendPaidWebhook(r.attemptId, intentKey, txn);
    expect(out.body.result).toBe("ignored");
    expect(await ordersWithId(r.attemptId)).toHaveLength(0);
    expect((await attemptRow(r.attemptId)).status).toBe("pending");
    expect(await stockOf(productId)).toBe(10);
  });

  it("R/S. promo snapshot is honored after paid even when concurrent payments push usage past the limit (logged overage)", async () => {
    const productId = await mkProduct(10, "100.00");
    const promoId = await mkPromo({ usageLimit: 1, value: "20" });
    const a = await start([[productId, 1]], { promoCodeId: promoId, customerEmail: `a-${email}` });
    const b = await start([[productId, 1]], { promoCodeId: promoId, customerEmail: `b-${email}` });
    expect((await promoOf(promoId)).usedCount).toBe(0); // nothing reserved or consumed

    for (const id of [a.attemptId, b.attemptId]) {
      const { intentKey, txn } = await providerPays(id);
      await sendPaidWebhook(id, intentKey, txn);
    }
    const [oa] = await ordersWithId(a.attemptId);
    const [ob] = await ordersWithId(b.attemptId);
    expect(oa?.total).toBe("165.00");
    expect(ob?.total).toBe("165.00"); // charge honored, not re-priced
    expect(oa?.discount).toBe("20.00");
    expect(ob?.discount).toBe("20.00");
    const promo = await promoOf(promoId);
    expect(promo.usedCount).toBe(2);
    expect(promo.status).toBe("exhausted");

    const logs = await db
      .select()
      .from(schema.orderLog)
      .where(and(eq(schema.orderLog.orderId, b.attemptId), eq(schema.orderLog.action, "created")));
    expect(logs[0]?.note).toMatch(/PROMO OVERAGE/);
  });

  // ── U, V, W. stock conflict after paid ────────────────────────────────────

  it("U, V, W, AE. stock ran out while paying → paid order on fulfillment hold, no Bosta, no negative stock, release after restock", async () => {
    const productId = await mkProduct(2, "100.00");
    const r = await start([[productId, 2]]);
    // Someone else buys while this customer is on the payment page.
    await db.update(schema.product).set({ stock: 1 }).where(eq(schema.product.id, productId));

    const { intentKey, txn } = await providerPays(r.attemptId);
    const out = await sendPaidWebhook(r.attemptId, intentKey, txn);
    expect(out.statusCode).toBe(200);
    expect(out.body.held).toBe(true);

    const [o] = await ordersWithId(r.attemptId);
    expect(o?.paymentStatus).toBe("paid");
    expect(o?.status).toBe("pending");
    expect(o?.fulfillmentHold).toBe("stock_conflict");
    expect(o?.fulfillmentHoldNote).toMatch(/requested 2, available 1/);
    expect(o?.stockRestored).toBe(true);
    // W: no negative / no partial decrement
    expect(await stockOf(productId)).toBe(1);
    // V: Bosta never called for the held order
    expect(dispatchCallsFor(r.attemptId)).toHaveLength(0);
    // Customer: a truthful "payment received, under review" email — never the
    // normal Order Confirmation. Admins: the hold in the subject.
    expect(emailsTo(email)).toHaveLength(1);
    expect(emailsTo(email)[0]?.subject).toMatch(/Payment received, order #[0-9A-F]{8} under review/);
    expect(emailsTo(email)[0]?.subject).not.toMatch(/Order Confirmation/);
    expect(emailsTo(email)[0]?.html).toContain("Your order is currently under review.");
    expect(emailsTo(email)[0]?.html).toContain("contact you shortly regarding availability");
    expect(emailsTo(email)[0]?.html).not.toMatch(/processing your order|shipped|prepar/i);
    for (const m of sent.filter((x) => x.to !== email)) {
      expect(m.subject).toMatch(/PAID ORDER ON HOLD .* DO NOT PREPARE/);
      expect(m.html).toContain("DO NOT PREPARE · MANUAL REVIEW REQUIRED");
    }
    // The customer sees the real order, flagged as under review
    expect((await browserVerify(r.attemptId)).order?.onHold).toBe(true);

    // Even a manual Bosta send is refused while held.
    const { dispatchOrderToBosta } = await vi.importActual<typeof import("#root/backend/orders/bosta/dispatch")>(
      "#root/backend/orders/bosta/dispatch",
    );
    const manual = await dispatchOrderToBosta(db as never, r.attemptId, { trigger: "manual" });
    expect(manual).toMatchObject({ status: "blocked", code: "on_hold" });
    expect(createBostaMock).not.toHaveBeenCalled();

    // Status cannot move toward fulfillment while held.
    const adminSession = { id: "s", token: "t", email: "admin@example.invalid", name: "A", phone: "", expiresAt: new Date(Date.now() + 1e7), role: "admin" as const };
    const moved = await Effect.runPromise(
      Effect.either(
        statusModule
          .updateOrderStatus({ orderId: r.attemptId, status: "shipped" }, adminSession)
          .pipe(Effect.provideService(dbModule.DatabaseClientService, db as never)),
      ),
    );
    expect(moved._tag).toBe("Left");

    // Release refuses while stock is still short …
    await expect(
      holdModule.releaseFulfillmentHold(db as never, r.attemptId, { id: null, email: "admin@example.invalid" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await stockOf(productId)).toBe(1);

    // … and after restock commits the stock once and ships normally.
    await db.update(schema.product).set({ stock: 5 }).where(eq(schema.product.id, productId));
    const released = await holdModule.releaseFulfillmentHold(db as never, r.attemptId, {
      id: null,
      email: "admin@example.invalid",
    });
    expect(released.released).toBe(true);
    const [after] = await ordersWithId(r.attemptId);
    expect(after?.fulfillmentHold).toBeNull();
    expect(after?.status).toBe("processing");
    expect(after?.stockRestored).toBe(false);
    expect(await stockOf(productId)).toBe(3);
    expect(dispatchCallsFor(r.attemptId)).toHaveLength(1);
  });

  it("U2, W2. a held order can't be edited, and cancelling it gives back no stock it never took", async () => {
    const productId = await mkProduct(1, "100.00");
    const r = await start([[productId, 1]]);
    await db.update(schema.product).set({ stock: 0 }).where(eq(schema.product.id, productId));
    const { intentKey, txn } = await providerPays(r.attemptId);
    await sendPaidWebhook(r.attemptId, intentKey, txn);
    expect((await ordersWithId(r.attemptId))[0]?.fulfillmentHold).toBe("stock_conflict");

    const adminSession = { id: "s", token: "t", email: "admin@example.invalid", name: "A", phone: "", expiresAt: new Date(Date.now() + 1e7), role: "admin" as const };
    const provide = <A, E>(e: Effect.Effect<A, E, import("#root/shared/database/drizzle/db").DatabaseClientService>) =>
      Effect.runPromise(Effect.either(e.pipe(Effect.provideService(dbModule.DatabaseClientService, db as never))));

    // Internal notes are the one thing an admin may edit on a held order …
    const noted = await provide(
      editModule.editOrder({ orderId: r.attemptId, notes: "Called customer — restock Thursday" } as never, adminSession),
    );
    expect(noted._tag).toBe("Right");
    const [afterNote] = await ordersWithId(r.attemptId);
    expect(afterNote?.notes).toBe("Called customer — restock Thursday");
    expect(afterNote?.fulfillmentHold).toBe("stock_conflict");
    expect(afterNote?.total).toBe("185.00");
    expect(afterNote?.status).toBe("pending");
    // … anything else (items, status, money, address) is still refused.
    const [line] = await db.select().from(schema.orderItem).where(eq(schema.orderItem.orderId, r.attemptId));
    for (const forbidden of [
      { orderId: r.attemptId, notes: "x", items: [{ orderItemId: line!.id, quantity: 2 }] },
      { orderId: r.attemptId, status: "processing" },
      { orderId: r.attemptId, total: 1 },
      { orderId: r.attemptId, notes: "x", shippingAddress: "elsewhere" },
    ]) {
      const refused = await provide(editModule.editOrder(forbidden as never, adminSession));
      expect(refused._tag).toBe("Left");
    }
    expect(await stockOf(productId)).toBe(0);

    const cancelled = await provide(
      statusModule.updateOrderStatus({ orderId: r.attemptId, status: "cancelled" }, adminSession),
    );
    expect(cancelled._tag).toBe("Right");
    expect((await ordersWithId(r.attemptId))[0]?.status).toBe("cancelled");
    expect(await stockOf(productId)).toBe(0); // not inflated to 1
  });

  it("S2. a promo deleted while the customer pays: discount honored, order created, audit note recorded", async () => {
    const productId = await mkProduct(5, "100.00");
    const promoId = await mkPromo({ value: "15" });
    const r = await start([[productId, 1]], { promoCodeId: promoId });
    await db.delete(schema.promoCode).where(eq(schema.promoCode.id, promoId));
    const { intentKey, txn } = await providerPays(r.attemptId);
    await sendPaidWebhook(r.attemptId, intentKey, txn);

    const [o] = await ordersWithId(r.attemptId);
    expect(o?.total).toBe("170.00");
    expect(o?.discount).toBe("15.00");
    expect(o?.promoCodeId).toBeNull();
    const [log] = await db
      .select()
      .from(schema.orderLog)
      .where(and(eq(schema.orderLog.orderId, r.attemptId), eq(schema.orderLog.action, "created")));
    expect(log?.note).toMatch(/was deleted before payment completed/);
  });

  // ── Hardening: unique references ──────────────────────────────────────────

  /** UUIDv7-shaped id with a chosen random tail (last 8 hex chars). */
  const idWithTail = (tail: string) => {
    const base = v7().replace(/-/g, "");
    const hex = `${base.slice(0, 24)}${tail.toLowerCase()}`;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  it("REF-1. attempts created in the same millisecond get distinct references (the legacy prefix would collide)", async () => {
    const productId = await mkProduct(50);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => start([[productId, 1]], { customerEmail: `ref${i}-${email}` })),
    );
    const rows = await db
      .select({ id: schema.paymentAttempt.id, reference: schema.paymentAttempt.reference })
      .from(schema.paymentAttempt)
      .where(inArray(schema.paymentAttempt.id, results.map((r) => r.attemptId)));
    const refs = rows.map((r) => r.reference);
    expect(new Set(refs).size).toBe(12);
    for (const r of refs) expect(r).toMatch(/^ORD-[0-9A-F]{8}$/);
    // The old derivation (timestamp prefix) collides for ids this close together.
    const legacy = rows.map((r) => `ORD-${r.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`);
    expect(new Set(legacy).size).toBeLessThan(12);
  });

  it("REF-2. a reference collision is rejected by the registry and a new id is drawn (DB-enforced)", async () => {
    const productId = await mkProduct(10);
    const tail = randomUUID().replace(/-/g, "").slice(-8);
    const first = idWithTail(tail);
    const clash = idWithTail(tail); // different id, same reference
    const fresh = v7();
    const queue = [first, clash, fresh];
    const draw = () => queue.shift()!;

    const parsedA = attempts.startCheckoutSchema.parse(checkoutInput([[productId, 1]], { customerEmail: `refa-${email}` }));
    const a = await attempts.startOnlineCheckout(db as never, parsedA, undefined, undefined, { newId: draw });
    ids.attempts.push(a.attemptId);
    const parsedB = attempts.startCheckoutSchema.parse(checkoutInput([[productId, 1]], { customerEmail: `refb-${email}` }));
    const b = await attempts.startOnlineCheckout(db as never, parsedB, undefined, undefined, { newId: draw });
    ids.attempts.push(b.attemptId);

    expect(a.attemptId).toBe(first);
    expect(b.attemptId).toBe(fresh); // `clash` was refused
    const refs = await db
      .select({ reference: schema.paymentAttempt.reference })
      .from(schema.paymentAttempt)
      .where(inArray(schema.paymentAttempt.id, [a.attemptId, b.attemptId]));
    expect(new Set(refs.map((r) => r.reference)).size).toBe(2);
    expect(queue).toHaveLength(0);
  });

  it("REF-3. a new reference can never equal a legacy order's existing number (registry reserves legacy numbers)", async () => {
    // A legacy order (pre-0059): no stored reference; its number is its id prefix.
    const legacyId = v7();
    ids.orders.push(legacyId);
    await db.insert(schema.order).values({
      id: legacyId,
      customerName: "Legacy Ref",
      customerEmail: `legacyref-${email}`,
      customerPhone: "010",
      shippingAddress: "x",
      shippingCity: "Cairo",
      shippingState: "Cairo",
      shippingPostalCode: "",
      shippingCountry: "Egypt",
      subtotal: "1.00",
      shipping: "0",
      tax: "0",
      total: "1.00",
    });
    // Exactly the backfill statement 0059 runs at deploy.
    const { readFileSync } = await import("node:fs");
    const migration = readFileSync("shared/database/migrations/0059_order_reference_and_reconciliation.sql", "utf-8");
    const backfill = migration
      .split("--> statement-breakpoint")
      .map((x) => x.trim())
      .find((x) => x.startsWith('INSERT INTO "order_reference"') && x.includes('FROM "order"'))!;
    const { sql: rawSql } = await import("drizzle-orm");
    await db.execute(rawSql.raw(backfill.replace(/;$/, "")));

    const legacyNumber = `ORD-${legacyId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const [reserved] = await db
      .select()
      .from(schema.orderReference)
      .where(eq(schema.orderReference.reference, legacyNumber));
    expect(reserved?.kind).toBe("legacy");
    // Legacy order still displays its old number; nothing rewritten.
    const [legacyRow] = await ordersWithId(legacyId);
    expect(legacyRow?.reference).toBeNull();

    // A candidate id whose NEW reference equals that legacy number is refused.
    const collidingCandidate = idWithTail(legacyNumber.slice(4));
    const fresh = v7();
    const queue = [collidingCandidate, fresh];
    const claimed = await referenceModule.claimOrderReference(db as never, "order", () => queue.shift()!);
    expect(claimed.id).toBe(fresh);
    await db.delete(schema.orderReference).where(eq(schema.orderReference.reference, claimed.reference));
  });

  it("REF-4. the paid order inherits the attempt reference; COD orders get their own registered reference", async () => {
    const productId = await mkProduct(10);
    const r = await start([[productId, 1]]);
    const { intentKey, txn } = await providerPays(r.attemptId);
    await sendPaidWebhook(r.attemptId, intentKey, txn);
    const att = await attemptRow(r.attemptId);
    const [o] = await ordersWithId(r.attemptId);
    expect(o?.reference).toBe(att.reference);
    expect((await browserVerify(r.attemptId)).order?.reference).toBe(att.reference);

    const cod = await Effect.runPromise(
      orders
        .createOrder({ ...checkoutInput([[productId, 1]]), paymentMethod: "cod" })
        .pipe(
          Effect.provideService(dbModule.DatabaseClientService, db as never),
          Effect.provideService(emailModule.EmailService, emailSpy),
        ),
    );
    ids.orders.push(cod.id);
    expect(cod.reference).toMatch(/^ORD-[0-9A-F]{8}$/);
    expect(cod.reference).toBe(`ORD-${cod.id.replace(/-/g, "").slice(-8).toUpperCase()}`);
    const [reg] = await db
      .select()
      .from(schema.orderReference)
      .where(eq(schema.orderReference.reference, cod.reference!));
    expect(reg).toMatchObject({ kind: "order", ownerId: cod.id });
  });

  // ── Hardening: automatic provider reconciliation ──────────────────────────

  /** Make every open attempt due now (instead of waiting for the backoff). */
  async function makeDue(attemptId: string) {
    await db
      .update(schema.paymentAttempt)
      .set({ nextProviderCheckAt: new Date(Date.now() - 1000) })
      .where(eq(schema.paymentAttempt.id, attemptId));
  }
  /** Only reconcile the attempts this test made (the DB may hold others). */
  const onlyFor = (attemptIds: string[], fail = false) => ({
    fetchTransaction: async (intentKey: string) => {
      const rows = await db
        .select({ id: schema.paymentAttempt.id })
        .from(schema.paymentAttempt)
        .where(eq(schema.paymentAttempt.intentKey, intentKey));
      if (!attemptIds.includes(rows[0]?.id ?? "")) throw new Error("not this test's attempt");
      if (fail) throw new Error("Fawaterak POST /api/v3/getTransactionData failed (HTTP 503)");
      const res = await fetchStub("https://fawaterak.test/api/v3/getTransactionData", {
        method: "POST",
        body: JSON.stringify({ intent_key: intentKey }),
      });
      const body = (await res.json()) as { status: string; data?: Record<string, unknown> };
      if (body.status !== "success" || !body.data) throw new Error("not found");
      return body.data;
    },
  });

  it("REC-1. webhook lost + customer never returns + provider paid → the sweep creates the order automatically", async () => {
    const productId = await mkProduct(5);
    const token = await mkCart();
    const r = await start([[productId, 2]], { cartSessionToken: token });
    const fresh = await attemptRow(r.attemptId);
    expect(fresh.nextProviderCheckAt).not.toBeNull(); // first check scheduled at creation

    await providerPays(r.attemptId); // paid at Fawaterak — no webhook, no browser
    await makeDue(r.attemptId);
    const summary = await attempts.reconcilePendingAttempts(db as never, { provider: onlyFor([r.attemptId]) });
    expect(summary.finalized).toBe(1);

    const [o] = await ordersWithId(r.attemptId);
    expect(o?.paymentStatus).toBe("paid");
    expect(await stockOf(productId)).toBe(3);
    expect(emailsTo(email)).toHaveLength(1);
    expect(dispatchCallsFor(r.attemptId)).toHaveLength(1);
    const [cart] = await db.select().from(schema.capturedCart).where(eq(schema.capturedCart.sessionToken, token));
    expect(cart?.convertedOrderId).toBe(r.attemptId);
    const att = await attemptRow(r.attemptId);
    expect(att.status).toBe("materialized");
    expect(att.providerCheckResult).toBe("paid");
    expect(att.nextProviderCheckAt).toBeNull();
  });

  it("REC-2. provider still pending → no order; the check is recorded and the next one backed off (not hammered)", async () => {
    const productId = await mkProduct(5);
    const r = await start([[productId, 1]]);
    await makeDue(r.attemptId);
    const provider = onlyFor([r.attemptId]);
    const spy = vi.spyOn(provider, "fetchTransaction");

    await attempts.reconcilePendingAttempts(db as never, { provider });
    expect(spy).toHaveBeenCalledTimes(1);
    let att = await attemptRow(r.attemptId);
    expect(att.status).toBe("pending");
    expect(att.providerCheckCount).toBe(1);
    expect(att.providerCheckResult).toBe("unpaid: pending");
    expect(att.nextProviderCheckAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    expect(await ordersWithId(r.attemptId)).toHaveLength(0);

    // Not due → the next sweeps don't call Fawaterak at all.
    await attempts.reconcilePendingAttempts(db as never, { provider });
    await attempts.reconcilePendingAttempts(db as never, { provider });
    expect(spy).toHaveBeenCalledTimes(1);

    // Backoff grows with each check; it never expires the attempt.
    await makeDue(r.attemptId);
    await attempts.reconcilePendingAttempts(db as never, { provider });
    att = await attemptRow(r.attemptId);
    expect(att.providerCheckCount).toBe(2);
    expect(att.status).toBe("pending");
    expect(att.nextProviderCheckAt!.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
  });

  it("REC-3. repeated and concurrent reconciliation → exactly one order", async () => {
    const productId = await mkProduct(10);
    const promoId = await mkPromo({ usageLimit: 5 });
    const r = await start([[productId, 3]], { promoCodeId: promoId });
    const { intentKey, txn } = await providerPays(r.attemptId);
    await makeDue(r.attemptId);
    const provider = onlyFor([r.attemptId]);
    const spy = vi.spyOn(provider, "fetchTransaction");

    // Several sweeps at once (several app instances) + a late webhook + a poll.
    await Promise.all([
      attempts.reconcilePendingAttempts(db as never, { provider }),
      attempts.reconcilePendingAttempts(db as never, { provider }),
      attempts.reconcilePendingAttempts(db as never, { provider }),
      sendPaidWebhook(r.attemptId, intentKey, txn),
      browserVerify(r.attemptId),
    ]);
    await makeDue(r.attemptId);
    await attempts.reconcilePendingAttempts(db as never, { provider });

    expect(spy.mock.calls.length).toBeLessThanOrEqual(1); // leased: never two sweeps on one attempt
    expect(await ordersWithId(r.attemptId)).toHaveLength(1);
    expect(await stockOf(productId)).toBe(7);
    expect((await promoOf(promoId)).usedCount).toBe(1);
    expect(emailsTo(email)).toHaveLength(1);
    expect(dispatchCallsFor(r.attemptId)).toHaveLength(1);
  });

  it("REC-4. provider error → recorded, no order, retried on the backoff and then succeeds", async () => {
    const productId = await mkProduct(5);
    const r = await start([[productId, 1]]);
    await providerPays(r.attemptId);
    await makeDue(r.attemptId);

    const failing = await attempts.reconcilePendingAttempts(db as never, { provider: onlyFor([r.attemptId], true) });
    expect(failing.errors).toBe(1);
    let att = await attemptRow(r.attemptId);
    expect(att.status).toBe("pending");
    expect(att.providerCheckError).toMatch(/HTTP 503/);
    expect(att.nextProviderCheckAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await ordersWithId(r.attemptId)).toHaveLength(0);

    await makeDue(r.attemptId);
    await attempts.reconcilePendingAttempts(db as never, { provider: onlyFor([r.attemptId]) });
    att = await attemptRow(r.attemptId);
    expect(att.status).toBe("materialized");
    expect(att.providerCheckError).toBeNull();
    expect(await ordersWithId(r.attemptId)).toHaveLength(1);
  });

  it("REC-5. already materialized / provider-closed attempts are never re-checked (no-op)", async () => {
    const productId = await mkProduct(5);
    const paid = await start([[productId, 1]], { customerEmail: `rec5a-${email}` });
    const { intentKey, txn } = await providerPays(paid.attemptId);
    await sendPaidWebhook(paid.attemptId, intentKey, txn);
    const closed = await start([[productId, 1]], { customerEmail: `rec5b-${email}` });
    await attempts.recordAttemptOutcome(db as never, closed.attemptId, "expired", { gatewayData: {} });
    await makeDue(paid.attemptId);
    await makeDue(closed.attemptId);

    const provider = onlyFor([paid.attemptId, closed.attemptId]);
    const spy = vi.spyOn(provider, "fetchTransaction");
    await attempts.reconcilePendingAttempts(db as never, { provider });
    expect(spy).not.toHaveBeenCalled();
    expect(await ordersWithId(paid.attemptId)).toHaveLength(1);
    expect(await ordersWithId(closed.attemptId)).toHaveLength(0);
  });

  it("REC-6. only an explicit provider EXPIRED/CANCELLED status closes an attempt — age never does", async () => {
    const productId = await mkProduct(5);
    const old = await start([[productId, 1]], { customerEmail: `rec6a-${email}` });
    // Make it look ancient.
    await db
      .update(schema.paymentAttempt)
      .set({ createdAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(schema.paymentAttempt.id, old.attemptId));
    const expiring = await start([[productId, 1]], { customerEmail: `rec6b-${email}` });
    const exp = await attemptRow(expiring.attemptId);
    providerTx.set(exp.intentKey!, { ...providerTx.get(exp.intentKey!)!, status_text: "EXPIRED" });
    await makeDue(old.attemptId);
    await makeDue(expiring.attemptId);

    await attempts.reconcilePendingAttempts(db as never, { provider: onlyFor([old.attemptId, expiring.attemptId]) });
    expect((await attemptRow(old.attemptId)).status).toBe("pending");
    expect((await attemptRow(expiring.attemptId)).status).toBe("expired");
    expect((await attemptRow(expiring.attemptId)).nextProviderCheckAt).toBeNull();
  });

  it("REC-7. the batch size bounds provider calls per sweep", async () => {
    const productId = await mkProduct(50);
    const made = await Promise.all(
      Array.from({ length: 5 }, (_, i) => start([[productId, 1]], { customerEmail: `rec7-${i}-${email}` })),
    );
    for (const m of made) await makeDue(m.attemptId);
    const provider = onlyFor(made.map((m) => m.attemptId));
    const spy = vi.spyOn(provider, "fetchTransaction");
    const summary = await attempts.reconcilePendingAttempts(db as never, { provider, batchSize: 2 });
    expect(summary.checked).toBe(2);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
  });

  // ── X, Y. paid but materialization fails ──────────────────────────────────

  it("X, Y. materialization failure keeps the payment durable (paid_pending_materialization); retry creates exactly one order", async () => {
    const productId = await mkProduct(5, "100.00");
    const r = await start([[productId, 1]]);
    const { intentKey, txn } = await providerPays(r.attemptId);

    // Force a materialization failure: the product row disappears.
    const [productRow] = await db.select().from(schema.product).where(eq(schema.product.id, productId));
    await db.delete(schema.product).where(eq(schema.product.id, productId));

    const out = await sendPaidWebhook(r.attemptId, intentKey, txn);
    expect(out.statusCode).toBe(500);
    const att = await attemptRow(r.attemptId);
    expect(att.status).toBe("paid_pending_materialization");
    expect(att.transactionId).toBe(String(txn));
    expect(att.paidAt).not.toBeNull();
    expect(att.materializationError).toMatch(/no longer exist/);
    expect(att.materializationAttempts).toBe(1);
    expect(await ordersWithId(r.attemptId)).toHaveLength(0);
    expect(sent).toHaveLength(0);
    expect(dispatchMock).not.toHaveBeenCalled();

    // The customer is told the payment was received — never that it failed.
    expect((await browserVerify(r.attemptId)).status).toBe("paid_pending_materialization");

    // Fix the cause; the reconciliation sweep retries without any provider call.
    await db.insert(schema.product).values(productRow!);
    const fetchesBefore = fetchStub.mock.calls.length;
    await attempts.reconcilePaidAttempts(db as never);
    expect(fetchStub.mock.calls.length).toBe(fetchesBefore);
    await attempts.reconcilePaidAttempts(db as never);
    await attempts.finalizePaidAttempt(db as never, r.attemptId, null);

    expect(await ordersWithId(r.attemptId)).toHaveLength(1);
    expect((await attemptRow(r.attemptId)).status).toBe("materialized");
    expect(await stockOf(productId)).toBe(4);
    expect(emailsTo(email)).toHaveLength(1);
    expect(dispatchCallsFor(r.attemptId)).toHaveLength(1);
  });

  it("Y2. effects unclaimed after a crash are run once by the next finalize/sweep", async () => {
    const productId = await mkProduct(5);
    const r = await start([[productId, 1]]);
    const { intentKey, txn } = await providerPays(r.attemptId);
    await sendPaidWebhook(r.attemptId, intentKey, txn);
    expect(emailsTo(email)).toHaveLength(1);

    // Simulate "process died after commit, before effects": clear the claim.
    await db
      .update(schema.paymentAttempt)
      .set({ effectsClaimedAt: null })
      .where(eq(schema.paymentAttempt.id, r.attemptId));
    sent.length = 0;
    await attempts.reconcilePaidAttempts(db as never);
    await attempts.reconcilePaidAttempts(db as never);
    expect(emailsTo(email)).toHaveLength(1);
    expect(await ordersWithId(r.attemptId)).toHaveLength(1);
  });

  // ── Z, AA, AB. legacy order-first payments ────────────────────────────────

  it("Z, AB. a legacy pending order (created before deploy) is paid by its webhook through the legacy path", async () => {
    const productId = await mkProduct(5);
    const legacyId = v7();
    const legacyIntent = randomUUID();
    ids.orders.push(legacyId);
    await db.insert(schema.order).values({
      id: legacyId,
      customerName: "Legacy Customer",
      customerEmail: `legacy-${email}`,
      customerPhone: "01000000000",
      shippingAddress: "1 Old St",
      shippingCity: "Cairo",
      shippingState: "Cairo",
      shippingPostalCode: "",
      shippingCountry: "Egypt",
      subtotal: "100.00",
      shipping: "85.00",
      tax: "0",
      total: "185.00",
      paymentMethod: "fawaterak",
      paymentStatus: "pending",
      paymentSessionId: legacyIntent,
      bostaSyncStatus: "skipped",
    });
    await db.insert(schema.orderItem).values({
      orderId: legacyId,
      productId,
      vendorId: ids.vendor,
      quantity: 1,
      price: "100.00",
      name: "legacy item",
    });
    const txn = nextTxn++;
    providerTx.set(legacyIntent, {
      intent_key: legacyIntent,
      transaction_id: txn,
      paid: 1,
      total: "185.00",
      currency: "EGP",
      pay_load: { orderId: legacyId },
    });

    // AB: the legacy reference is not an attempt
    expect(await deps().attempts!.findAttemptById(legacyId)).toBeNull();

    const fields = { transaction_id: txn, transaction_key: legacyIntent, payment_method: "Visa-Mastercard" };
    const out = await webhook.processFawaterakPaidWebhook(
      {
        ...fields,
        status: "paid",
        pay_load: JSON.stringify({ orderId: legacyId }),
        transactionHashKey: utils.signPaid(fields),
      },
      deps(),
    );
    expect(out.statusCode).toBe(200);
    expect(out.body.result).toBe("paid");
    const [o] = await ordersWithId(legacyId);
    expect(o?.paymentStatus).toBe("paid");
    expect(o?.status).toBe("processing");
    expect(o?.paymentTransactionId).toBe(String(txn));
    // Legacy deferred Bosta still fires from the legacy path
    expect(dispatchCallsFor(legacyId)).toHaveLength(1);
    // No attempt was invented for it
    expect(
      await db.select().from(schema.paymentAttempt).where(eq(schema.paymentAttempt.id, legacyId)),
    ).toHaveLength(0);
  });

  it("AA. legacy browser verification (payment.verify by order id) still marks a legacy order paid", async () => {
    const legacyId = v7();
    const legacyIntent = randomUUID();
    ids.orders.push(legacyId);
    await db.insert(schema.order).values({
      id: legacyId,
      customerName: "Legacy Two",
      customerEmail: `legacy2-${email}`,
      customerPhone: "01000000000",
      shippingAddress: "1 Old St",
      shippingCity: "Cairo",
      shippingState: "Cairo",
      shippingPostalCode: "",
      shippingCountry: "Egypt",
      subtotal: "50.00",
      shipping: "85.00",
      tax: "0",
      total: "135.00",
      paymentMethod: "fawaterak",
      paymentStatus: "pending",
      paymentSessionId: legacyIntent,
    });
    providerTx.set(legacyIntent, {
      intent_key: legacyIntent,
      transaction_id: nextTxn++,
      paid: 1,
      total: "135.00",
      currency: "EGP",
      pay_load: { orderId: legacyId },
    });
    const res = await caller().verify({ orderId: legacyId });
    expect(res.success && res.result.paymentStatus).toBe("paid");
    const [o] = await ordersWithId(legacyId);
    expect(o?.paymentStatus).toBe("paid");
  });

  // ── AC, AD. Orders queue ──────────────────────────────────────────────────

  it("AC, AD. the admin Orders list contains paid orders and never an unpaid attempt", async () => {
    const productId = await mkProduct(10);
    const pending = await start([[productId, 1]], { customerEmail: `queue-pending-${email}` });
    const paid = await start([[productId, 1]], { customerEmail: `queue-paid-${email}` });
    const { intentKey, txn } = await providerPays(paid.attemptId);
    await sendPaidWebhook(paid.attemptId, intentKey, txn);

    const adminSession = { id: "s", token: "t", email: "admin@example.invalid", name: "A", phone: "", expiresAt: new Date(Date.now() + 1e7), role: "admin" as const };
    const list = await Effect.runPromise(
      viewOrdersModule
        .viewOrders({ limit: 100, offset: 0 }, adminSession)
        .pipe(Effect.provideService(dbModule.DatabaseClientService, db as never)),
    );
    const listedIds = list.items.map((o: { id: string }) => o.id);
    expect(listedIds).toContain(paid.attemptId);
    expect(listedIds).not.toContain(pending.attemptId);
    const listedPaid = list.items.find((o: { id: string }) => o.id === paid.attemptId) as { paymentStatus: string };
    expect(listedPaid.paymentStatus).toBe("paid");
  });
});
