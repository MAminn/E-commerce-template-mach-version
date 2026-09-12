/**
 * Shared fixtures for the Fawaterak unit tests. No network, no database.
 */
import { createHmac } from "node:crypto";
import { vi } from "vitest";
import { order, orderItem } from "#root/shared/database/drizzle/schema";

export const TEST_ENV = {
  FAWATERAK_CLIENT_ID: "11111111-2222-3333-4444-555555555555",
  FAWATERAK_CLIENT_SECRET: "super-secret-client-secret-DO-NOT-LOG",
  FAWATERAK_VENDOR_API_KEY: "vendor-hash-key-DO-NOT-LOG",
  FAWATERAK_BASE_URL: "https://fawaterak.test",
  PUBLIC_ORIGIN: "https://shop.example.test",
} as const;

export const TEST_ACCESS_TOKEN = "eyJ.access.token-DO-NOT-LOG";

export function setFawaterakEnv(overrides: Partial<Record<keyof typeof TEST_ENV, string | undefined>> = {}) {
  const merged: Record<string, string | undefined> = { ...TEST_ENV, ...overrides };
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

export function clearFawaterakEnv() {
  for (const k of Object.keys(TEST_ENV)) delete process.env[k];
}

export function clearOtherGatewayEnv() {
  for (const k of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "VITE_STRIPE_PUBLIC_KEY",
    "PAYMOB_SECRET_KEY",
    "PAYMOB_API_KEY",
    "PAYMOB_PUBLIC_KEY",
    "PAYMOB_CARD_INTEGRATION_ID",
    "PAYMOB_WALLET_INTEGRATION_ID",
    "PAYMOB_INTEGRATION_ID",
    "PAYMOB_HMAC_SECRET",
  ]) {
    delete process.env[k];
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const tokenResponse = (token = TEST_ACCESS_TOKEN, expiresIn = 31536000) =>
  jsonResponse({
    token_type: "Bearer",
    expires_in: expiresIn,
    access_token: token,
  });

export const ORDER_ID = "0f6a1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
export const INTENT_KEY = "550e8400-e29b-41d4-a716-446655440000";

export const createTransactionResponse = (intentKey = INTENT_KEY) =>
  jsonResponse({
    status: "success",
    message: "Transaction link created",
    data: {
      intent_key: intentKey,
      url: `https://fawaterak.test/ts/${intentKey.slice(0, 5)}`,
      expires_in: 2592000,
    },
  });

export function providerTransaction(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    intent_key: INTENT_KEY,
    transaction_id: 12345,
    customer_email: "ahmed@example.com",
    paid: 1,
    paid_at: "2026-09-01 12:05:00",
    status_text: "paid",
    total: 150,
    currency: "EGP",
    payment_method: "Visa-Mastercard",
    pay_load: { orderId: ORDER_ID },
    ...overrides,
  };
}

export const transactionDataResponse = (overrides: Record<string, unknown> = {}) =>
  jsonResponse({ status: "success", data: providerTransaction(overrides) });

export function hmacHex(stringToSign: string, key: string = TEST_ENV.FAWATERAK_VENDOR_API_KEY): string {
  return createHmac("sha256", key).update(stringToSign, "utf8").digest("hex");
}

export function signPaid(fields: {
  transaction_id: string | number;
  transaction_key: string;
  payment_method: string;
}): string {
  return hmacHex(
    `TransactionId=${fields.transaction_id}&TransactionKey=${fields.transaction_key}&PaymentMethod=${fields.payment_method}`,
  );
}

export function signCancel(fields: { referenceId: string | number; paymentMethod: string }): string {
  return hmacHex(`referenceId=${fields.referenceId}&PaymentMethod=${fields.paymentMethod}`);
}

/** Minimal order row as stored by the repo (decimal strings). */
export function makeOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    customerName: "Ahmed Ali",
    customerEmail: "ahmed@example.com",
    customerPhone: "01000000000",
    shippingAddress: "12 Tahrir St",
    shippingCity: "Cairo",
    shippingState: "Cairo",
    subtotal: "130.00",
    shipping: "20.00",
    tax: "0.00",
    discount: null,
    total: "150.00",
    status: "pending",
    notes: null,
    paymentMethod: "fawaterak",
    paymentStatus: "pending",
    paymentSessionId: INTENT_KEY,
    paymentTransactionId: null,
    paymentGatewayData: null,
    bostaSyncStatus: "skipped",
    bostaDeliveryId: null,
    ...overrides,
  };
}

/**
 * Tiny in-memory stand-in for the drizzle client, covering exactly the chains
 * the payment code uses: select(...).from(t).where(...).limit(n).execute()
 * and update(t).set(v).where(...).execute(). Every test works on one order,
 * so `where` is accepted and ignored.
 */
export function makeFakeDb(state: {
  order: Record<string, unknown> | null;
  items?: Array<{ name: string; quantity: number; price: string }>;
}) {
  const updates: Array<Record<string, unknown>> = [];

  const selectChain = (table: unknown) => {
    // Snapshots, like a real query — mutations happen only through update().
    const rows = () => {
      if (table === order) return state.order ? [{ ...state.order }] : [];
      if (table === orderItem) return (state.items ?? []).map((i) => ({ ...i }));
      return [];
    };
    const chain: Record<string, unknown> = {};
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.orderBy = () => chain;
    chain.execute = async () => rows();
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows()).then(resolve, reject);
    return chain;
  };

  const db = {
    select: vi.fn(() => ({ from: (table: unknown) => selectChain(table) })),
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          const apply = () => {
            if (table === order && state.order) {
              Object.assign(state.order, values);
              updates.push(values);
              return [{ id: state.order.id }];
            }
            return [];
          };
          return {
            execute: async () => {
              apply();
            },
            // The Bosta dispatcher claims the row with UPDATE … RETURNING.
            returning: () => ({ execute: async () => apply() }),
          };
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: () => ({ returning: async () => [{ id: "log-1" }] }),
    })),
    updates,
  };
  return db;
}
