import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#root/backend/orders/order-log", () => ({
  logOrderEvent: vi.fn(async () => {}),
  recordWebhookLog: vi.fn(async () => "log-1"),
  updateWebhookLogStatus: vi.fn(async () => {}),
}));

vi.mock("../service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../service")>();
  return {
    ...actual,
    createBostaDelivery: vi.fn(async () => ({
      success: true,
      result: { deliveryId: "d-1", trackingNumber: "5108002", stateCode: 10, stateValue: "Pickup requested" },
    })),
  };
});

import { logOrderEvent } from "#root/backend/orders/order-log";
import { createBostaDelivery } from "../service";
import { dispatchOrderToBosta } from "../dispatch";
import { applyOnlinePaymentUpdate } from "#root/backend/payments/confirm-online-payment";
import { clearBostaEnv, DISTRICT_ID, makeFakeDb, makeOrderRow, ORDER_ID, setBostaEnv } from "./test-utils";

const createMock = vi.mocked(createBostaDelivery);
const logMock = vi.mocked(logOrderEvent);
const items = [{ name: "Shirt", quantity: 2 }];

beforeEach(() => {
  setBostaEnv();
  createMock.mockClear();
  createMock.mockResolvedValue({
    success: true,
    result: { deliveryId: "d-1", trackingNumber: "5108002", stateCode: 10, stateValue: "Pickup requested" },
  });
  logMock.mockClear();
});
afterEach(() => clearBostaEnv());

describe("dispatchOrderToBosta", () => {
  it("47. COD auto-send goes through the canonical builder and marks the order sent", async () => {
    const row = makeOrderRow();
    const db = makeFakeDb({ order: row, items });
    const result = await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "checkout_cod" });

    expect(result).toEqual({ status: "sent", trackingNumber: "5108002", deliveryId: "d-1" });
    expect(createMock).toHaveBeenCalledTimes(1);
    const input = createMock.mock.calls[0]![0];
    expect(input).toMatchObject({
      orderId: ORDER_ID,
      cod: 140,
      goodsAmount: 120,
      itemsCount: 2,
      dropOffAddress: { districtId: DISTRICT_ID, city: "Cairo", zone: "15 May", firstLine: "12 Tahrir St" },
      receiver: { firstName: "Ahmed", lastName: "Ali", phone: "01000000000" },
    });
    expect(row.bostaSyncStatus).toBe("sent");
    expect(row.bostaTrackingNumber).toBe("5108002");
    expect(row.bostaDeliveryId).toBe("d-1");
    expect(logMock.mock.calls.map((c) => c[0].action)).toEqual(["bosta_sent"]);
  });

  it("48. paid online auto-send uses the same builder with cod = 0", async () => {
    const row = makeOrderRow({ paymentMethod: "fawaterak", paymentStatus: "pending", bostaSyncStatus: "skipped" });
    const db = makeFakeDb({ order: row, items });

    await applyOnlinePaymentUpdate(db as never, ORDER_ID, { paymentStatus: "paid", transactionId: "t-1" });

    expect(createMock).toHaveBeenCalledTimes(1);
    const input = createMock.mock.calls[0]![0];
    expect(input.cod).toBe(0);
    expect(input.dropOffAddress).toMatchObject({ districtId: DISTRICT_ID, city: "Cairo", zone: "15 May" });
    expect(row.bostaSyncStatus).toBe("sent");
  });

  it("49. an online order that is still pending is not sent", async () => {
    const row = makeOrderRow({ paymentMethod: "paymob", paymentStatus: "pending", bostaSyncStatus: "skipped" });
    const db = makeFakeDb({ order: row, items });
    const result = await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "payment_confirmed" });
    expect(result).toMatchObject({ status: "blocked", code: "payment_not_confirmed" });
    expect(createMock).not.toHaveBeenCalled();
    expect(row.bostaSyncStatus).toBe("skipped");
  });

  it("50. admin manual send of an unpaid online order is blocked", async () => {
    const row = makeOrderRow({ paymentMethod: "stripe", paymentStatus: "failed", bostaSyncStatus: "skipped" });
    const db = makeFakeDb({ order: row, items });
    const result = await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "manual", actor: "admin@x" });
    expect(result).toMatchObject({ status: "blocked", code: "payment_not_confirmed" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("51. an already-sent order is never re-sent", async () => {
    for (const overrides of [
      { bostaSyncStatus: "sent" },
      { bostaSyncStatus: "failed", bostaTrackingNumber: "T-1" },
      { bostaSyncStatus: null, bostaDeliveryId: "d-old" },
    ]) {
      createMock.mockClear();
      const row = makeOrderRow(overrides);
      const db = makeFakeDb({ order: row, items });
      const result = await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "manual" });
      expect(result, JSON.stringify(overrides)).toMatchObject({ status: "blocked", code: "already_sent" });
      expect(createMock).not.toHaveBeenCalled();
    }
  });

  it("52. two concurrent sends create exactly one Bosta delivery", async () => {
    const row = makeOrderRow();
    const db = makeFakeDb({ order: row, items });
    let release!: () => void;
    createMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              success: true,
              result: { deliveryId: "d-1", trackingNumber: "5108002", stateCode: 10, stateValue: "Pickup requested" },
            });
        }),
    );

    const a = dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "checkout_cod" });
    const b = dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "manual", actor: "admin@x" });
    // Let both reach the claim before the first network call resolves.
    await new Promise((r) => setTimeout(r, 0));
    release();
    const [ra, rb] = await Promise.all([a, b]);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect([ra.status, rb.status].sort()).toEqual(["blocked", "sent"]);
    const blocked = ra.status === "blocked" ? ra : rb;
    expect(blocked).toMatchObject({ code: "in_flight" });
    expect(row.bostaSyncStatus).toBe("sent");
  });

  it("an in-flight (recent pending) claim blocks a second caller", async () => {
    const row = makeOrderRow({ bostaSyncStatus: "pending", bostaSyncAttemptedAt: new Date() });
    const db = makeFakeDb({ order: row, items });
    const result = await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "manual" });
    expect(result).toMatchObject({ status: "blocked", code: "in_flight" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("53. a Bosta API failure marks the claim failed with the reason (no throw)", async () => {
    createMock.mockResolvedValueOnce({ success: false, kind: "api", error: "[Bosta] Internal Server Error" });
    const row = makeOrderRow();
    const db = makeFakeDb({ order: row, items });
    const result = await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "checkout_cod" });
    expect(result).toMatchObject({ status: "failed", code: "api" });
    expect(row.bostaSyncStatus).toBe("failed");
    expect(row.bostaSyncError).toMatch(/Internal Server Error/);
    expect(row.bostaDeliveryId).toBeNull();
    expect(logMock.mock.calls.map((c) => c[0].action)).toEqual(["bosta_send_failed"]);

    // A thrown error is handled the same way.
    createMock.mockRejectedValueOnce(new Error("network down"));
    row.bostaSyncStatus = null;
    const again = await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "checkout_cod" });
    expect(again).toMatchObject({ status: "failed", code: "api", reason: "network down" });
    expect(row.bostaSyncStatus).toBe("failed");
  });

  it("54. the Bosta-side dedupe key (uniqueBusinessReference) is the order id", async () => {
    // The request body is built in service.ts; the builder receives the id here.
    const row = makeOrderRow();
    const db = makeFakeDb({ order: row, items });
    await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "checkout_cod" });
    expect(createMock.mock.calls[0]![0].orderId).toBe(ORDER_ID);
  });

  it("an order without an exact district is not guessed — it fails clearly and stays creatable", async () => {
    createMock.mockResolvedValueOnce({
      success: false,
      kind: "validation",
      error: "No Bosta district in Cairo matches area \"Downtown\" — select the exact delivery district",
    });
    const row = makeOrderRow({ shippingDistrict: "", shippingCity: "Downtown" });
    const db = makeFakeDb({ order: row, items });
    const result = await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "checkout_cod" });
    expect(result).toMatchObject({ status: "failed", code: "validation" });
    expect(row.bostaSyncStatus).toBe("failed");
    expect(row.bostaSyncError).toMatch(/select the exact delivery district/);
    expect(createMock.mock.calls[0]![0].dropOffAddress.districtId).toBeNull();
  });

  it("55. does nothing when Bosta is disabled", async () => {
    clearBostaEnv();
    const row = makeOrderRow();
    const db = makeFakeDb({ order: row, items });
    const result = await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "checkout_cod" });
    expect(result).toMatchObject({ status: "skipped", code: "not_configured" });
    expect(db.updates).toHaveLength(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  describe("uniqueBusinessReference strategy (Bosta: unique across all deliveries)", () => {
    const sentAs = (n: number) =>
      createMock.mock.calls[n]![0] as { orderId: string; uniqueBusinessReference?: string };

    it("R1. the initial shipment uses the bare order id, stably", async () => {
      const row = makeOrderRow();
      const db = makeFakeDb({ order: row, items });
      await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "checkout_cod" });
      expect(sentAs(0).uniqueBusinessReference).toBe(ORDER_ID);

      // A retry after a failure sends exactly the same key (no random per-retry value).
      createMock.mockResolvedValueOnce({ success: false, kind: "api", error: "boom" });
      const row2 = makeOrderRow();
      const db2 = makeFakeDb({ order: row2, items });
      await dispatchOrderToBosta(db2 as never, ORDER_ID, { trigger: "checkout_cod" });
      await dispatchOrderToBosta(db2 as never, ORDER_ID, { trigger: "manual" });
      expect(sentAs(1).uniqueBusinessReference).toBe(ORDER_ID);
      expect(sentAs(2).uniqueBusinessReference).toBe(ORDER_ID);
    });

    it("R2. the initial duplicate is still blocked locally", async () => {
      const row = makeOrderRow();
      const db = makeFakeDb({ order: row, items });
      await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "checkout_cod" });
      const again = await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "manual" });
      expect(again).toMatchObject({ status: "blocked", code: "already_sent" });
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it("R3. the first resend uses a different key derived from the terminated delivery", async () => {
      const row = makeOrderRow({ bostaSyncStatus: "cancelled", bostaTrackingNumber: "A", bostaDeliveryId: "d-A" });
      const db = makeFakeDb({ order: row, items });
      const result = await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "manual", resendAfterCancel: true });
      expect(result).toMatchObject({ status: "sent" });
      expect(sentAs(0).uniqueBusinessReference).toBe(`${ORDER_ID}:resend:A`);
      expect(sentAs(0).uniqueBusinessReference).not.toBe(ORDER_ID);
    });

    it("R4. concurrent first-resend attempts collapse to one delivery, and a failed resend retries with the same key", async () => {
      const row = makeOrderRow({ bostaSyncStatus: "cancelled", bostaTrackingNumber: "A", bostaDeliveryId: "d-A" });
      const db = makeFakeDb({ order: row, items });
      let release!: () => void;
      createMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                success: true,
                result: { deliveryId: "d-B", trackingNumber: "B", stateCode: 10, stateValue: "Pickup requested" },
              });
          }),
      );
      const a = dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "manual", resendAfterCancel: true });
      const b = dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "manual", resendAfterCancel: true });
      await new Promise((r) => setTimeout(r, 0));
      release();
      const [ra, rb] = await Promise.all([a, b]);
      expect(createMock).toHaveBeenCalledTimes(1);
      expect([ra.status, rb.status].sort()).toEqual(["blocked", "sent"]);
      expect(row.bostaTrackingNumber).toBe("B");

      // Failed resend: row returns to "cancelled" with the error; the retry
      // (again explicit) reuses the identical dedupe key.
      createMock.mockClear();
      createMock.mockResolvedValueOnce({ success: false, kind: "api", error: "Bosta 500" });
      const row2 = makeOrderRow({ bostaSyncStatus: "cancelled", bostaTrackingNumber: "A", bostaDeliveryId: "d-A" });
      const db2 = makeFakeDb({ order: row2, items });
      const failed = await dispatchOrderToBosta(db2 as never, ORDER_ID, { trigger: "manual", resendAfterCancel: true });
      expect(failed).toMatchObject({ status: "failed", code: "api" });
      expect(row2.bostaSyncStatus).toBe("cancelled");
      expect(row2.bostaSyncError).toBe("Bosta 500");
      expect(row2.bostaTrackingNumber).toBe("A");
      // Not silently retried by an automatic path...
      const auto = await dispatchOrderToBosta(db2 as never, ORDER_ID, { trigger: "payment_confirmed" });
      expect(auto).toMatchObject({ status: "blocked", code: "cancelled" });
      // ...but an explicit retry works and carries the same key.
      const retry = await dispatchOrderToBosta(db2 as never, ORDER_ID, { trigger: "manual", resendAfterCancel: true });
      expect(retry).toMatchObject({ status: "sent" });
      expect(sentAs(0).uniqueBusinessReference).toBe(`${ORDER_ID}:resend:A`);
      expect(sentAs(1).uniqueBusinessReference).toBe(`${ORDER_ID}:resend:A`);
    });

    it("R5. a second resend after another termination gets a different key", async () => {
      const row = makeOrderRow({ bostaSyncStatus: "cancelled", bostaTrackingNumber: "A", bostaDeliveryId: "d-A" });
      const db = makeFakeDb({ order: row, items });
      createMock.mockResolvedValueOnce({
        success: true,
        result: { deliveryId: "d-B", trackingNumber: "B", stateCode: 10, stateValue: "Pickup requested" },
      });
      await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "manual", resendAfterCancel: true });
      expect(row.bostaTrackingNumber).toBe("B");

      // Delivery B is terminated in turn (what cancelDelivery persists).
      Object.assign(row, { bostaSyncStatus: "cancelled" });
      createMock.mockResolvedValueOnce({
        success: true,
        result: { deliveryId: "d-C", trackingNumber: "C", stateCode: 10, stateValue: "Pickup requested" },
      });
      await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "manual", resendAfterCancel: true });

      expect(sentAs(0).uniqueBusinessReference).toBe(`${ORDER_ID}:resend:A`);
      expect(sentAs(1).uniqueBusinessReference).toBe(`${ORDER_ID}:resend:B`);
      expect(row.bostaTrackingNumber).toBe("C");
    });

    it("R6. businessReference (orderId) is identical on every attempt", async () => {
      // Each created delivery gets its own tracking number, as Bosta would.
      for (const tn of ["A", "B", "C"]) {
        createMock.mockResolvedValueOnce({
          success: true,
          result: { deliveryId: `d-${tn}`, trackingNumber: tn, stateCode: 10, stateValue: "Pickup requested" },
        });
      }
      const row = makeOrderRow();
      const db = makeFakeDb({ order: row, items });
      await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "checkout_cod" });
      Object.assign(row, { bostaSyncStatus: "cancelled" });
      await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "manual", resendAfterCancel: true });
      Object.assign(row, { bostaSyncStatus: "cancelled" });
      await dispatchOrderToBosta(db as never, ORDER_ID, { trigger: "manual", resendAfterCancel: true });
      expect(createMock).toHaveBeenCalledTimes(3);
      for (let i = 0; i < 3; i++) expect(sentAs(i).orderId).toBe(ORDER_ID);
      const keys = [0, 1, 2].map((i) => sentAs(i).uniqueBusinessReference);
      expect(new Set(keys).size).toBe(3);
    });
  });

  it("does not resend a terminated delivery unless explicitly asked", async () => {
    const row = makeOrderRow({ bostaSyncStatus: "cancelled", bostaTrackingNumber: "OLD", bostaDeliveryId: "d-old" });
    const db = makeFakeDb({ order: row, items });

    for (const trigger of ["checkout_cod", "payment_confirmed", "manual"] as const) {
      const result = await dispatchOrderToBosta(db as never, ORDER_ID, { trigger });
      expect(result, trigger).toMatchObject({ status: "blocked", code: "cancelled" });
    }
    expect(createMock).not.toHaveBeenCalled();

    const resend = await dispatchOrderToBosta(db as never, ORDER_ID, {
      trigger: "manual",
      actor: "admin@x",
      resendAfterCancel: true,
    });
    expect(resend).toMatchObject({ status: "sent", trackingNumber: "5108002" });
    expect(row.bostaTrackingNumber).toBe("5108002");
  });
});
