import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  processFawaterakCancelWebhook,
  processFawaterakFailedWebhook,
  processFawaterakPaidWebhook,
  type FawaterakWebhookDeps,
  type FawaterakWebhookOrder,
} from "#root/backend/payments/fawaterak-webhook";
import {
  clearFawaterakEnv,
  hmacHex,
  INTENT_KEY,
  ORDER_ID,
  providerTransaction,
  setFawaterakEnv,
  signCancel,
  signPaid,
} from "./fawaterak-test-utils";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const PAID_FIELDS = {
  transaction_id: 12345,
  transaction_key: INTENT_KEY,
  payment_method: "Visa-Mastercard",
};

function paidWebhook(overrides: Record<string, unknown> = {}) {
  const base = {
    ...PAID_FIELDS,
    status: "paid",
    pay_load: JSON.stringify({ orderId: ORDER_ID }),
    paidAmount: "150.00",
    paidCurrency: "EGP",
    paidAt: "2026-09-01 14:30:00",
    customerData: { customer_unique_id: ORDER_ID },
    ...overrides,
  };
  return {
    ...base,
    transactionHashKey:
      "transactionHashKey" in overrides
        ? overrides.transactionHashKey
        : signPaid({
            transaction_id: base.transaction_id as number,
            transaction_key: base.transaction_key as string,
            payment_method: base.payment_method as string,
          }),
  };
}

function failedWebhook(overrides: Record<string, unknown> = {}) {
  const base = {
    ...PAID_FIELDS,
    pay_load: JSON.stringify({ orderId: ORDER_ID }),
    amount: "150.00",
    paidCurrency: "EGP",
    errorMessage: "Payment declined by issuer",
    ...overrides,
  };
  return {
    ...base,
    hashKey:
      "hashKey" in overrides
        ? overrides.hashKey
        : signPaid({
            transaction_id: base.transaction_id as number,
            transaction_key: base.transaction_key as string,
            payment_method: base.payment_method as string,
          }),
  };
}

function cancelWebhook(overrides: Record<string, unknown> = {}) {
  const base = {
    referenceId: 998877,
    status: "EXPIRED",
    paymentMethod: "Aman",
    pay_load: JSON.stringify({ orderId: ORDER_ID }),
    transactionId: 12345,
    transactionKey: INTENT_KEY,
    ...overrides,
  };
  return {
    ...base,
    hashKey:
      "hashKey" in overrides
        ? overrides.hashKey
        : signCancel({
            referenceId: base.referenceId as number,
            paymentMethod: base.paymentMethod as string,
          }),
  };
}

function makeOrder(overrides: Partial<FawaterakWebhookOrder> = {}): FawaterakWebhookOrder {
  return {
    id: ORDER_ID,
    paymentMethod: "fawaterak",
    paymentStatus: "pending",
    paymentSessionId: INTENT_KEY,
    paymentTransactionId: null,
    total: "150.00",
    ...overrides,
  };
}

function makeDeps(opts: {
  order?: FawaterakWebhookOrder | null;
  provider?: Record<string, unknown> | Error;
} = {}) {
  const orderRow = opts.order === undefined ? makeOrder() : opts.order;
  const provider = opts.provider ?? providerTransaction();
  const deps = {
    findOrderById: vi.fn(async (id: string) => (orderRow && orderRow.id === id ? orderRow : null)),
    fetchTransaction: vi.fn(async () => {
      if (provider instanceof Error) throw provider;
      return provider;
    }),
    applyPaymentUpdate: vi.fn(async (_orderId: string, update: { paymentStatus: string }) => {
      // Mirror the real helper: the row now reflects the update.
      if (orderRow) orderRow.paymentStatus = update.paymentStatus;
      return { updated: true, paymentStatus: update.paymentStatus };
    }),
    recordGatewayData: vi.fn(async () => {}),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } satisfies FawaterakWebhookDeps;
  return { deps, orderRow };
}

beforeEach(() => setFawaterakEnv());
afterEach(() => {
  clearFawaterakEnv();
  vi.restoreAllMocks();
});

// ─── Paid webhook ─────────────────────────────────────────────────────────

describe("processFawaterakPaidWebhook", () => {
  it("33. unsigned webhook is rejected with 401 before any lookup", async () => {
    const { deps } = makeDeps();
    const body = paidWebhook();
    delete (body as Record<string, unknown>).transactionHashKey;
    const outcome = await processFawaterakPaidWebhook(body, deps);

    // Missing signature fails schema validation → 400; a present-but-wrong one → 401.
    expect([400, 401]).toContain(outcome.statusCode);
    expect(deps.findOrderById).not.toHaveBeenCalled();
    expect(deps.fetchTransaction).not.toHaveBeenCalled();
    expect(deps.applyPaymentUpdate).not.toHaveBeenCalled();
  });

  it("33b. a tampered signature is rejected with 401", async () => {
    const { deps } = makeDeps();
    const outcome = await processFawaterakPaidWebhook(
      paidWebhook({ transactionHashKey: hmacHex("TransactionId=1&TransactionKey=x&PaymentMethod=y") }),
      deps,
    );
    expect(outcome.statusCode).toBe(401);
    expect(deps.findOrderById).not.toHaveBeenCalled();
    expect(deps.applyPaymentUpdate).not.toHaveBeenCalled();
  });

  it("34. malformed webhook is rejected with 400", async () => {
    const { deps } = makeDeps();
    for (const bad of [null, "text", 42, {}, { status: "paid" }, { ...PAID_FIELDS, status: "weird", transactionHashKey: "a" }]) {
      const outcome = await processFawaterakPaidWebhook(bad, deps);
      expect(outcome.statusCode).toBe(400);
    }
    expect(deps.applyPaymentUpdate).not.toHaveBeenCalled();
  });

  it("34b. legacy v2 invoice-shaped payload is not accepted", async () => {
    const { deps } = makeDeps();
    const outcome = await processFawaterakPaidWebhook(
      {
        invoice_id: 12345,
        invoice_key: INTENT_KEY,
        invoice_status: "paid",
        payment_method: "Visa-Mastercard",
        hashKey: hmacHex(`InvoiceId=12345&InvoiceKey=${INTENT_KEY}&PaymentMethod=Visa-Mastercard`),
      },
      deps,
    );
    expect(outcome.statusCode).toBe(400);
    expect(deps.applyPaymentUpdate).not.toHaveBeenCalled();
  });

  it("35. a signed 'paid' webhook alone never marks paid — provider verification is required", async () => {
    // Provider says NOT paid even though the webhook claims paid.
    const { deps } = makeDeps({ provider: providerTransaction({ paid: 0, status_text: "unpaid" }) });
    const outcome = await processFawaterakPaidWebhook(paidWebhook(), deps);

    expect(deps.fetchTransaction).toHaveBeenCalledWith(INTENT_KEY);
    expect(deps.applyPaymentUpdate).not.toHaveBeenCalled();
    expect(outcome.statusCode).toBe(200);
    expect(outcome.body.result).toBe("ignored");
  });

  it("35b. webhook paidAmount is never authoritative — provider amount mismatch blocks confirmation", async () => {
    const { deps } = makeDeps({ provider: providerTransaction({ total: 1 }) });
    const outcome = await processFawaterakPaidWebhook(paidWebhook({ paidAmount: "150.00" }), deps);
    expect(deps.applyPaymentUpdate).not.toHaveBeenCalled();
    expect(outcome.error).toMatch(/amount mismatch/);
    expect(deps.recordGatewayData).toHaveBeenCalledTimes(1);
  });

  it("35c. provider outage → 502, DB untouched", async () => {
    const { deps } = makeDeps({ provider: new Error("ECONNRESET") });
    const outcome = await processFawaterakPaidWebhook(paidWebhook(), deps);
    expect(outcome.statusCode).toBe(502);
    expect(deps.applyPaymentUpdate).not.toHaveBeenCalled();
    expect(deps.recordGatewayData).not.toHaveBeenCalled();
  });

  it("36. valid paid webhook + verified provider data confirms the order", async () => {
    const { deps, orderRow } = makeDeps();
    const outcome = await processFawaterakPaidWebhook(paidWebhook(), deps);

    expect(outcome.statusCode).toBe(200);
    expect(outcome.body).toEqual({ status: "ok", result: "paid" });
    expect(outcome.error).toBeNull();
    expect(deps.findOrderById).toHaveBeenCalledWith(ORDER_ID);
    expect(deps.fetchTransaction).toHaveBeenCalledWith(INTENT_KEY);
    expect(deps.applyPaymentUpdate).toHaveBeenCalledTimes(1);
    expect(deps.applyPaymentUpdate).toHaveBeenCalledWith(ORDER_ID, {
      paymentStatus: "paid",
      transactionId: "12345",
      gatewayData: expect.objectContaining({ intent_key: INTENT_KEY, paid: 1 }),
    });
    expect(orderRow?.paymentStatus).toBe("paid");
  });

  it("37. status=pending does not confirm and keeps paymentStatus pending", async () => {
    const { deps, orderRow } = makeDeps();
    const outcome = await processFawaterakPaidWebhook(
      paidWebhook({ status: "pending", payment_method: "Fawry", paidAt: undefined }),
      deps,
    );
    expect(outcome.statusCode).toBe(200);
    expect(outcome.body.result).toBe("pending");
    expect(deps.fetchTransaction).not.toHaveBeenCalled();
    expect(deps.applyPaymentUpdate).not.toHaveBeenCalled();
    expect(deps.recordGatewayData).toHaveBeenCalledWith(ORDER_ID, expect.objectContaining({ status: "pending" }));
    expect(orderRow?.paymentStatus).toBe("pending");
  });

  it("38. duplicate paid webhook is idempotent — second delivery is a no-op", async () => {
    const { deps } = makeDeps();
    const first = await processFawaterakPaidWebhook(paidWebhook(), deps);
    const second = await processFawaterakPaidWebhook(paidWebhook(), deps);

    expect(first.body.result).toBe("paid");
    expect(second.statusCode).toBe(200);
    expect(second.body.result).toBe("already_paid");
    expect(deps.fetchTransaction).toHaveBeenCalledTimes(1);
    expect(deps.applyPaymentUpdate).toHaveBeenCalledTimes(1);
  });

  it("refuses when the order is not a Fawaterak order or the session doesn't match", async () => {
    const wrongMethod = makeDeps({ order: makeOrder({ paymentMethod: "paymob" }) });
    expect((await processFawaterakPaidWebhook(paidWebhook(), wrongMethod.deps)).statusCode).toBe(409);

    const otherSession = makeDeps({ order: makeOrder({ paymentSessionId: "some-other-intent" }) });
    expect((await processFawaterakPaidWebhook(paidWebhook(), otherSession.deps)).statusCode).toBe(409);

    const missing = makeDeps({ order: null });
    expect((await processFawaterakPaidWebhook(paidWebhook(), missing.deps)).statusCode).toBe(404);

    const noPayload = makeDeps();
    expect((await processFawaterakPaidWebhook(paidWebhook({ pay_load: "{bad" }), noPayload.deps)).statusCode).toBe(400);

    for (const d of [wrongMethod, otherSession, missing, noPayload]) {
      expect(d.deps.fetchTransaction).not.toHaveBeenCalled();
      expect(d.deps.applyPaymentUpdate).not.toHaveBeenCalled();
    }
  });
});

// ─── Failed / cancel webhooks ─────────────────────────────────────────────

describe("processFawaterakFailedWebhook / processFawaterakCancelWebhook", () => {
  it("40. failed webhook records a failed attempt, never 'paid'", async () => {
    const { deps, orderRow } = makeDeps();
    const outcome = await processFawaterakFailedWebhook(failedWebhook(), deps);

    expect(outcome.statusCode).toBe(200);
    expect(outcome.body.result).toBe("failed");
    expect(deps.fetchTransaction).not.toHaveBeenCalled();
    expect(deps.applyPaymentUpdate).toHaveBeenCalledTimes(1);
    expect(deps.applyPaymentUpdate.mock.calls[0]?.[1].paymentStatus).toBe("failed");
    expect(orderRow?.paymentStatus).toBe("failed");
  });

  it("40b. cancel/expired webhook records a failed attempt, never 'paid'", async () => {
    const { deps } = makeDeps();
    const outcome = await processFawaterakCancelWebhook(cancelWebhook(), deps);

    expect(outcome.statusCode).toBe(200);
    expect(outcome.body.result).toBe("expired");
    expect(deps.applyPaymentUpdate).toHaveBeenCalledTimes(1);
    expect(deps.applyPaymentUpdate.mock.calls[0]?.[1].paymentStatus).toBe("failed");
  });

  it("39. an already-paid order is never downgraded by failed or cancel", async () => {
    const paidOrder = makeOrder({ paymentStatus: "paid", paymentTransactionId: "12345" });
    const failed = makeDeps({ order: paidOrder });
    const f = await processFawaterakFailedWebhook(failedWebhook(), failed.deps);
    expect(f.statusCode).toBe(200);
    expect(f.body.result).toBe("already_paid");
    expect(failed.deps.applyPaymentUpdate).not.toHaveBeenCalled();
    expect(paidOrder.paymentStatus).toBe("paid");

    const cancel = makeDeps({ order: paidOrder });
    const c = await processFawaterakCancelWebhook(cancelWebhook(), cancel.deps);
    expect(c.statusCode).toBe(200);
    expect(c.body.result).toBe("already_paid");
    expect(cancel.deps.applyPaymentUpdate).not.toHaveBeenCalled();
    expect(paidOrder.paymentStatus).toBe("paid");

    // A refunded order is final too.
    const refunded = makeDeps({ order: makeOrder({ paymentStatus: "refunded" }) });
    await processFawaterakFailedWebhook(failedWebhook(), refunded.deps);
    expect(refunded.deps.applyPaymentUpdate).not.toHaveBeenCalled();
  });

  it("failed/cancel with a bad signature are rejected with 401 and touch nothing", async () => {
    const { deps } = makeDeps();
    expect(
      (await processFawaterakFailedWebhook(failedWebhook({ hashKey: hmacHex("nope") }), deps)).statusCode,
    ).toBe(401);
    expect(
      (await processFawaterakCancelWebhook(cancelWebhook({ hashKey: hmacHex("nope") }), deps)).statusCode,
    ).toBe(401);
    // Cancel hash must cover referenceId + paymentMethod exactly.
    expect(
      (
        await processFawaterakCancelWebhook(
          cancelWebhook({ paymentMethod: "Masary", hashKey: signCancel({ referenceId: 998877, paymentMethod: "Aman" }) }),
          deps,
        )
      ).statusCode,
    ).toBe(401);
    expect(deps.findOrderById).not.toHaveBeenCalled();
    expect(deps.applyPaymentUpdate).not.toHaveBeenCalled();
  });

  it("cancel without transactionKey still requires pay_load → order → fawaterak session", async () => {
    const { deps } = makeDeps();
    const outcome = await processFawaterakCancelWebhook(
      cancelWebhook({ transactionKey: undefined, transactionId: undefined, status: "CANCELED" }),
      deps,
    );
    expect(outcome.statusCode).toBe(200);
    expect(outcome.body.result).toBe("canceled");
    expect(deps.applyPaymentUpdate).toHaveBeenCalledWith(ORDER_ID, expect.objectContaining({ paymentStatus: "failed", transactionId: null }));
  });

  it("malformed failed/cancel payloads → 400", async () => {
    const { deps } = makeDeps();
    expect((await processFawaterakFailedWebhook({ transaction_key: INTENT_KEY }, deps)).statusCode).toBe(400);
    expect((await processFawaterakCancelWebhook({ referenceId: 1 }, deps)).statusCode).toBe(400);
    expect(deps.applyPaymentUpdate).not.toHaveBeenCalled();
  });
});
