import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Module mocks (must be hoisted before the router import) ──────────────

vi.mock("#root/backend/payments/confirm-online-payment", () => ({
  applyOnlinePaymentUpdate: vi.fn(async () => ({ updated: true, paymentStatus: "paid" })),
  extractPaymobOrderId: vi.fn(() => null),
}));

vi.mock("stripe", () => {
  const create = vi.fn(async () => ({
    id: "cs_test_123",
    url: "https://checkout.stripe.com/c/pay/cs_test_123",
  }));
  const retrieve = vi.fn(async () => ({ payment_status: "unpaid" }));
  class Stripe {
    checkout = { sessions: { create, retrieve } };
  }
  return { default: Stripe, __mocks: { create, retrieve } };
});

vi.mock("axios", () => {
  const post = vi.fn(async () => ({
    data: { id: 987, client_secret: "cs_paymob_secret" },
  }));
  const get = vi.fn(async () => ({ data: { success: false } }));
  return {
    default: { post, get, isAxiosError: () => false },
    isAxiosError: () => false,
    __mocks: { post, get },
  };
});

import { paymentRouter } from "#root/backend/payments/trpc";
import { applyOnlinePaymentUpdate } from "#root/backend/payments/confirm-online-payment";
import { clearFawaterakTokenCache } from "#root/backend/payments/fawaterak-service";
import * as stripeModule from "stripe";
import * as axiosModule from "axios";
import {
  clearFawaterakEnv,
  clearOtherGatewayEnv,
  createTransactionResponse,
  INTENT_KEY,
  jsonResponse,
  makeFakeDb,
  makeOrderRow,
  ORDER_ID,
  setFawaterakEnv,
  TEST_ENV,
  tokenResponse,
  transactionDataResponse,
} from "./fawaterak-test-utils";

const stripeMocks = (stripeModule as unknown as { __mocks: { create: ReturnType<typeof vi.fn>; retrieve: ReturnType<typeof vi.fn> } }).__mocks;
const axiosMocks = (axiosModule as unknown as { __mocks: { post: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } }).__mocks;
const applyUpdateMock = vi.mocked(applyOnlinePaymentUpdate);

// ─── Helpers ──────────────────────────────────────────────────────────────

function installFetch(...responses: Response[]) {
  const queue = [...responses];
  const mock = vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error("fetch mock: no more responses queued");
    return next;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function makeCaller(db: ReturnType<typeof makeFakeDb>) {
  return paymentRouter.createCaller({
    db: db as never,
    clientSession: null as never,
    emailService: null as never,
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  });
}

const sessionInput = {
  orderId: ORDER_ID,
  successUrl: "https://evil.example/success",
  cancelUrl: "https://evil.example/cancel",
};

beforeEach(() => {
  clearOtherGatewayEnv();
  clearFawaterakEnv();
  clearFawaterakTokenCache();
  applyUpdateMock.mockClear();
  stripeMocks.create.mockClear();
  stripeMocks.retrieve.mockClear();
  axiosMocks.post.mockClear();
  axiosMocks.get.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearOtherGatewayEnv();
  clearFawaterakEnv();
});

// ─── payment.methods ──────────────────────────────────────────────────────

describe("payment.methods", () => {
  it("41. fawaterak appears only when configured, without secrets", async () => {
    const caller = makeCaller(makeFakeDb({ order: null }));

    const before = await caller.methods();
    expect(before.methods.map((m) => m.id)).toEqual(["cod"]);
    expect(before.hasOnlinePayment).toBe(false);

    setFawaterakEnv();
    const after = await caller.methods();
    expect(after.methods.map((m) => m.id)).toEqual(["cod", "fawaterak"]);
    expect(after.methods.find((m) => m.id === "fawaterak")?.label).toBe("Online Payment");
    expect(after.hasOnlinePayment).toBe(true);
    expect(after.stripePublicKey).toBeNull();

    const serialized = JSON.stringify(after);
    expect(serialized).not.toContain(TEST_ENV.FAWATERAK_CLIENT_ID);
    expect(serialized).not.toContain(TEST_ENV.FAWATERAK_CLIENT_SECRET);
    expect(serialized).not.toContain(TEST_ENV.FAWATERAK_VENDOR_API_KEY);
  });
});

// ─── payment.createSession ────────────────────────────────────────────────

describe("payment.createSession — fawaterak", () => {
  it("42. creates a hosted transaction from DB data and persists intent_key as paymentSessionId", async () => {
    setFawaterakEnv();
    const fetchMock = installFetch(tokenResponse(), createTransactionResponse());
    const orderRow = makeOrderRow({ paymentMethod: "cod", paymentStatus: "pending", paymentSessionId: null });
    const db = makeFakeDb({
      order: orderRow,
      items: [{ name: "Blue Hoodie", quantity: 1, price: "130.00" }],
    });
    const caller = makeCaller(db);

    const res = await caller.createSession({ ...sessionInput, paymentMethod: "fawaterak" });

    expect(res.success).toBe(true);
    if (!res.success) throw new Error("expected success");
    expect(res.result).toEqual({
      paymentUrl: `https://fawaterak.test/ts/${INTENT_KEY.slice(0, 5)}`,
      sessionId: INTENT_KEY,
    });

    // Request came from the DB row, not the browser.
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.cartTotal).toBe("150.00");
    expect(body.currency).toBe("EGP");
    expect(body.pay_load).toEqual({ orderId: ORDER_ID });
    expect(body).not.toHaveProperty("payment_method_id");
    const urls = body.redirectionUrls as Record<string, string>;
    for (const u of Object.values(urls)) {
      expect(u.startsWith(TEST_ENV.PUBLIC_ORIGIN)).toBe(true);
      expect(u).not.toContain("evil.example");
    }

    // Persisted identity mapping.
    expect(orderRow.paymentMethod).toBe("fawaterak");
    expect(orderRow.paymentStatus).toBe("pending");
    expect(orderRow.paymentSessionId).toBe(INTENT_KEY);
    expect(orderRow.paymentTransactionId).toBeNull();
  });

  it("rejects fawaterak when not configured, without touching the network", async () => {
    const fetchMock = installFetch();
    const caller = makeCaller(makeFakeDb({ order: makeOrderRow() }));
    const res = await caller.createSession({ ...sessionInput, paymentMethod: "fawaterak" });
    expect(res.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to create a session for an already-paid order", async () => {
    setFawaterakEnv();
    const fetchMock = installFetch();
    const caller = makeCaller(makeFakeDb({ order: makeOrderRow({ paymentStatus: "paid" }) }));
    const res = await caller.createSession({ ...sessionInput, paymentMethod: "fawaterak" });
    expect(res.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a safe error (no secrets) when the provider rejects", async () => {
    setFawaterakEnv();
    installFetch(tokenResponse(), jsonResponse({ status: "error", message: "Unable to resolve vendor from OAuth client" }, 401), tokenResponse(), jsonResponse({ status: "error", message: "Unable to resolve vendor from OAuth client" }, 401));
    const orderRow = makeOrderRow({ paymentMethod: "cod", paymentSessionId: null });
    const caller = makeCaller(makeFakeDb({ order: orderRow }));
    const res = await caller.createSession({ ...sessionInput, paymentMethod: "fawaterak" });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain(TEST_ENV.FAWATERAK_CLIENT_SECRET);
    expect(orderRow.paymentSessionId).toBeNull();
  });
});

// ─── payment.verify ───────────────────────────────────────────────────────

describe("payment.verify — fawaterak", () => {
  it("43. verified paid provider data marks the order paid through applyOnlinePaymentUpdate", async () => {
    setFawaterakEnv();
    const fetchMock = installFetch(tokenResponse(), transactionDataResponse());
    const caller = makeCaller(makeFakeDb({ order: makeOrderRow() }));

    const res = await caller.verify({ orderId: ORDER_ID });
    expect(res.success).toBe(true);
    if (!res.success) throw new Error("expected success");
    expect(res.result.paymentStatus).toBe("paid");
    expect(res.result.status).toBe("processing");

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://fawaterak.test/api/v3/getTransactionData");
    expect(JSON.parse(init.body as string)).toEqual({ intent_key: INTENT_KEY });

    expect(applyUpdateMock).toHaveBeenCalledTimes(1);
    expect(applyUpdateMock.mock.calls[0]?.[1]).toBe(ORDER_ID);
    expect(applyUpdateMock.mock.calls[0]?.[2]).toMatchObject({
      paymentStatus: "paid",
      transactionId: "12345",
    });
  });

  it("unpaid provider data leaves the order pending", async () => {
    setFawaterakEnv();
    installFetch(tokenResponse(), transactionDataResponse({ paid: 0, status_text: "unpaid", transaction_id: 0 }));
    const caller = makeCaller(makeFakeDb({ order: makeOrderRow() }));
    const res = await caller.verify({ orderId: ORDER_ID });
    expect(res.success).toBe(true);
    if (!res.success) throw new Error("expected success");
    expect(res.result.paymentStatus).toBe("pending");
    expect(applyUpdateMock).not.toHaveBeenCalled();
  });

  it("paid-but-mismatched provider data (amount) never flips the order", async () => {
    setFawaterakEnv();
    installFetch(tokenResponse(), transactionDataResponse({ total: 1 }));
    const caller = makeCaller(makeFakeDb({ order: makeOrderRow() }));
    const res = await caller.verify({ orderId: ORDER_ID });
    expect(res.success).toBe(true);
    if (!res.success) throw new Error("expected success");
    expect(res.result.paymentStatus).toBe("pending");
    expect(applyUpdateMock).not.toHaveBeenCalled();
  });

  it("provider outage leaves DB state untouched and still answers", async () => {
    setFawaterakEnv();
    installFetch(tokenResponse(), jsonResponse({ status: "error", message: "unavailable" }, 503));
    const caller = makeCaller(makeFakeDb({ order: makeOrderRow() }));
    const res = await caller.verify({ orderId: ORDER_ID });
    expect(res.success).toBe(true);
    if (!res.success) throw new Error("expected success");
    expect(res.result.paymentStatus).toBe("pending");
    expect(applyUpdateMock).not.toHaveBeenCalled();
  });

  it("does not poll the provider for an already-paid fawaterak order", async () => {
    setFawaterakEnv();
    const fetchMock = installFetch();
    const caller = makeCaller(makeFakeDb({ order: makeOrderRow({ paymentStatus: "paid" }) }));
    const res = await caller.verify({ orderId: ORDER_ID });
    expect(res.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(applyUpdateMock).not.toHaveBeenCalled();
  });
});

// ─── Other methods unchanged ──────────────────────────────────────────────

describe("existing methods are unchanged", () => {
  it("44. COD: never a createSession target; verify returns DB state with no provider call", async () => {
    setFawaterakEnv();
    const fetchMock = installFetch();
    const caller = makeCaller(
      makeFakeDb({ order: makeOrderRow({ paymentMethod: "cod", paymentStatus: "not_required", paymentSessionId: null }) }),
    );

    await expect(
      caller.createSession({ ...sessionInput, paymentMethod: "cod" as never }),
    ).rejects.toThrow();

    const res = await caller.verify({ orderId: ORDER_ID });
    expect(res.success).toBe(true);
    if (!res.success) throw new Error("expected success");
    expect(res.result.paymentStatus).toBe("not_required");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(applyUpdateMock).not.toHaveBeenCalled();
  });

  it("45. Stripe: createSession still goes through Stripe and stores its session id", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const fetchMock = installFetch();
    const orderRow = makeOrderRow({ paymentMethod: "cod", paymentSessionId: null });
    const caller = makeCaller(makeFakeDb({ order: orderRow, items: [] }));

    const res = await caller.createSession({ ...sessionInput, paymentMethod: "stripe" });
    expect(res.success).toBe(true);
    if (!res.success) throw new Error("expected success");
    expect(res.result.sessionId).toBe("cs_test_123");
    expect(res.result.paymentUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_123");
    expect(stripeMocks.create).toHaveBeenCalledTimes(1);
    expect(orderRow.paymentMethod).toBe("stripe");
    expect(orderRow.paymentSessionId).toBe("cs_test_123");
    expect(fetchMock).not.toHaveBeenCalled(); // no Fawaterak traffic

    // verify for a pending Stripe order still consults Stripe, not Fawaterak
    orderRow.paymentStatus = "pending";
    const v = await caller.verify({ orderId: ORDER_ID });
    expect(v.success).toBe(true);
    expect(stripeMocks.retrieve).toHaveBeenCalledWith("cs_test_123");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("46. Paymob: createSession still posts the intention via axios and stores its id", async () => {
    process.env.PAYMOB_SECRET_KEY = "egy_sk_test";
    process.env.PAYMOB_PUBLIC_KEY = "egy_pk_test";
    process.env.PAYMOB_CARD_INTEGRATION_ID = "111";
    const fetchMock = installFetch();
    const orderRow = makeOrderRow({ paymentMethod: "cod", paymentSessionId: null });
    const caller = makeCaller(makeFakeDb({ order: orderRow, items: [] }));

    const res = await caller.createSession({ ...sessionInput, paymentMethod: "paymob" });
    expect(res.success).toBe(true);
    if (!res.success) throw new Error("expected success");
    expect(res.result.sessionId).toBe("987");
    expect(res.result.paymentUrl).toContain("accept.paymob.com/unifiedcheckout/");
    expect(axiosMocks.post).toHaveBeenCalledTimes(1);
    expect(String(axiosMocks.post.mock.calls[0]?.[0])).toContain("/v1/intention/");
    expect(orderRow.paymentMethod).toBe("paymob");
    expect(orderRow.paymentSessionId).toBe("987");
    expect(fetchMock).not.toHaveBeenCalled();

    orderRow.paymentStatus = "pending";
    const v = await caller.verify({ orderId: ORDER_ID });
    expect(v.success).toBe(true);
    expect(axiosMocks.get).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("all three gateways coexist in the createSession enum", async () => {
    const caller = makeCaller(makeFakeDb({ order: null }));
    for (const method of ["stripe", "paymob", "fawaterak"] as const) {
      const res = await caller.createSession({ ...sessionInput, paymentMethod: method });
      // Order missing → NotFound result, but the enum accepted the value.
      expect(res.success).toBe(false);
    }
  });
});
