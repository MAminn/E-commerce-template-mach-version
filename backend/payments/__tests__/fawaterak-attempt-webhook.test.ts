import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  processFawaterakCancelWebhook,
  processFawaterakFailedWebhook,
  processFawaterakPaidWebhook,
  type FawaterakAttemptWebhookDeps,
  type FawaterakWebhookAttempt,
  type FawaterakWebhookDeps,
} from "#root/backend/payments/fawaterak-webhook";
import type { FinalizeOutcome } from "#root/backend/payments/payment-attempts/service";
import {
  clearFawaterakEnv,
  INTENT_KEY,
  ORDER_ID,
  providerTransaction,
  setFawaterakEnv,
  signCancel,
  signPaid,
} from "./fawaterak-test-utils";

/**
 * Webhook routing for the payment-attempt-first checkout: a pay_load that
 * names a payment_attempt goes to the attempt handler (verify → shared
 * finalizer); anything else stays on the untouched legacy order handler.
 * DB-free — the full flow against Postgres is in
 * payment-attempt-flow.integration.test.ts.
 */

const ATTEMPT_ID = "019a0000-aaaa-7bbb-8ccc-000000000001";

function paidBody(payLoadId: string, overrides: Record<string, unknown> = {}) {
  const fields = {
    transaction_id: 12345,
    transaction_key: INTENT_KEY,
    payment_method: "Visa-Mastercard",
    ...overrides,
  };
  return {
    ...fields,
    status: "paid",
    pay_load: JSON.stringify({ orderId: payLoadId }),
    transactionHashKey: signPaid(fields as never),
  };
}

function makeAttempt(overrides: Partial<FawaterakWebhookAttempt> = {}): FawaterakWebhookAttempt {
  return { id: ATTEMPT_ID, status: "pending", intentKey: INTENT_KEY, total: "150.00", ...overrides };
}

function makeDeps(opts: {
  attempt?: FawaterakWebhookAttempt | null;
  provider?: Record<string, unknown>;
  finalize?: FinalizeOutcome;
} = {}) {
  const attempt = opts.attempt === undefined ? makeAttempt() : opts.attempt;
  const attemptDeps = {
    findAttemptById: vi.fn(async (id: string) => (attempt && attempt.id === id ? attempt : null)),
    finalizeAttempt: vi.fn(
      async (): Promise<FinalizeOutcome> =>
        opts.finalize ?? { kind: "materialized", orderId: ATTEMPT_ID, held: false },
    ),
    recordOutcome: vi.fn(async () => true),
    recordGatewayData: vi.fn(async () => {}),
  } satisfies FawaterakAttemptWebhookDeps;
  const deps = {
    findOrderById: vi.fn(async () => null),
    fetchTransaction: vi.fn(async () =>
      opts.provider ?? providerTransaction({ pay_load: { orderId: ATTEMPT_ID } }),
    ),
    applyPaymentUpdate: vi.fn(async () => ({})),
    recordGatewayData: vi.fn(async () => {}),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    attempts: attemptDeps,
  } satisfies FawaterakWebhookDeps;
  return { deps, attemptDeps };
}

beforeEach(() => setFawaterakEnv());
afterEach(() => {
  clearFawaterakEnv();
  vi.restoreAllMocks();
});

describe("Fawaterak paid webhook — payment attempts", () => {
  it("verified paid → the shared finalizer gets the provider-verified payment; legacy order lookup never runs", async () => {
    const { deps, attemptDeps } = makeDeps();
    const out = await processFawaterakPaidWebhook(paidBody(ATTEMPT_ID), deps);

    expect(out.statusCode).toBe(200);
    expect(out.body.result).toBe("paid");
    expect(deps.fetchTransaction).toHaveBeenCalledWith(INTENT_KEY);
    expect(attemptDeps.finalizeAttempt).toHaveBeenCalledWith(ATTEMPT_ID, {
      transactionId: "12345",
      providerPaidAt: "2026-09-01 12:05:00",
      gatewayData: expect.objectContaining({ intent_key: INTENT_KEY }),
      providerPaymentMethod: "Visa-Mastercard",
    });
    expect(deps.findOrderById).not.toHaveBeenCalled();
    expect(deps.applyPaymentUpdate).not.toHaveBeenCalled();
  });

  it("AB. a legacy order reference (not an attempt) falls through to the legacy order handler", async () => {
    const { deps, attemptDeps } = makeDeps({ attempt: null });
    await processFawaterakPaidWebhook(paidBody(ORDER_ID), deps);
    expect(attemptDeps.findAttemptById).toHaveBeenCalledWith(ORDER_ID);
    expect(deps.findOrderById).toHaveBeenCalledWith(ORDER_ID);
    expect(attemptDeps.finalizeAttempt).not.toHaveBeenCalled();
  });

  it("a non-UUID reference is never looked up as an attempt", async () => {
    const { deps, attemptDeps } = makeDeps();
    await processFawaterakPaidWebhook(paidBody("not-a-uuid"), deps);
    expect(attemptDeps.findAttemptById).not.toHaveBeenCalled();
  });

  it("an invalid signature is rejected before any lookup", async () => {
    const { deps, attemptDeps } = makeDeps();
    const out = await processFawaterakPaidWebhook(
      { ...paidBody(ATTEMPT_ID), transactionHashKey: "ab".repeat(32) },
      deps,
    );
    expect(out.statusCode).toBe(401);
    expect(attemptDeps.findAttemptById).not.toHaveBeenCalled();
    expect(attemptDeps.finalizeAttempt).not.toHaveBeenCalled();
  });

  it("a transaction_key that isn't the attempt's intent is refused (409), nothing finalized", async () => {
    const { deps, attemptDeps } = makeDeps({ attempt: makeAttempt({ intentKey: "other-intent" }) });
    const out = await processFawaterakPaidWebhook(paidBody(ATTEMPT_ID), deps);
    expect(out.statusCode).toBe(409);
    expect(deps.fetchTransaction).not.toHaveBeenCalled();
    expect(attemptDeps.finalizeAttempt).not.toHaveBeenCalled();
  });

  it("J. duplicate webhook for a materialized attempt → no provider call, finalizer returns already_materialized", async () => {
    const { deps, attemptDeps } = makeDeps({
      attempt: makeAttempt({ status: "materialized" }),
      finalize: { kind: "already_materialized", orderId: ATTEMPT_ID, held: false },
    });
    const out = await processFawaterakPaidWebhook(paidBody(ATTEMPT_ID), deps);
    expect(out.statusCode).toBe(200);
    expect(out.body.result).toBe("already_materialized");
    expect(deps.fetchTransaction).not.toHaveBeenCalled();
    expect(attemptDeps.finalizeAttempt).toHaveBeenCalledWith(ATTEMPT_ID, null);
  });

  it("Y. a paid attempt still waiting for its order is retried by the next webhook (no re-verification)", async () => {
    const { deps, attemptDeps } = makeDeps({ attempt: makeAttempt({ status: "paid_pending_materialization" }) });
    const out = await processFawaterakPaidWebhook(paidBody(ATTEMPT_ID), deps);
    expect(out.body.result).toBe("paid");
    expect(deps.fetchTransaction).not.toHaveBeenCalled();
    expect(attemptDeps.finalizeAttempt).toHaveBeenCalledWith(ATTEMPT_ID, null);
  });

  it("Q. provider amount ≠ attempt snapshot → never finalized; evidence kept", async () => {
    const { deps, attemptDeps } = makeDeps({
      provider: providerTransaction({ pay_load: { orderId: ATTEMPT_ID }, total: 149.99 }),
    });
    const out = await processFawaterakPaidWebhook(paidBody(ATTEMPT_ID), deps);
    expect(out.statusCode).toBe(200);
    expect(out.body.result).toBe("ignored");
    expect(attemptDeps.finalizeAttempt).not.toHaveBeenCalled();
    expect(attemptDeps.recordGatewayData).toHaveBeenCalled();
  });

  it("provider says not paid → never finalized", async () => {
    const { deps, attemptDeps } = makeDeps({
      provider: providerTransaction({ pay_load: { orderId: ATTEMPT_ID }, paid: 0 }),
    });
    await processFawaterakPaidWebhook(paidBody(ATTEMPT_ID), deps);
    expect(attemptDeps.finalizeAttempt).not.toHaveBeenCalled();
  });

  it("X. payment recorded but order creation failed → 500 (so a redelivery retries), payment not lost", async () => {
    const { deps } = makeDeps({ finalize: { kind: "materialization_failed", error: "db down" } });
    const out = await processFawaterakPaidWebhook(paidBody(ATTEMPT_ID), deps);
    expect(out.statusCode).toBe(500);
    expect(String(out.body.error)).toMatch(/Payment recorded/);
  });

  it("a pending (async method) webhook records the attempt as pending, never paid", async () => {
    const { deps, attemptDeps } = makeDeps();
    const body = { ...paidBody(ATTEMPT_ID), status: "pending" };
    const out = await processFawaterakPaidWebhook(body, deps);
    expect(out.body.result).toBe("pending");
    expect(attemptDeps.recordOutcome).toHaveBeenCalledWith(ATTEMPT_ID, "pending", expect.anything());
    expect(attemptDeps.finalizeAttempt).not.toHaveBeenCalled();
  });
});

describe("Fawaterak failed / cancel webhooks — payment attempts", () => {
  function failedBody(overrides: Record<string, unknown> = {}) {
    const fields = { transaction_id: 777, transaction_key: INTENT_KEY, payment_method: "Visa-Mastercard" };
    return {
      ...fields,
      pay_load: JSON.stringify({ orderId: ATTEMPT_ID }),
      errorMessage: "Declined",
      hashKey: signPaid(fields),
      ...overrides,
    };
  }

  function cancelBody(status: string) {
    return {
      referenceId: 998877,
      paymentMethod: "Fawry",
      status,
      transactionKey: INTENT_KEY,
      pay_load: JSON.stringify({ orderId: ATTEMPT_ID }),
      hashKey: signCancel({ referenceId: 998877, paymentMethod: "Fawry" }),
    };
  }

  it("L. failed → recorded as failed with the provider's reason; no order path is touched", async () => {
    const { deps, attemptDeps } = makeDeps();
    const out = await processFawaterakFailedWebhook(failedBody(), deps);
    expect(out.body.result).toBe("failed");
    expect(attemptDeps.recordOutcome).toHaveBeenCalledWith(ATTEMPT_ID, "failed", {
      gatewayData: expect.anything(),
      failureReason: "Declined",
    });
    expect(attemptDeps.finalizeAttempt).not.toHaveBeenCalled();
    expect(deps.applyPaymentUpdate).not.toHaveBeenCalled();
  });

  it("failed after paid → ignored (already_paid), never recorded", async () => {
    const { deps, attemptDeps } = makeDeps({ attempt: makeAttempt({ status: "materialized" }) });
    const out = await processFawaterakFailedWebhook(failedBody(), deps);
    expect(out.body.result).toBe("already_paid");
    expect(attemptDeps.recordOutcome).not.toHaveBeenCalled();
  });

  it("M. provider EXPIRED → expired; any other cancel status → cancelled (no time-based expiry)", async () => {
    const expired = makeDeps();
    await processFawaterakCancelWebhook(cancelBody("EXPIRED"), expired.deps);
    expect(expired.attemptDeps.recordOutcome).toHaveBeenCalledWith(ATTEMPT_ID, "expired", expect.anything());

    const cancelled = makeDeps();
    await processFawaterakCancelWebhook(cancelBody("CANCELLED"), cancelled.deps);
    expect(cancelled.attemptDeps.recordOutcome).toHaveBeenCalledWith(ATTEMPT_ID, "cancelled", expect.anything());
  });

  it("a cancel whose transactionKey isn't the attempt's intent is refused", async () => {
    const { deps, attemptDeps } = makeDeps({ attempt: makeAttempt({ intentKey: "other" }) });
    const out = await processFawaterakCancelWebhook(cancelBody("CANCELLED"), deps);
    expect(out.statusCode).toBe(409);
    expect(attemptDeps.recordOutcome).not.toHaveBeenCalled();
  });
});
