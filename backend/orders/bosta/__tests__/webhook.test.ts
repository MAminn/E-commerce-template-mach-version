import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#root/backend/orders/order-log", () => ({
  logOrderEvent: vi.fn(async () => {}),
  recordWebhookLog: vi.fn(async () => "log-1"),
  updateWebhookLogStatus: vi.fn(async () => {}),
}));

vi.mock("#root/backend/email-automations/triggers/order-delivered", () => ({
  enqueueReviewCheckForOrder: vi.fn(async () => {}),
}));

import Fastify from "fastify";
import { logOrderEvent, recordWebhookLog } from "#root/backend/orders/order-log";
import { enqueueReviewCheckForOrder } from "#root/backend/email-automations/triggers/order-delivered";
import {
  applyBostaWebhook,
  bostaWebhookSchema,
  webhookTimestampToDate,
} from "../webhook-service";
import {
  extractWebhookToken,
  isIpAllowed,
  safeEqual,
  verifyBostaWebhookSecret,
} from "../webhook-auth";
import { bostaWebhookPlugin } from "../webhook-api";
import {
  clearBostaEnv,
  makeFakeDb,
  makeOrderRow,
  ORDER_ID,
  setBostaEnv,
  TEST_WEBHOOK_SECRET,
} from "./test-utils";

const logMock = vi.mocked(logOrderEvent);
const webhookLogMock = vi.mocked(recordWebhookLog);
const reviewMock = vi.mocked(enqueueReviewCheckForOrder);

/** The documented "normal state change" example, verbatim. */
const DOCUMENTED_NORMAL = {
  _id: "15LmfpKYp0YILntA3jbyd",
  trackingNumber: 48089608,
  state: 24,
  type: "SEND",
  timeStamp: 1689252908261,
  deliveryPromiseDate: "13-07-2023",
  numberOfAttempts: 0,
};

/** The documented "exception case" example, verbatim. */
const DOCUMENTED_EXCEPTION = {
  _id: "15LmfpKYp0YILntA3jbyd",
  trackingNumber: 48089608,
  state: 47,
  type: "SEND",
  timeStamp: 1689253131024,
  deliveryPromiseDate: "15-07-2023",
  numberOfAttempts: 1,
  exceptionReason: "Postponed - the customer requested postponement for another day.",
  exceptionCode: 3,
};

function payload(overrides: Record<string, unknown> = {}) {
  return bostaWebhookSchema.parse({
    ...DOCUMENTED_NORMAL,
    businessReference: ORDER_ID,
    ...overrides,
  });
}

beforeEach(() => {
  setBostaEnv();
  logMock.mockClear();
  webhookLogMock.mockClear();
  reviewMock.mockClear();
});
afterEach(() => clearBostaEnv());

describe("bostaWebhookSchema (current documented payload)", () => {
  it("1. accepts the documented numeric-state payload", () => {
    const parsed = bostaWebhookSchema.safeParse(DOCUMENTED_NORMAL);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.state).toBe(24);
  });

  it("2. accepts `type` as a string", () => {
    const parsed = bostaWebhookSchema.safeParse({ ...DOCUMENTED_NORMAL, type: "EXCHANGE" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.type).toBe("EXCHANGE");
  });

  it("3. normalises a numeric trackingNumber to a string", () => {
    const parsed = bostaWebhookSchema.parse(DOCUMENTED_NORMAL);
    expect(parsed.trackingNumber).toBe("48089608");
    expect(bostaWebhookSchema.parse({ ...DOCUMENTED_NORMAL, trackingNumber: "5108002" }).trackingNumber).toBe(
      "5108002",
    );
  });

  it("accepts the documented exception payload and keeps extra provider fields", () => {
    const parsed = bostaWebhookSchema.parse({ ...DOCUMENTED_EXCEPTION, somethingNew: true });
    expect(parsed.exceptionCode).toBe(3);
    expect((parsed as Record<string, unknown>).somethingNew).toBe(true);
  });

  it("rejects the old object-shaped state", () => {
    expect(
      bostaWebhookSchema.safeParse({ ...DOCUMENTED_NORMAL, state: { code: 24, value: "x" } }).success,
    ).toBe(false);
  });

  it("does not require fields Bosta does not guarantee", () => {
    expect(bostaWebhookSchema.safeParse({ trackingNumber: 1, state: 10 }).success).toBe(true);
  });
});

describe("applyBostaWebhook", () => {
  it("4. state 24 (Received at warehouse) → shipped, Bosta columns filled", async () => {
    const row = makeOrderRow({ status: "processing" });
    const db = makeFakeDb({ order: row });
    const result = await applyBostaWebhook(db as never, payload());

    expect(result).toMatchObject({ skipped: false, nextStatus: "shipped", stateCode: 24 });
    expect(row.status).toBe("shipped");
    expect(row.bostaStatus).toBe("Received at warehouse");
    expect(row.bostaStatusCode).toBe("24");
    expect(webhookLogMock).toHaveBeenCalledTimes(1);
  });

  it("5. state 41 → shipped", async () => {
    const row = makeOrderRow({ status: "processing" });
    const db = makeFakeDb({ order: row });
    await applyBostaWebhook(db as never, payload({ state: 41 }));
    expect(row.status).toBe("shipped");
    expect(row.bostaStatus).toBe("Picked up");
  });

  it("6. state 45 → delivered, review check enqueued once", async () => {
    const row = makeOrderRow({ status: "shipped" });
    const db = makeFakeDb({ order: row });
    await applyBostaWebhook(db as never, payload({ state: 45, cod: 140 }));
    expect(row.status).toBe("delivered");
    expect(reviewMock).toHaveBeenCalledTimes(1);
    expect(reviewMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER_ID, customerEmail: "ahmed@example.com" }),
    );
  });

  it("7. state 47 (Exception) keeps the current order status", async () => {
    const row = makeOrderRow({ status: "shipped" });
    const db = makeFakeDb({ order: row });
    const result = await applyBostaWebhook(
      db as never,
      payload({ ...DOCUMENTED_EXCEPTION, businessReference: ORDER_ID }),
    );
    expect(result).toMatchObject({ skipped: false, nextStatus: null });
    expect(row.status).toBe("shipped");
    expect(row.bostaStatus).toBe("Exception");
    expect(row.bostaStatusCode).toBe("47");
    expect(logMock).not.toHaveBeenCalled();
  });

  it("8. state 48 (Terminated) → cancelled", async () => {
    const row = makeOrderRow({ status: "processing" });
    await applyBostaWebhook(makeFakeDb({ order: row }) as never, payload({ state: 48 }));
    expect(row.status).toBe("cancelled");
  });

  it("9. state 49 (Canceled) → cancelled", async () => {
    const row = makeOrderRow({ status: "processing" });
    await applyBostaWebhook(makeFakeDb({ order: row }) as never, payload({ state: 49 }));
    expect(row.status).toBe("cancelled");
  });

  it("10. state 100 (Lost) → cancelled", async () => {
    const row = makeOrderRow({ status: "shipped" });
    await applyBostaWebhook(makeFakeDb({ order: row }) as never, payload({ state: 100 }));
    expect(row.status).toBe("cancelled");
  });

  it("11. state 101 (Damaged) → cancelled", async () => {
    const row = makeOrderRow({ status: "shipped" });
    await applyBostaWebhook(makeFakeDb({ order: row }) as never, payload({ state: 101 }));
    expect(row.status).toBe("cancelled");
  });

  it("12. unknown / in-progress states never downgrade a shipped order", async () => {
    for (const state of [105, 102, 104, 20, 9999]) {
      const row = makeOrderRow({ status: "shipped" });
      await applyBostaWebhook(makeFakeDb({ order: row }) as never, payload({ state }));
      expect(row.status, `state ${state}`).toBe("shipped");
    }
  });

  it("13. delivered does not regress", async () => {
    for (const state of [24, 41, 10, 47]) {
      const row = makeOrderRow({ status: "delivered" });
      await applyBostaWebhook(makeFakeDb({ order: row }) as never, payload({ state }));
      expect(row.status, `state ${state}`).toBe("delivered");
    }
  });

  it("14. cancelled does not regress", async () => {
    for (const state of [24, 41, 10, 47]) {
      const row = makeOrderRow({ status: "cancelled" });
      await applyBostaWebhook(makeFakeDb({ order: row }) as never, payload({ state }));
      expect(row.status, `state ${state}`).toBe("cancelled");
    }
  });

  it("15. exceptionReason / exceptionCode are preserved in bostaWebhookData", async () => {
    const row = makeOrderRow({ status: "shipped" });
    await applyBostaWebhook(
      makeFakeDb({ order: row }) as never,
      payload({ ...DOCUMENTED_EXCEPTION, businessReference: ORDER_ID }),
    );
    const data = row.bostaWebhookData as unknown as Record<string, unknown>;
    expect(data.exceptionReason).toBe(DOCUMENTED_EXCEPTION.exceptionReason);
    expect(data.exceptionCode).toBe(3);
    expect(data.stateName).toBe("Exception");
  });

  it("16. numberOfAttempts is preserved", async () => {
    const row = makeOrderRow({ status: "shipped" });
    await applyBostaWebhook(makeFakeDb({ order: row }) as never, payload({ state: 47, numberOfAttempts: 2 }));
    expect((row.bostaWebhookData as unknown as Record<string, unknown>).numberOfAttempts).toBe(2);
  });

  it("17. webhook timeStamp is used for bostaStatusUpdatedAt (else now)", async () => {
    const row = makeOrderRow({ status: "processing" });
    await applyBostaWebhook(makeFakeDb({ order: row }) as never, payload());
    expect((row.bostaStatusUpdatedAt as unknown as Date).getTime()).toBe(DOCUMENTED_NORMAL.timeStamp);

    const before = Date.now();
    const row2 = makeOrderRow({ status: "processing" });
    await applyBostaWebhook(makeFakeDb({ order: row2 }) as never, payload({ timeStamp: undefined }));
    expect((row2.bostaStatusUpdatedAt as unknown as Date).getTime()).toBeGreaterThanOrEqual(before);

    expect(webhookTimestampToDate(-5).getTime()).toBeGreaterThanOrEqual(before);
    expect(webhookTimestampToDate(12).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("18. unknown businessReference is skipped safely (still logged)", async () => {
    const db = makeFakeDb({ order: null });
    const result = await applyBostaWebhook(db as never, payload());
    expect(result).toMatchObject({ success: true, skipped: true });
    expect(webhookLogMock).toHaveBeenCalledTimes(1);
    expect(db.updates).toHaveLength(0);

    const noRef = await applyBostaWebhook(db as never, payload({ businessReference: null }));
    expect(noRef).toMatchObject({ success: true, skipped: true });
  });

  it("logs a status transition only when the local status actually changes", async () => {
    const row = makeOrderRow({ status: "processing" });
    const db = makeFakeDb({ order: row });
    await applyBostaWebhook(db as never, payload({ state: 41 }));
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock.mock.calls[0]![0]).toMatchObject({
      action: "bosta_status_updated",
      oldStatus: "processing",
      newStatus: "shipped",
    });
    await applyBostaWebhook(db as never, payload({ state: 30 }));
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(reviewMock).not.toHaveBeenCalled();
  });

  it("stale webhook for terminated delivery A after resend B is skipped; B's events still apply", async () => {
    // Order shipped as A; A terminated (state 48 arrives for A while it is still current).
    const row = makeOrderRow({ status: "processing", bostaTrackingNumber: "A", bostaDeliveryId: "d-A", bostaSyncStatus: "sent" });
    const db = makeFakeDb({ order: row });
    await applyBostaWebhook(db as never, payload({ state: 48, trackingNumber: "A" }));
    expect(row.status).toBe("cancelled");
    expect(row.bostaStatus).toBe("Terminated");

    // Admin resend created B (what the dispatcher persists) and the order was reopened.
    Object.assign(row, {
      status: "processing",
      bostaTrackingNumber: "B",
      bostaDeliveryId: "d-B",
      bostaSyncStatus: "sent",
      bostaStatus: "Pickup requested",
      bostaStatusCode: "10",
      bostaWebhookData: null,
    });
    webhookLogMock.mockClear();
    logMock.mockClear();

    // Late/duplicate event for A (e.g. Bosta archiving it) must not touch B.
    const stale = await applyBostaWebhook(db as never, payload({ state: 104, trackingNumber: "A", numberOfAttempts: 1 }));
    expect(stale).toMatchObject({ success: true, skipped: true });
    expect((stale as { reason: string }).reason).toMatch(/not the order's current delivery/);
    expect(webhookLogMock).toHaveBeenCalledTimes(1); // still recorded in the webhook log
    expect(row.status).toBe("processing");
    expect(row.bostaStatus).toBe("Pickup requested");
    expect(row.bostaStatusCode).toBe("10");
    expect(row.bostaWebhookData).toBeNull();
    expect(logMock).not.toHaveBeenCalled();

    // B progresses normally.
    await applyBostaWebhook(db as never, payload({ state: 41, trackingNumber: "B" }));
    expect(row.status).toBe("shipped");
    expect(row.bostaStatus).toBe("Picked up");
    expect((row.bostaWebhookData as unknown as Record<string, unknown>).trackingNumber).toBe("B");
    await applyBostaWebhook(db as never, payload({ state: 45, trackingNumber: "B" }));
    expect(row.status).toBe("delivered");
  });

  it("ignores events for a previous (terminated) delivery of a re-sent order", async () => {
    const row = makeOrderRow({ status: "processing", bostaTrackingNumber: "NEW-1" });
    await applyBostaWebhook(
      makeFakeDb({ order: row }) as never,
      payload({ state: 48, trackingNumber: "OLD-1" }),
    );
    expect(row.status).toBe("processing");
  });
});

describe("webhook auth helpers", () => {
  it("19. raw Authorization secret accepted", () => {
    expect(verifyBostaWebhookSecret(TEST_WEBHOOK_SECRET, TEST_WEBHOOK_SECRET)).toBe(true);
  });

  it("20. Bearer secret accepted", () => {
    expect(verifyBostaWebhookSecret(`Bearer ${TEST_WEBHOOK_SECRET}`, TEST_WEBHOOK_SECRET)).toBe(true);
    expect(extractWebhookToken("bearer   abc ")).toBe("abc");
    expect(extractWebhookToken(["x", "y"])).toBe("x");
  });

  it("21. wrong secret rejected", () => {
    expect(verifyBostaWebhookSecret("nope", TEST_WEBHOOK_SECRET)).toBe(false);
    expect(verifyBostaWebhookSecret(undefined, TEST_WEBHOOK_SECRET)).toBe(false);
    expect(verifyBostaWebhookSecret("", TEST_WEBHOOK_SECRET)).toBe(false);
    expect(verifyBostaWebhookSecret(TEST_WEBHOOK_SECRET, "")).toBe(false);
  });

  it("22. timing-safe comparison handles length mismatches without throwing", () => {
    expect(safeEqual("short", "much-longer-value")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
    expect(safeEqual("same", "same")).toBe(true);
    expect(safeEqual("sam1", "same")).toBe(false);
  });

  it("optional IP allowlist is off by default", () => {
    expect(isIpAllowed("1.2.3.4", [])).toBe(true);
    expect(isIpAllowed("::ffff:34.89.199.241", ["34.89.199.241"])).toBe(true);
    expect(isIpAllowed("9.9.9.9", ["34.89.199.241"])).toBe(false);
    expect(isIpAllowed(undefined, ["34.89.199.241"])).toBe(false);
  });
});

describe("POST /api/webhooks/bosta (fastify route)", () => {
  async function buildApp(row: Record<string, unknown> | null = makeOrderRow({ status: "processing" })) {
    const app = Fastify({ logger: false });
    const db = makeFakeDb({ order: row });
    app.decorateRequest("db", null as never);
    app.addHook("onRequest", (req, _reply, done) => {
      (req as unknown as { db: unknown }).db = db;
      done();
    });
    await app.register(bostaWebhookPlugin, { prefix: "/api/webhooks/bosta" });
    await app.ready();
    return { app, db, row };
  }

  it("accepts the documented payload with the raw secret and updates the order", async () => {
    const { app, row } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/bosta",
      headers: { authorization: TEST_WEBHOOK_SECRET },
      payload: { ...DOCUMENTED_NORMAL, state: 41, businessReference: ORDER_ID },
    });
    expect(res.statusCode).toBe(200);
    expect(row!.status).toBe("shipped");
    await app.close();
  });

  it("accepts Bearer <secret>", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/bosta",
      headers: { authorization: `Bearer ${TEST_WEBHOOK_SECRET}` },
      payload: DOCUMENTED_NORMAL,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a wrong secret with 401 before touching the database", async () => {
    const { app, db } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/bosta",
      headers: { authorization: "wrong" },
      payload: DOCUMENTED_NORMAL,
    });
    expect(res.statusCode).toBe(401);
    expect(db.select).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects an invalid payload with 400", async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/bosta",
      headers: { authorization: TEST_WEBHOOK_SECRET },
      payload: { state: { code: 24, value: "x" }, trackingNumber: "1" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("answers 503 when BOSTA_WEBHOOK_SECRET is unset", async () => {
    const { app } = await buildApp();
    delete process.env.BOSTA_WEBHOOK_SECRET;
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/bosta",
      headers: { authorization: TEST_WEBHOOK_SECRET },
      payload: DOCUMENTED_NORMAL,
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("enforces BOSTA_WEBHOOK_ALLOWED_IPS only when set", async () => {
    const { app } = await buildApp();
    process.env.BOSTA_WEBHOOK_ALLOWED_IPS = "34.89.199.241";
    const res = await app.inject({
      method: "POST",
      url: "/api/webhooks/bosta",
      remoteAddress: "10.0.0.1",
      headers: { authorization: TEST_WEBHOOK_SECRET },
      payload: DOCUMENTED_NORMAL,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
