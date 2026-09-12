import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#root/backend/orders/order-log", () => ({
  logOrderEvent: vi.fn(async () => {}),
  recordWebhookLog: vi.fn(async () => "log-1"),
  updateWebhookLogStatus: vi.fn(async () => {}),
}));

vi.mock("#root/backend/orders/bosta/service", () => ({
  isBostaEnabled: vi.fn(() => true),
  createBostaDelivery: vi.fn(async () => ({
    success: true,
    result: { trackingNumber: "BOSTA-1", deliveryId: "d-1" },
  })),
}));

vi.mock("#root/backend/orders/bosta/sync-status", () => ({
  persistBostaSyncStatus: vi.fn(async () => {}),
}));

import { applyOnlinePaymentUpdate } from "#root/backend/payments/confirm-online-payment";
import { logOrderEvent } from "#root/backend/orders/order-log";
import { createBostaDelivery } from "#root/backend/orders/bosta/service";
import { persistBostaSyncStatus } from "#root/backend/orders/bosta/sync-status";
import {
  processFawaterakPaidWebhook,
  type FawaterakWebhookDeps,
} from "#root/backend/payments/fawaterak-webhook";
import {
  clearFawaterakEnv,
  INTENT_KEY,
  makeFakeDb,
  makeOrderRow,
  ORDER_ID,
  providerTransaction,
  setFawaterakEnv,
  signPaid,
} from "./fawaterak-test-utils";

const logMock = vi.mocked(logOrderEvent);
const bostaMock = vi.mocked(createBostaDelivery);
const persistMock = vi.mocked(persistBostaSyncStatus);

beforeEach(() => {
  setFawaterakEnv();
  logMock.mockClear();
  bostaMock.mockClear();
  persistMock.mockClear();
});
afterEach(() => clearFawaterakEnv());

describe("applyOnlinePaymentUpdate idempotency (real helper, fake db)", () => {
  it("20a. the same paid update twice: one transition, one payment_confirmed log, one Bosta dispatch", async () => {
    const orderRow = makeOrderRow({ bostaSyncStatus: "skipped" });
    const db = makeFakeDb({ order: orderRow, items: [] });
    const update = { paymentStatus: "paid" as const, transactionId: "12345", gatewayData: { paid: 1 } };

    const first = await applyOnlinePaymentUpdate(db as never, ORDER_ID, update);
    const second = await applyOnlinePaymentUpdate(db as never, ORDER_ID, update);

    expect(first).toEqual({ updated: true, paymentStatus: "paid" });
    expect(second).toEqual({ updated: true, paymentStatus: "paid" });
    expect(orderRow.paymentStatus).toBe("paid");
    expect(orderRow.status).toBe("processing");
    expect(orderRow.paymentTransactionId).toBe("12345");

    const confirmedLogs = logMock.mock.calls.filter((c) => c[0].action === "payment_confirmed");
    expect(confirmedLogs).toHaveLength(1);
    expect(bostaMock).toHaveBeenCalledTimes(1);
  });

  it("20b. Bosta is not dispatched again when the order was already sent", async () => {
    const orderRow = makeOrderRow({ bostaSyncStatus: "sent", bostaDeliveryId: "d-existing" });
    const db = makeFakeDb({ order: orderRow, items: [] });
    await applyOnlinePaymentUpdate(db as never, ORDER_ID, { paymentStatus: "paid", transactionId: "1" });
    expect(bostaMock).not.toHaveBeenCalled();
  });

  it("20c. webhook and verify racing on the same order produce a single confirmation", async () => {
    // Simulates: verify poll flips the order paid, then the paid webhook lands.
    const orderRow = makeOrderRow({ bostaSyncStatus: "skipped" });
    const db = makeFakeDb({ order: orderRow, items: [] });

    // 1) verify path
    await applyOnlinePaymentUpdate(db as never, ORDER_ID, {
      paymentStatus: "paid",
      transactionId: "12345",
      gatewayData: providerTransaction(),
    });

    // 2) webhook path, wired to the same row and the real helper
    const deps: FawaterakWebhookDeps = {
      findOrderById: async () => ({
        id: orderRow.id as string,
        paymentMethod: orderRow.paymentMethod as string,
        paymentStatus: orderRow.paymentStatus as string,
        paymentSessionId: orderRow.paymentSessionId as string,
        paymentTransactionId: orderRow.paymentTransactionId as string | null,
        total: orderRow.total as string,
      }),
      fetchTransaction: vi.fn(async () => providerTransaction()),
      applyPaymentUpdate: (id, update) => applyOnlinePaymentUpdate(db as never, id, update),
      recordGatewayData: vi.fn(async () => {}),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const outcome = await processFawaterakPaidWebhook(
      {
        transaction_id: 12345,
        transaction_key: INTENT_KEY,
        payment_method: "Visa-Mastercard",
        status: "paid",
        pay_load: JSON.stringify({ orderId: ORDER_ID }),
        transactionHashKey: signPaid({
          transaction_id: 12345,
          transaction_key: INTENT_KEY,
          payment_method: "Visa-Mastercard",
        }),
      },
      deps,
    );

    expect(outcome.statusCode).toBe(200);
    expect(outcome.body.result).toBe("already_paid");
    expect(deps.fetchTransaction).not.toHaveBeenCalled();
    expect(logMock.mock.calls.filter((c) => c[0].action === "payment_confirmed")).toHaveLength(1);
    expect(bostaMock).toHaveBeenCalledTimes(1);
    expect(orderRow.paymentStatus).toBe("paid");
  });

  it("failed after paid: the Fawaterak webhook layer refuses; the row stays paid", async () => {
    const orderRow = makeOrderRow({ paymentStatus: "paid", status: "processing", bostaSyncStatus: "sent" });
    const db = makeFakeDb({ order: orderRow, items: [] });
    const deps: FawaterakWebhookDeps = {
      findOrderById: async () => ({
        id: ORDER_ID,
        paymentMethod: "fawaterak",
        paymentStatus: orderRow.paymentStatus as string,
        paymentSessionId: INTENT_KEY,
        paymentTransactionId: "12345",
        total: "150.00",
      }),
      fetchTransaction: vi.fn(async () => providerTransaction()),
      applyPaymentUpdate: (id, update) => applyOnlinePaymentUpdate(db as never, id, update),
      recordGatewayData: vi.fn(async () => {}),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const { processFawaterakFailedWebhook } = await import("#root/backend/payments/fawaterak-webhook");
    const outcome = await processFawaterakFailedWebhook(
      {
        transaction_id: 12345,
        transaction_key: INTENT_KEY,
        payment_method: "Visa-Mastercard",
        pay_load: JSON.stringify({ orderId: ORDER_ID }),
        hashKey: signPaid({
          transaction_id: 12345,
          transaction_key: INTENT_KEY,
          payment_method: "Visa-Mastercard",
        }),
      },
      deps,
    );
    expect(outcome.body.result).toBe("already_paid");
    expect(orderRow.paymentStatus).toBe("paid");
    expect(db.updates).toHaveLength(0);
  });
});
