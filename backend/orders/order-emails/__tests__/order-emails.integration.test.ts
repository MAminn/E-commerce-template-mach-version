import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Effect, Redacted } from "effect";
import { and, eq, inArray, like, sql } from "drizzle-orm";

/**
 * Order confirmation emails through the durable outbox, end to end against a
 * real Postgres (TEST_DATABASE_URL — a disposable database, never
 * production).
 *
 * The ONLY stub is nodemailer's transport (createTransport → sendMail): the
 * real makeEmailService (acceptance rules, Message-ID, Reply-To), the real
 * worker pass (claim → render → send → record), the real queue SQL and the
 * real order activity log all run. Nothing leaves the machine.
 */

type SendMailCall = {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  messageId?: string;
};
const sendMailMock = vi.fn<(msg: SendMailCall) => Promise<unknown>>();

vi.mock("nodemailer", () => ({
  createTransport: () => ({
    sendMail: (msg: SendMailCall) => sendMailMock(msg),
    verify: async () => true,
  }),
}));

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

describeIfDb("order confirmation emails (integration)", () => {
  let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
  let schema: typeof import("#root/shared/database/drizzle/schema");
  let dbModule: typeof import("#root/shared/database/drizzle/db");
  let orders: typeof import("#root/backend/orders/create-order/service");
  let worker: typeof import("#root/backend/email-automations/worker");
  let orderEmails: typeof import("#root/backend/orders/order-emails/service");
  let queue: typeof import("#root/backend/email-automations/queue/service");
  let confirm: typeof import("#root/backend/payments/confirm-online-payment");
  let emailService: import("#root/shared/email/service").EmailServiceInterface;
  let v7: () => string;
  let originalAutomationSettings: unknown = null;

  const tag = Date.now().toString(36);
  const adminEmail = `admin-${tag}@machsupplements.test`;
  const ids = { file: "", vendor: "", category: "", products: [] as string[], orders: [] as string[], admin: "" };

  /** What the transport received, newest last. */
  const delivered = () => sendMailMock.mock.calls.map((c) => c[0]);
  const deliveredTo = (to: string) => delivered().filter((m) => m.to === to);

  /** A transport that accepts everything, like Gmail/Hostinger answering 250. */
  const acceptAll = () =>
    sendMailMock.mockImplementation(async (msg) => ({
      messageId: msg.messageId ?? "<generated@test>",
      accepted: [msg.to],
      rejected: [],
      response: "250 2.0.0 OK 1763600000 test-smtp",
    }));

  async function mkProduct(stock: number, price = "100.00", name = `Whey ${randomUUID().slice(0, 6)}`) {
    const id = v7();
    ids.products.push(id);
    await db.insert(schema.product).values({
      id,
      name,
      slug: `oe-${id}`,
      description: "d",
      price,
      imageId: ids.file,
      categoryId: ids.category,
      vendorId: ids.vendor,
      stock,
    });
    return { id, name };
  }

  const customer = (suffix: string) => `buyer.${suffix}.${tag}@example.com`;

  async function placeCod(lines: Array<[string, number]>, email: string, extra: Record<string, unknown> = {}) {
    const res = await Effect.runPromise(
      orders
        .createOrder({
          customerName: "Omar Test",
          customerEmail: email,
          customerPhone: "01000000000",
          shippingAddress: "12 Abbas El Akkad St",
          shippingCity: "Nasr City",
          shippingState: "Cairo",
          shippingPostalCode: "11765",
          shippingCountry: "Egypt",
          items: lines.map(([productId, quantity]) => ({ productId, quantity })),
          paymentMethod: "cod",
          ...extra,
        } as never)
        .pipe(Effect.provideService(dbModule.DatabaseClientService, db as never)),
    );
    ids.orders.push(res.id);
    return res;
  }

  async function rowsFor(orderId: string) {
    return db
      .select()
      .from(schema.scheduledEmail)
      .where(like(schema.scheduledEmail.dedupeKey, `%:${orderId}%`));
  }
  async function customerRow(orderId: string) {
    const [row] = await db
      .select()
      .from(schema.scheduledEmail)
      .where(eq(schema.scheduledEmail.dedupeKey, `order_confirmation:${orderId}`));
    return row;
  }
  async function logsFor(orderId: string) {
    return db.select().from(schema.orderLog).where(eq(schema.orderLog.orderId, orderId));
  }
  const drain = () => worker.drainTransactionalEmails(emailService);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    delete process.env.SYN_BOSTA_KEY;
    delete process.env.FINCART_ENABLED;
    process.env.EMAIL_FROM_ADDRESS = "orders@machsupplements.com";
    process.env.EMAIL_FROM_NAME = "Mach Supplements";
    process.env.EMAIL_REPLY_TO = "support@machsupplements.com";
    process.env.PUBLIC_ORIGIN = "https://machsupplements.com";

    const { drizzle } = await import("drizzle-orm/node-postgres");
    schema = await import("#root/shared/database/drizzle/schema");
    dbModule = await import("#root/shared/database/drizzle/db");
    db = drizzle(TEST_DB_URL!, { schema });
    orders = await import("#root/backend/orders/create-order/service");
    worker = await import("#root/backend/email-automations/worker");
    orderEmails = await import("#root/backend/orders/order-emails/service");
    queue = await import("#root/backend/email-automations/queue/service");
    confirm = await import("#root/backend/payments/confirm-online-payment");
    ({ v7 } = await import("uuid"));

    const { makeEmailService } = await import("#root/shared/email/service");
    emailService = await Effect.runPromise(
      makeEmailService({
        smtpHost: "smtp.test.invalid",
        smtpPort: 465,
        smtpUser: "orders@machsupplements.com",
        smtpPassword: Redacted.make("not-a-real-password"),
        fromAddress: process.env.EMAIL_FROM_ADDRESS,
        fromName: process.env.EMAIL_FROM_NAME,
        replyTo: process.env.EMAIL_REPLY_TO,
      }),
    );

    const [settings] = await db
      .select({ s: schema.storeSettings.emailAutomationSettings })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.key, "default"));
    originalAutomationSettings = settings?.s ?? null;

    ids.file = v7();
    await db.insert(schema.file).values({ id: ids.file, diskname: "oe.jpg" });
    ids.vendor = v7();
    await db.insert(schema.vendor).values({ id: ids.vendor, name: "OE Vendor" });
    ids.category = v7();
    await db.insert(schema.category).values({ id: ids.category, name: "OE Cat", slug: `oe-cat-${ids.category}` });
    ids.admin = `oe-admin-${tag}`;
    await db.insert(schema.user).values({ id: ids.admin, name: "Store Admin", email: adminEmail, role: "admin" });
  });

  beforeEach(async () => {
    acceptAll();
    await drain(); // flush anything earlier tests left queued
    sendMailMock.mockClear();
    acceptAll();
  });

  afterAll(async () => {
    if (!db) return;
    if (ids.orders.length) {
      await db
        .delete(schema.scheduledEmail)
        .where(sql`${schema.scheduledEmail.payload}->>'orderId' in (${sql.join(ids.orders.map((id) => sql`${id}`), sql`, `)})`);
      await db.delete(schema.orderLog).where(inArray(schema.orderLog.orderId, ids.orders));
      await db.delete(schema.orderItem).where(inArray(schema.orderItem.orderId, ids.orders));
      await db.delete(schema.orderReference).where(inArray(schema.orderReference.ownerId, ids.orders));
      await db.delete(schema.order).where(inArray(schema.order.id, ids.orders));
    }
    await db.delete(schema.scheduledEmail).where(like(schema.scheduledEmail.dedupeKey, `oe-test:${tag}%`));
    if (ids.products.length) await db.delete(schema.product).where(inArray(schema.product.id, ids.products));
    if (ids.category) await db.delete(schema.category).where(eq(schema.category.id, ids.category));
    if (ids.vendor) await db.delete(schema.vendor).where(eq(schema.vendor.id, ids.vendor));
    if (ids.file) await db.delete(schema.file).where(eq(schema.file.id, ids.file));
    if (ids.admin) await db.delete(schema.user).where(eq(schema.user.id, ids.admin));
    await db
      .update(schema.storeSettings)
      .set({ emailAutomationSettings: originalAutomationSettings as never })
      .where(eq(schema.storeSettings.key, "default"));
  });

  // ── 1. Successful COD confirmation ──────────────────────────────────────

  it("1. a COD order queues one confirmation in its transaction and the worker sends it once, MACH-branded, with the real order data", async () => {
    const whey = await mkProduct(10, "1250.00", "Mach Whey Isolate 2lb");
    const creatine = await mkProduct(10, "450.00", "Mach Creatine 300g");
    const email = customer("cod");
    const placed = await placeCod([[whey.id, 2], [creatine.id, 1]], email);

    // Queued atomically with the order — before any worker ran.
    const queued = await customerRow(placed.id);
    expect(queued?.status).toBe("pending");
    expect(queued?.automationType).toBe("order_confirmation");
    expect((await logsFor(placed.id)).map((l) => l.action)).toContain("confirmation_email_queued");
    expect(sendMailMock).not.toHaveBeenCalled();

    await drain();

    const mails = deliveredTo(email);
    expect(mails).toHaveLength(1);
    const mail = mails[0]!;
    const number = `#${placed.reference!.slice(4)}`;
    expect(mail.from).toBe('"Mach Supplements" <orders@machsupplements.com>');
    expect(mail.replyTo).toBe("support@machsupplements.com");
    expect(mail.messageId).toBe(`<order-confirmation.${placed.id}@machsupplements.com>`);
    expect(mail.subject).toBe(`Mach Supplements — Order Confirmation ${number}`);
    // Order data
    expect(mail.html).toContain("Omar Test");
    expect(mail.html).toContain(number);
    expect(mail.html).toContain("Mach Whey Isolate 2lb");
    expect(mail.html).toContain("Mach Creatine 300g");
    expect(mail.html).toContain("2500.00 EGP"); // 2 × 1250
    expect(mail.html).toContain(`${Number(placed.total).toFixed(2)} EGP`);
    expect(mail.html).toContain("12 Abbas El Akkad St");
    expect(mail.html).toContain("Nasr City");
    expect(mail.html).toContain("Cash on delivery");
    expect(mail.html).toContain("support@machsupplements.com");
    // Never another store's branding
    expect(mail.html).not.toMatch(/lebsy|perc[eé]|piercing/i);

    // Provider acceptance recorded on the row and the order log
    const sentRow = await customerRow(placed.id);
    expect(sentRow?.status).toBe("sent");
    expect(sentRow?.providerMessageId).toBe(`<order-confirmation.${placed.id}@machsupplements.com>`);
    expect(sentRow?.providerResponse).toMatch(/^250 /);
    const sentLog = (await logsFor(placed.id)).find((l) => l.action === "confirmation_email_sent");
    expect(sentLog?.note).toContain(`Message-ID <order-confirmation.${placed.id}@machsupplements.com>`);
    expect(sentLog?.note).toContain("not proof of inbox delivery");
    expect(sentLog?.note).not.toContain(email); // masked

    // The store is notified too, once.
    const adminMails = deliveredTo(adminEmail).filter((m) => m.subject.includes(number));
    expect(adminMails).toHaveLength(1);
    expect(adminMails[0]!.subject).toMatch(/^New order #[0-9A-F]{8} — /);

    // Draining again sends nothing more.
    sendMailMock.mockClear();
    await drain();
    expect(deliveredTo(email)).toHaveLength(0);
  });

  // ── 2. Marketing test mode / master switch ──────────────────────────────

  it("2. marketing Test Mode ON and automations OFF never suppress an order confirmation (marketing rows stay held)", async () => {
    await db
      .update(schema.storeSettings)
      .set({
        emailAutomationSettings: {
          workerEnabled: false,
          testModeEnabled: true,
          testModeEmail: "test@machsupplement.com", // the misspelled prod value
          emailLogoUrl: "",
        } as never,
      })
      .where(eq(schema.storeSettings.key, "default"));

    const marketingKey = `oe-test:${tag}:welcome`;
    await db.insert(schema.scheduledEmail).values({
      automationType: "welcome",
      recipientEmail: customer("marketing"),
      payload: {},
      scheduledFor: new Date(Date.now() - 1000),
      dedupeKey: marketingKey,
    });

    const p = await mkProduct(5);
    const email = customer("testmode");
    const placed = await placeCod([[p.id, 1]], email);

    await worker.runEmailWorkerTick(emailService); // the real interval tick

    expect(deliveredTo(email)).toHaveLength(1);
    expect((await customerRow(placed.id))?.status).toBe("sent");
    const [marketing] = await db.select().from(schema.scheduledEmail).where(eq(schema.scheduledEmail.dedupeKey, marketingKey));
    expect(marketing?.status).toBe("pending"); // master switch still governs marketing
    expect(deliveredTo(customer("marketing"))).toHaveLength(0);

    // Test mode ON with the worker ON: marketing is held, order mail still goes.
    await db
      .update(schema.storeSettings)
      .set({
        emailAutomationSettings: {
          workerEnabled: true,
          testModeEnabled: true,
          testModeEmail: "test@machsupplement.com",
          emailLogoUrl: "",
        } as never,
      })
      .where(eq(schema.storeSettings.key, "default"));
    const email2 = customer("testmode2");
    const placed2 = await placeCod([[p.id, 1]], email2);
    await worker.runEmailWorkerTick(emailService);
    expect(deliveredTo(email2)).toHaveLength(1);
    expect((await customerRow(placed2.id))?.status).toBe("sent");
    const [held] = await db.select().from(schema.scheduledEmail).where(eq(schema.scheduledEmail.dedupeKey, marketingKey));
    expect(held?.status).toBe("cancelled");
    expect(held?.lastError).toMatch(/test mode/);
  });

  // ── 3, 4, 5. Provider failure, retry, recovery, exhaustion ──────────────

  it("3. an SMTP failure is recorded (never 'sent'), retried with backoff, and recovers to exactly one delivery", async () => {
    const p = await mkProduct(5);
    const email = customer("smtpfail");
    sendMailMock.mockImplementation(async () => {
      throw Object.assign(new Error("Greeting never received"), { responseCode: 421 });
    });
    const placed = await placeCod([[p.id, 1]], email);
    await drain();

    const failed = await customerRow(placed.id);
    expect(failed?.status).toBe("pending");
    expect(failed?.attempts).toBe(1);
    expect(failed?.lastError).toMatch(/Greeting never received/);
    expect(failed?.providerMessageId).toBeNull();
    expect(failed!.scheduledFor.getTime()).toBeGreaterThan(Date.now() + 30_000); // backed off, not hammered
    const failLog = (await logsFor(placed.id)).find((l) => l.action === "confirmation_email_failed");
    expect(failLog?.note).toMatch(/attempt 1.*will retry/);
    expect((await logsFor(placed.id)).some((l) => l.action === "confirmation_email_sent")).toBe(false);

    // Not yet due: another pass sends nothing.
    await drain();
    expect((await customerRow(placed.id))?.attempts).toBe(1);

    // Provider recovers; time passes.
    acceptAll();
    sendMailMock.mockClear();
    await db
      .update(schema.scheduledEmail)
      .set({ scheduledFor: new Date(Date.now() - 1000) })
      .where(eq(schema.scheduledEmail.id, failed!.id));
    await drain();
    expect(deliveredTo(email)).toHaveLength(1);
    const recovered = await customerRow(placed.id);
    expect(recovered?.status).toBe("sent");
    expect(recovered?.attempts).toBe(1);
    expect(recovered?.lastError).toBeNull();
  });

  it("4. retries are bounded — after the last attempt the row is 'failed' and the order log says NOT sent", async () => {
    const p = await mkProduct(5);
    const email = customer("exhaust");
    sendMailMock.mockImplementation(async () => {
      throw new Error("Daily user sending limit exceeded");
    });
    const placed = await placeCod([[p.id, 1]], email);
    const row = await customerRow(placed.id);
    await db
      .update(schema.scheduledEmail)
      .set({ attempts: queue.TRANSACTIONAL_MAX_ATTEMPTS - 1 })
      .where(eq(schema.scheduledEmail.id, row!.id));
    await drain();

    const final = await customerRow(placed.id);
    expect(final?.status).toBe("failed");
    expect(final?.attempts).toBe(queue.TRANSACTIONAL_MAX_ATTEMPTS);
    const log = (await logsFor(placed.id)).filter((l) => l.action === "confirmation_email_failed").pop();
    expect(log?.note).toMatch(/retries exhausted, NOT sent/);
  });

  it("5. a resolved sendMail that did not accept the recipient is a failure, not a send", async () => {
    const p = await mkProduct(5);
    const email = customer("rejected");
    sendMailMock.mockImplementation(async (msg) => ({
      messageId: msg.messageId,
      accepted: [],
      rejected: [msg.to],
      response: "550 5.1.1 The email account that you tried to reach does not exist",
    }));
    const placed = await placeCod([[p.id, 1]], email);
    await drain();
    const row = await customerRow(placed.id);
    expect(row?.status).toBe("pending");
    expect(row?.providerMessageId).toBeNull();
    expect(row?.lastError).toMatch(/not accepted.*550 5\.1\.1/);
    expect((await logsFor(placed.id)).some((l) => l.action === "confirmation_email_sent")).toBe(false);
  });

  // ── 6, 7. Duplicates, concurrency, restarts ─────────────────────────────

  it("6. repeated queueing and concurrent workers produce exactly one confirmation", async () => {
    const p = await mkProduct(5);
    const email = customer("concurrent");
    const placed = await placeCod([[p.id, 1]], email);

    // Duplicate callbacks / retries re-queue the same order many times at once.
    await Promise.all(Array.from({ length: 6 }, () => orderEmails.ensureOrderEmailsQueued(placed.id)));
    expect((await rowsFor(placed.id)).filter((r) => r.automationType === "order_confirmation")).toHaveLength(1);
    expect((await logsFor(placed.id)).filter((l) => l.action === "confirmation_email_queued")).toHaveLength(1);

    // Three workers race (multiple instances / overlapping ticks).
    let resolveSend: () => void = () => {};
    const gate = new Promise<void>((r) => {
      resolveSend = r;
    });
    sendMailMock.mockImplementation(async (msg) => {
      await gate; // hold every send in flight while the other workers run
      return { messageId: msg.messageId, accepted: [msg.to], rejected: [], response: "250 OK" };
    });
    const racing = Promise.all([drain(), drain(), drain()]);
    await new Promise((r) => setTimeout(r, 200));
    resolveSend();
    await racing;

    expect(deliveredTo(email)).toHaveLength(1);
    expect((await customerRow(placed.id))?.status).toBe("sent");
  });

  it("7. a row orphaned mid-send by a restart is re-queued and sent once; a live in-flight row is left alone", async () => {
    const p = await mkProduct(5);
    const orphanEmail = customer("orphan");
    const liveEmail = customer("inflight");
    const orphan = await placeCod([[p.id, 1]], orphanEmail);
    const live = await placeCod([[p.id, 1]], liveEmail);

    await db
      .update(schema.scheduledEmail)
      .set({ status: "sending", lastAttemptAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(schema.scheduledEmail.dedupeKey, `order_confirmation:${orphan.id}`));
    await db
      .update(schema.scheduledEmail)
      .set({ status: "sending", lastAttemptAt: new Date() })
      .where(eq(schema.scheduledEmail.dedupeKey, `order_confirmation:${live.id}`));

    const { requeued } = await drain();
    expect(requeued).toBeGreaterThanOrEqual(1);
    expect(deliveredTo(orphanEmail)).toHaveLength(1);
    const orphanRow = await customerRow(orphan.id);
    expect(orphanRow?.status).toBe("sent");
    expect(orphanRow?.attempts).toBe(1); // the interrupted try counted
    // Same Message-ID as any earlier interrupted try → a duplicate is recognisable.
    expect(deliveredTo(orphanEmail)[0]?.messageId).toBe(`<order-confirmation.${orphan.id}@machsupplements.com>`);

    expect(deliveredTo(liveEmail)).toHaveLength(0);
    expect((await customerRow(live.id))?.status).toBe("sending");
    // cleanup for later tests
    await db
      .update(schema.scheduledEmail)
      .set({ status: "cancelled" })
      .where(eq(schema.scheduledEmail.dedupeKey, `order_confirmation:${live.id}`));
  });

  // ── 8. Missing / invalid customer email ──────────────────────────────────

  it("8. a missing or invalid customer email is recorded on the order (never silently dropped); the store is still notified", async () => {
    for (const bad of ["", "not-an-email"]) {
      const id = v7();
      ids.orders.push(id);
      await db.insert(schema.order).values({
        id,
        customerName: "No Mail",
        customerEmail: bad,
        customerPhone: "010",
        shippingAddress: "x",
        shippingCity: "Cairo",
        shippingState: "",
        shippingPostalCode: "",
        shippingCountry: "Egypt",
        subtotal: "100",
        shipping: "0",
        tax: "0",
        total: "100",
        paymentMethod: "cod",
        paymentStatus: "not_required",
      } as never);

      expect(await orderEmails.ensureOrderEmailsQueued(id)).toBe(true);
      expect(await customerRow(id)).toBeUndefined();
      const log = (await logsFor(id)).find((l) => l.action === "confirmation_email_failed");
      expect(log?.note).toMatch(bad ? /not a valid address/ : /no customer email address/);
      expect((await rowsFor(id)).filter((r) => r.automationType === "order_admin_notification").length).toBeGreaterThan(0);
    }

    // A row whose recipient is unusable is cancelled with a reason, not retried forever.
    const p = await mkProduct(5);
    const placed = await placeCod([[p.id, 1]], customer("badrow"));
    await db
      .update(schema.scheduledEmail)
      .set({ recipientEmail: "broken address" })
      .where(eq(schema.scheduledEmail.dedupeKey, `order_confirmation:${placed.id}`));
    await drain();
    const row = await customerRow(placed.id);
    expect(row?.status).toBe("cancelled");
    expect(row?.lastError).toMatch(/not a valid email address/);
  });

  // ── 9. Online lifecycle: pending / failed / paid / duplicate webhook ────

  it("9. an order-first online order gets no confirmation while pending or failed, exactly one once paid, none for a duplicate paid webhook", async () => {
    const p = await mkProduct(5);
    const email = customer("online");
    const res = await Effect.runPromise(
      orders
        .createOrder({
          customerName: "Online Buyer",
          customerEmail: email,
          customerPhone: "01000000000",
          shippingAddress: "5 Road 9",
          shippingCity: "Maadi",
          shippingState: "Cairo",
          shippingPostalCode: "11728",
          shippingCountry: "Egypt",
          items: [{ productId: p.id, quantity: 1 }],
          paymentMethod: "paymob",
        } as never)
        .pipe(Effect.provideService(dbModule.DatabaseClientService, db as never)),
    );
    ids.orders.push(res.id);
    expect(res.paymentStatus).toBe("pending");
    expect(await rowsFor(res.id)).toHaveLength(0);

    await confirm.applyOnlinePaymentUpdate(db as never, res.id, { paymentStatus: "failed" });
    await drain();
    expect(await rowsFor(res.id)).toHaveLength(0);
    expect(deliveredTo(email)).toHaveLength(0);

    await confirm.applyOnlinePaymentUpdate(db as never, res.id, { paymentStatus: "paid", transactionId: "txn-1" });
    await confirm.applyOnlinePaymentUpdate(db as never, res.id, { paymentStatus: "paid", transactionId: "txn-1" });
    await drain();
    expect(deliveredTo(email)).toHaveLength(1);
    expect(deliveredTo(email)[0]!.html).toContain("Paid online");
    expect((await rowsFor(res.id)).filter((r) => r.automationType === "order_confirmation")).toHaveLength(1);
  });

  // ── 10. Savepoint isolation ──────────────────────────────────────────────

  it("10. a queueing failure inside the order transaction rolls back only the email rows, never the order", async () => {
    const id = v7();
    ids.orders.push(id);
    await db.transaction(async (tx) => {
      await tx.insert(schema.order).values({
        id,
        customerName: "Tx Test",
        customerEmail: customer("savepoint"),
        customerPhone: "010",
        shippingAddress: "x",
        shippingCity: "Cairo",
        shippingState: "",
        shippingPostalCode: "",
        shippingCountry: "Egypt",
        subtotal: "100",
        shipping: "0",
        tax: "0",
        total: "100",
        paymentMethod: "cod",
        paymentStatus: "not_required",
      } as never);
      const broken = await orderEmails.queueOrderPlacedEmailsInTx(tx as never, randomUUID());
      expect(broken.ok).toBe(false);
      // The transaction is still usable after the failed savepoint.
      const ok = await orderEmails.queueOrderPlacedEmailsInTx(tx as never, id);
      expect(ok.ok).toBe(true);
    });
    const [committed] = await db.select().from(schema.order).where(eq(schema.order.id, id));
    expect(committed).toBeDefined();
    expect(await customerRow(id)).toBeDefined();
  });

  // ── 11. Cancelled before send ────────────────────────────────────────────

  it("11. an order cancelled before its confirmation went out is not emailed; the reason is logged", async () => {
    const p = await mkProduct(5);
    const email = customer("cancelled");
    const placed = await placeCod([[p.id, 1]], email);
    await db.update(schema.order).set({ status: "cancelled" }).where(eq(schema.order.id, placed.id));
    await drain();
    expect(deliveredTo(email)).toHaveLength(0);
    expect((await customerRow(placed.id))?.status).toBe("cancelled");
    const log = (await logsFor(placed.id)).filter((l) => l.action === "confirmation_email_failed").pop();
    expect(log?.note).toMatch(/cancelled before its confirmation/);
  });

  // ── 12. No SMTP configured (dummy service) ───────────────────────────────

  it("12. with no SMTP configured the confirmation is recorded as failed and retried — never reported sent", async () => {
    const { createDummyEmailService } = await import("#root/shared/email/service");
    const dummy = createDummyEmailService({ warn: () => {} });
    const p = await mkProduct(5);
    const placed = await placeCod([[p.id, 1]], customer("nosmtp"));
    await worker.drainTransactionalEmails(dummy);
    const row = await customerRow(placed.id);
    expect(row?.status).toBe("pending");
    expect(row?.lastError).toMatch(/not configured/);
    expect((await logsFor(placed.id)).some((l) => l.action === "confirmation_email_sent")).toBe(false);
  });

  it("13. the outbox rows reference only this order (no cross-order or cross-store data)", async () => {
    const p = await mkProduct(5);
    const a = await placeCod([[p.id, 1]], customer("iso-a"));
    const b = await placeCod([[p.id, 1]], customer("iso-b"));
    await drain();
    const mailA = deliveredTo(customer("iso-a"))[0]!;
    expect(mailA.html).toContain(`#${a.reference!.slice(4)}`);
    expect(mailA.html).not.toContain(`#${b.reference!.slice(4)}`);
    expect(mailA.html).not.toContain(customer("iso-b"));
    const rows = await db
      .select()
      .from(schema.scheduledEmail)
      .where(and(eq(schema.scheduledEmail.automationType, "order_confirmation"), eq(schema.scheduledEmail.recipientEmail, customer("iso-a"))));
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as { orderId: string }).orderId).toBe(a.id);
  });
});
