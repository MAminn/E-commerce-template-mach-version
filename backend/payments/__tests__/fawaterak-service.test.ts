import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFawaterakCancelStringToSign,
  buildFawaterakRedirectUrls,
  buildFawaterakTransactionPayload,
  buildFawaterakTransactionStringToSign,
  clearFawaterakTokenCache,
  computeFawaterakHash,
  createFawaterakTransactionRequest,
  FAWATERAK_WEBHOOK_PATHS,
  FawaterakError,
  fetchFawaterakTransactionData,
  formatMajorAmount,
  getFawaterakAccessToken,
  parseFawaterakPayLoad,
  safeEqualHex,
  toPiasters,
  verifyFawaterakCancelWebhookHash,
  verifyFawaterakFailedWebhookHash,
  verifyFawaterakPaidTransaction,
  verifyFawaterakPaidWebhookHash,
} from "#root/backend/payments/fawaterak-service";
import {
  clearFawaterakEnv,
  createTransactionResponse,
  hmacHex,
  INTENT_KEY,
  jsonResponse,
  ORDER_ID,
  providerTransaction,
  setFawaterakEnv,
  signCancel,
  signPaid,
  TEST_ACCESS_TOKEN,
  TEST_ENV,
  tokenResponse,
  transactionDataResponse,
} from "./fawaterak-test-utils";

// ─── Helpers ──────────────────────────────────────────────────────────────

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function installFetch(...responses: Array<Response | (() => Response)>): FetchMock {
  const queue = [...responses];
  const mock = vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error("fetch mock: no more responses queued");
    return typeof next === "function" ? next() : next;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function callArgs(mock: FetchMock, index: number) {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`fetch call ${index} not made`);
  const [url, init] = call as [string, RequestInit];
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  return { url: String(url), method: init?.method, headers, body };
}

const baseOrderInput = {
  orderId: ORDER_ID,
  customerName: "Ahmed Ali",
  customerEmail: "ahmed@example.com",
  customerPhone: "01000000000",
  shippingAddress: "12 Tahrir St, Cairo",
  total: "150.00",
  itemNames: ["Blue Hoodie", "Cap"],
};

beforeEach(() => {
  setFawaterakEnv();
  clearFawaterakTokenCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearFawaterakEnv();
  clearFawaterakTokenCache();
});

// ─── Money ────────────────────────────────────────────────────────────────

describe("toPiasters / formatMajorAmount", () => {
  it("converts decimal strings and numbers to integer piasters", () => {
    expect(toPiasters("150.00")).toBe(15000);
    expect(toPiasters("150")).toBe(15000);
    expect(toPiasters("99.5")).toBe(9950);
    expect(toPiasters(150)).toBe(15000);
    expect(toPiasters(150.5)).toBe(15050);
    expect(toPiasters("0.01")).toBe(1);
    expect(toPiasters("150.000")).toBe(15000);
  });

  it("rejects anything that is not a clean non-negative decimal", () => {
    expect(toPiasters(null)).toBeNull();
    expect(toPiasters(undefined)).toBeNull();
    expect(toPiasters("")).toBeNull();
    expect(toPiasters("abc")).toBeNull();
    expect(toPiasters("-5")).toBeNull();
    expect(toPiasters("150.005")).toBeNull();
    expect(toPiasters(Number.NaN)).toBeNull();
    expect(toPiasters("1e3")).toBeNull();
    expect(toPiasters("100.00 EGP")).toBeNull();
  });

  it("does not compare floats: 0.1+0.2 style inputs map exactly", () => {
    expect(toPiasters("0.30")).toBe(toPiasters(0.3));
    expect(formatMajorAmount("150")).toBe("150.00");
    expect(formatMajorAmount(99.5)).toBe("99.50");
    expect(() => formatMajorAmount("bad")).toThrow(FawaterakError);
  });
});

// ─── OAuth ────────────────────────────────────────────────────────────────

describe("getFawaterakAccessToken", () => {
  it("4/5. POSTs client_credentials JSON to {base}/oauth/token", async () => {
    const fetchMock = installFetch(tokenResponse());
    const token = await getFawaterakAccessToken();

    expect(token).toBe(TEST_ACCESS_TOKEN);
    const { url, method, headers, body } = callArgs(fetchMock, 0);
    expect(url).toBe("https://fawaterak.test/oauth/token");
    expect(method).toBe("POST");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBeUndefined();
    expect(body).toEqual({
      grant_type: "client_credentials",
      client_id: TEST_ENV.FAWATERAK_CLIENT_ID,
      client_secret: TEST_ENV.FAWATERAK_CLIENT_SECRET,
    });
  });

  it("6. caches the token in memory across calls", async () => {
    const fetchMock = installFetch(tokenResponse());
    await getFawaterakAccessToken();
    await getFawaterakAccessToken();
    await getFawaterakAccessToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("7. re-fetches after expires_in elapses (with safety margin)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T10:00:00Z"));
    const fetchMock = installFetch(tokenResponse("first", 600), tokenResponse("second", 600));

    expect(await getFawaterakAccessToken()).toBe("first");
    // 8 minutes in: still inside expires_in - 60s margin → cached.
    vi.setSystemTime(new Date("2026-09-11T10:08:00Z"));
    expect(await getFawaterakAccessToken()).toBe("first");
    // 9.5 minutes: past the 540s effective lifetime → new token.
    vi.setSystemTime(new Date("2026-09-11T10:09:30Z"));
    expect(await getFawaterakAccessToken()).toBe("second");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails safely on a rejected token request without leaking the secret", async () => {
    installFetch(jsonResponse({ error: "invalid_client", message: "Client authentication failed" }, 401));
    let thrown: unknown;
    try {
      await getFawaterakAccessToken();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FawaterakError);
    expect(thrown).toMatchObject({ status: 401 });
    expect((thrown as Error).message).toMatch(/HTTP 401/);
    expect((thrown as Error).message).not.toContain(TEST_ENV.FAWATERAK_CLIENT_SECRET);
  });

  it("refuses to run when Fawaterak is not configured", async () => {
    clearFawaterakEnv();
    const fetchMock = installFetch();
    await expect(getFawaterakAccessToken()).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("authenticated requests — 401 retry", () => {
  it("8. a 401 clears the cache, fetches ONE fresh token and retries once", async () => {
    const fetchMock = installFetch(
      tokenResponse("stale"),
      jsonResponse({ status: "error", message: "Unauthenticated" }, 401),
      tokenResponse("fresh"),
      transactionDataResponse(),
    );

    const data = await fetchFawaterakTransactionData(INTENT_KEY);
    expect(data.paid).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(callArgs(fetchMock, 0).url).toMatch(/\/oauth\/token$/);
    expect(callArgs(fetchMock, 1).headers.Authorization).toBe("Bearer stale");
    expect(callArgs(fetchMock, 2).url).toMatch(/\/oauth\/token$/);
    expect(callArgs(fetchMock, 3).headers.Authorization).toBe("Bearer fresh");
  });

  it("9. a second 401 fails safely — no infinite loop", async () => {
    const fetchMock = installFetch(
      tokenResponse("stale"),
      jsonResponse({ message: "Unauthenticated" }, 401),
      tokenResponse("fresh"),
      jsonResponse({ message: "Unauthenticated" }, 401),
    );

    await expect(fetchFawaterakTransactionData(INTENT_KEY)).rejects.toMatchObject({
      name: "FawaterakError",
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("10. never logs or surfaces the client secret, vendor key, or access token", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    installFetch(
      tokenResponse(),
      jsonResponse({ message: "Unauthenticated" }, 401),
      tokenResponse(),
      jsonResponse({ status: "error", message: "Unable to resolve vendor from OAuth client" }, 401),
    );

    let thrown: unknown;
    try {
      await fetchFawaterakTransactionData(INTENT_KEY);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FawaterakError);
    const message = (thrown as Error).message;

    const secrets = [
      TEST_ENV.FAWATERAK_CLIENT_SECRET,
      TEST_ENV.FAWATERAK_VENDOR_API_KEY,
      TEST_ACCESS_TOKEN,
      "Bearer ",
    ];
    const allLogged = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map(String)
      .join("\n");
    for (const secret of secrets) {
      expect(message).not.toContain(secret);
      expect(allLogged).not.toContain(secret);
    }
  });
});

// ─── Create transaction ──────────────────────────────────────────────────

describe("buildFawaterakTransactionPayload", () => {
  it("12/13/14/15. hosted mode: no payment_method_id, DB total, EGP, pay_load.orderId", () => {
    const payload = buildFawaterakTransactionPayload(baseOrderInput);

    expect(payload).not.toHaveProperty("payment_method_id");
    expect(payload.cartTotal).toBe("150.00");
    expect(payload.currency).toBe("EGP");
    expect(payload.pay_load).toEqual({ orderId: ORDER_ID });
    expect(payload.tr_number).toBe(`ORD-${ORDER_ID.replace(/-/g, "").slice(0, 8).toUpperCase()}`);

    const items = payload.cartItems as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]?.price).toBe("150.00");
    expect(items[0]?.quantity).toBe(1);
    expect(String(items[0]?.name)).toMatch(/^Order ORD-/);

    const customer = payload.customer as Record<string, unknown>;
    expect(customer.first_name).toBe("Ahmed");
    expect(customer.last_name).toBe("Ali");
    expect(customer.email).toBe("ahmed@example.com");
    expect(customer.phone).toBe("01000000000");
  });

  it("builds every redirect URL from PUBLIC_ORIGIN, never from the browser", () => {
    const urls = buildFawaterakRedirectUrls({
      id: ORDER_ID,
      total: "150.00",
      customerEmail: "ahmed@example.com",
    });
    const origin = TEST_ENV.PUBLIC_ORIGIN;
    expect(urls.successUrl.startsWith(`${origin}/order-confirmation?`)).toBe(true);
    expect(new URL(urls.successUrl).searchParams.get("payment")).toBe("success");
    expect(new URL(urls.successUrl).searchParams.get("id")).toBe(ORDER_ID);
    expect(new URL(urls.failUrl).searchParams.get("payment")).toBe("failed");
    expect(new URL(urls.pendingUrl).searchParams.get("payment")).toBe("pending");
    expect(new URL(urls.backUrl).searchParams.get("payment")).toBe("cancelled");
    expect(urls.webhookUrl).toBe(`${origin}${FAWATERAK_WEBHOOK_PATHS.paid}`);
    expect(urls.webhookUrl).toContain("_json");
    for (const u of Object.values(urls)) expect(u.startsWith(origin)).toBe(true);
  });

  it("throws on a non-decimal DB total instead of sending garbage", () => {
    expect(() => buildFawaterakTransactionPayload({ ...baseOrderInput, total: "NaN" })).toThrow(
      FawaterakError,
    );
  });
});

describe("createFawaterakTransactionRequest", () => {
  it("11/16/17. POSTs /api/v3/createTransaction with Bearer and maps intent_key→sessionId, url→paymentUrl", async () => {
    const fetchMock = installFetch(tokenResponse(), createTransactionResponse());

    const result = await createFawaterakTransactionRequest(baseOrderInput);

    const { url, method, headers, body } = callArgs(fetchMock, 1);
    expect(url).toBe("https://fawaterak.test/api/v3/createTransaction");
    expect(method).toBe("POST");
    expect(headers.Authorization).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
    expect(body).not.toHaveProperty("payment_method_id");
    expect(body?.cartTotal).toBe("150.00");
    expect(body?.currency).toBe("EGP");
    expect(body?.pay_load).toEqual({ orderId: ORDER_ID });

    expect(result.sessionId).toBe(INTENT_KEY);
    expect(result.paymentUrl).toBe(`https://fawaterak.test/ts/${INTENT_KEY.slice(0, 5)}`);
    expect(result.expiresIn).toBe(2592000);
  });

  it("rejects a response without intent_key or without an https url", async () => {
    installFetch(tokenResponse(), jsonResponse({ status: "success", data: { url: "https://x" } }));
    await expect(createFawaterakTransactionRequest(baseOrderInput)).rejects.toThrow(/intent_key/);

    clearFawaterakTokenCache();
    installFetch(
      tokenResponse(),
      jsonResponse({ status: "success", data: { intent_key: INTENT_KEY, url: "http://insecure" } }),
    );
    await expect(createFawaterakTransactionRequest(baseOrderInput)).rejects.toThrow(/url/);
  });

  it("surfaces a 422 validation failure as FawaterakError with status", async () => {
    installFetch(
      tokenResponse(),
      jsonResponse({ status: "error", message: "The cartTotal field is required." }, 422),
    );
    await expect(createFawaterakTransactionRequest(baseOrderInput)).rejects.toMatchObject({
      status: 422,
    });
  });
});

// ─── getTransactionData ──────────────────────────────────────────────────

describe("fetchFawaterakTransactionData", () => {
  it("18. POSTs { intent_key } to /api/v3/getTransactionData with Bearer", async () => {
    const fetchMock = installFetch(tokenResponse(), transactionDataResponse());
    const data = await fetchFawaterakTransactionData(INTENT_KEY);

    const { url, method, headers, body } = callArgs(fetchMock, 1);
    expect(url).toBe("https://fawaterak.test/api/v3/getTransactionData");
    expect(method).toBe("POST");
    expect(headers.Authorization).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
    expect(body).toEqual({ intent_key: INTENT_KEY });
    expect(data.intent_key).toBe(INTENT_KEY);
    expect(data.transaction_id).toBe(12345);
  });

  it("rejects an empty intent_key before touching the network", async () => {
    const fetchMock = installFetch();
    await expect(fetchFawaterakTransactionData("")).rejects.toThrow(/intent_key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── pay_load parsing ────────────────────────────────────────────────────

describe("parseFawaterakPayLoad", () => {
  it("accepts an object or a JSON string with orderId", () => {
    expect(parseFawaterakPayLoad({ orderId: ORDER_ID })).toEqual({ orderId: ORDER_ID });
    expect(parseFawaterakPayLoad(JSON.stringify({ orderId: ORDER_ID }))).toEqual({ orderId: ORDER_ID });
    expect(parseFawaterakPayLoad(`  {"orderId":"${ORDER_ID}","extra":1} `)).toEqual({ orderId: ORDER_ID });
  });

  it("25. rejects null, arrays, malformed JSON, and missing/non-string orderId", () => {
    expect(parseFawaterakPayLoad(null)).toBeNull();
    expect(parseFawaterakPayLoad(undefined)).toBeNull();
    expect(parseFawaterakPayLoad("")).toBeNull();
    expect(parseFawaterakPayLoad("{not json")).toBeNull();
    expect(parseFawaterakPayLoad("[]")).toBeNull();
    expect(parseFawaterakPayLoad([ORDER_ID])).toBeNull();
    expect(parseFawaterakPayLoad({})).toBeNull();
    expect(parseFawaterakPayLoad({ orderId: 123 })).toBeNull();
    expect(parseFawaterakPayLoad({ orderId: "   " })).toBeNull();
    expect(parseFawaterakPayLoad({ order_id: ORDER_ID })).toBeNull();
    expect(parseFawaterakPayLoad("\"just a string\"")).toBeNull();
  });
});

// ─── Verification ────────────────────────────────────────────────────────

describe("verifyFawaterakPaidTransaction", () => {
  const orderSnapshot = { id: ORDER_ID, paymentSessionId: INTENT_KEY, total: "150.00" };

  it("20. paid=1 + matching intent, pay_load, amount, currency, transaction_id → ok", () => {
    const result = verifyFawaterakPaidTransaction(orderSnapshot, providerTransaction());
    expect(result).toEqual({ ok: true, transactionId: "12345", paidAt: "2026-09-01 12:05:00" });
  });

  it("accepts the JSON-string pay_load shape and a decimal-string total", () => {
    const result = verifyFawaterakPaidTransaction(
      orderSnapshot,
      providerTransaction({ pay_load: JSON.stringify({ orderId: ORDER_ID }), total: "150.00" }),
    );
    expect(result.ok).toBe(true);
  });

  it("19. paid=0 is not paid", () => {
    const result = verifyFawaterakPaidTransaction(
      orderSnapshot,
      providerTransaction({ paid: 0, status_text: "unpaid" }),
    );
    expect(result).toMatchObject({ ok: false, paid: false });
  });

  it("21. amount mismatch is rejected (piaster-exact)", () => {
    expect(
      verifyFawaterakPaidTransaction(orderSnapshot, providerTransaction({ total: 149.99 })).ok,
    ).toBe(false);
    expect(
      verifyFawaterakPaidTransaction(orderSnapshot, providerTransaction({ total: "150.01" })).ok,
    ).toBe(false);
    expect(
      verifyFawaterakPaidTransaction(orderSnapshot, providerTransaction({ total: 1500 })),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/amount mismatch/) });
    expect(
      verifyFawaterakPaidTransaction(orderSnapshot, providerTransaction({ total: "abc" })),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/amount/) });
  });

  it("22. currency mismatch is rejected", () => {
    expect(
      verifyFawaterakPaidTransaction(orderSnapshot, providerTransaction({ currency: "USD" })),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/currency/) });
    expect(
      verifyFawaterakPaidTransaction(orderSnapshot, providerTransaction({ currency: undefined })),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/currency/) });
    // case-insensitive on the provider side
    expect(
      verifyFawaterakPaidTransaction(orderSnapshot, providerTransaction({ currency: "egp" })).ok,
    ).toBe(true);
  });

  it("23. intent_key mismatch is rejected", () => {
    expect(
      verifyFawaterakPaidTransaction(
        orderSnapshot,
        providerTransaction({ intent_key: "660e8400-e29b-41d4-a716-446655440001" }),
      ),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/intent_key/) });
    expect(
      verifyFawaterakPaidTransaction({ ...orderSnapshot, paymentSessionId: null }, providerTransaction()),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/intent_key/) });
  });

  it("24. pay_load orderId mismatch is rejected", () => {
    expect(
      verifyFawaterakPaidTransaction(
        orderSnapshot,
        providerTransaction({ pay_load: { orderId: "11111111-1111-4111-8111-111111111111" } }),
      ),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/pay_load orderId/) });
  });

  it("25. malformed pay_load is rejected", () => {
    for (const bad of [null, "{oops", "[]", { order_id: ORDER_ID }, 42]) {
      expect(
        verifyFawaterakPaidTransaction(orderSnapshot, providerTransaction({ pay_load: bad })),
      ).toMatchObject({ ok: false, reason: expect.stringMatching(/pay_load/) });
    }
  });

  it("26. transaction_id = 0 / missing is not paid", () => {
    expect(
      verifyFawaterakPaidTransaction(orderSnapshot, providerTransaction({ transaction_id: 0 })),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/transaction_id/) });
    expect(
      verifyFawaterakPaidTransaction(orderSnapshot, providerTransaction({ transaction_id: "0" })),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/transaction_id/) });
    expect(
      verifyFawaterakPaidTransaction(orderSnapshot, providerTransaction({ transaction_id: undefined })),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/transaction_id/) });
  });
});

// ─── HMAC ────────────────────────────────────────────────────────────────

describe("webhook HMAC helpers", () => {
  const paidFields = {
    transaction_id: 12345,
    transaction_key: INTENT_KEY,
    payment_method: "Visa-Mastercard",
  };

  it("builds the exact v3 string-to-sign", () => {
    expect(buildFawaterakTransactionStringToSign(paidFields)).toBe(
      `TransactionId=12345&TransactionKey=${INTENT_KEY}&PaymentMethod=Visa-Mastercard`,
    );
    expect(buildFawaterakCancelStringToSign({ referenceId: 998877, paymentMethod: "Aman" })).toBe(
      "referenceId=998877&PaymentMethod=Aman",
    );
    expect(buildFawaterakTransactionStringToSign({ ...paidFields, payment_method: undefined })).toBeNull();
  });

  it("computeFawaterakHash is HMAC-SHA256 hex over the string-to-sign", () => {
    const s = "TransactionId=1&TransactionKey=k&PaymentMethod=m";
    expect(computeFawaterakHash(s, "key")).toBe(hmacHex(s, "key"));
    expect(computeFawaterakHash(s, "key")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("27. valid paid transactionHashKey is accepted", () => {
    expect(
      verifyFawaterakPaidWebhookHash({ ...paidFields, transactionHashKey: signPaid(paidFields) }),
    ).toBe(true);
    // Uppercase hex from the provider is still the same digest.
    expect(
      verifyFawaterakPaidWebhookHash({
        ...paidFields,
        transactionHashKey: signPaid(paidFields).toUpperCase(),
      }),
    ).toBe(true);
  });

  it("28. invalid / tampered paid hash is rejected", () => {
    const good = signPaid(paidFields);
    const flipped = (good[0] === "a" ? "b" : "a") + good.slice(1);
    expect(verifyFawaterakPaidWebhookHash({ ...paidFields, transactionHashKey: flipped })).toBe(false);
    // Signed for a different transaction id → mismatch.
    expect(
      verifyFawaterakPaidWebhookHash({
        ...paidFields,
        transaction_id: 99999,
        transactionHashKey: good,
      }),
    ).toBe(false);
    // Signed with the wrong key.
    expect(
      verifyFawaterakPaidWebhookHash({
        ...paidFields,
        transactionHashKey: hmacHex(
          `TransactionId=12345&TransactionKey=${INTENT_KEY}&PaymentMethod=Visa-Mastercard`,
          "some-other-key",
        ),
      }),
    ).toBe(false);
    expect(verifyFawaterakPaidWebhookHash({ ...paidFields })).toBe(false);
  });

  it("29. valid failed hashKey is accepted (same string-to-sign)", () => {
    expect(verifyFawaterakFailedWebhookHash({ ...paidFields, hashKey: signPaid(paidFields) })).toBe(true);
    expect(verifyFawaterakFailedWebhookHash({ ...paidFields, hashKey: "00" })).toBe(false);
  });

  it("30. valid cancel hashKey is accepted", () => {
    const fields = { referenceId: 998877, paymentMethod: "Aman" };
    expect(verifyFawaterakCancelWebhookHash({ ...fields, hashKey: signCancel(fields) })).toBe(true);
    expect(
      verifyFawaterakCancelWebhookHash({ ...fields, paymentMethod: "Masary", hashKey: signCancel(fields) }),
    ).toBe(false);
  });

  it("31. length mismatch / non-hex never throws and never matches", () => {
    const expected = hmacHex("x");
    expect(safeEqualHex(expected.slice(0, 10), expected)).toBe(false);
    expect(safeEqualHex(`${expected}00`, expected)).toBe(false);
    expect(safeEqualHex("", expected)).toBe(false);
    expect(safeEqualHex("zz".repeat(32), expected)).toBe(false);
    expect(safeEqualHex(undefined, expected)).toBe(false);
    expect(safeEqualHex(12345 as unknown, expected)).toBe(false);
    expect(safeEqualHex(expected, expected)).toBe(true);
    expect(() =>
      verifyFawaterakPaidWebhookHash({ ...paidFields, transactionHashKey: "abc" }),
    ).not.toThrow();
  });

  it("32. legacy v2 InvoiceId/InvoiceKey signature shape is NOT accepted", () => {
    const legacyString = `InvoiceId=12345&InvoiceKey=${INTENT_KEY}&PaymentMethod=Visa-Mastercard`;
    const legacyHash = hmacHex(legacyString);
    expect(verifyFawaterakPaidWebhookHash({ ...paidFields, transactionHashKey: legacyHash })).toBe(false);
    expect(verifyFawaterakFailedWebhookHash({ ...paidFields, hashKey: legacyHash })).toBe(false);
  });

  it("refuses every signature when the vendor key is missing", () => {
    setFawaterakEnv({ FAWATERAK_VENDOR_API_KEY: undefined });
    expect(
      verifyFawaterakPaidWebhookHash({ ...paidFields, transactionHashKey: signPaid(paidFields) }),
    ).toBe(false);
  });
});
