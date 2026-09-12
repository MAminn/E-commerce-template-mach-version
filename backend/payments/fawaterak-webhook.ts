/**
 * Fawaterak Webhook Handlers (v3 hosted checkout)
 *
 * Registered as a Fastify plugin under /api/webhooks:
 *   POST /api/webhooks/fawaterak_json          paid / pending
 *   POST /api/webhooks/fawaterak-failed_json   failed attempt
 *   POST /api/webhooks/fawaterak-cancel_json   reference expired / cancelled
 *
 * The `_json` suffix is what makes Fawaterak send application/json.
 *
 * A webhook is never trusted on its own. "paid" only triggers an authoritative
 * POST /api/v3/getTransactionData lookup; the order is marked paid solely when
 * that lookup passes verifyFawaterakPaidTransaction() against the DB row.
 *
 * The processors take an explicit `deps` bag (DB lookups, provider fetch,
 * order update) so the whole decision tree is unit-testable; the Fastify
 * plugin at the bottom wires the real implementations.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isFawaterakConfigured } from "#root/shared/config/payment";
import {
  query,
  DatabaseClientService,
  type DatabaseClient,
} from "#root/shared/database/drizzle/db";
import { order } from "#root/shared/database/drizzle/schema";
import {
  recordWebhookLog,
  updateWebhookLogStatus,
} from "#root/backend/orders/order-log";
import { applyOnlinePaymentUpdate } from "./confirm-online-payment";
import {
  fetchFawaterakTransactionData,
  parseFawaterakPayLoad,
  verifyFawaterakCancelWebhookHash,
  verifyFawaterakFailedWebhookHash,
  verifyFawaterakPaidTransaction,
  verifyFawaterakPaidWebhookHash,
  type FawaterakTransactionData,
} from "./fawaterak-service";

// ─── Payload schemas ────────────────────────────────────────────────────────

const signable = z.union([z.string(), z.number()]);

export const fawaterakPaidWebhookSchema = z
  .object({
    transaction_key: z.string().min(1),
    transaction_id: signable,
    payment_method: z.string().min(1),
    status: z.enum(["paid", "pending"]),
    transactionHashKey: z.string().min(1),
    pay_load: z.unknown().optional(),
    paidAmount: z.unknown().optional(),
    paidCurrency: z.unknown().optional(),
    paidAt: z.unknown().optional(),
    referenceNumber: z.unknown().optional(),
  })
  .passthrough();

export const fawaterakFailedWebhookSchema = z
  .object({
    transaction_key: z.string().min(1),
    transaction_id: signable,
    payment_method: z.string().min(1),
    hashKey: z.string().min(1),
    pay_load: z.unknown().optional(),
    errorMessage: z.unknown().optional(),
  })
  .passthrough();

export const fawaterakCancelWebhookSchema = z
  .object({
    referenceId: signable,
    paymentMethod: z.string().min(1),
    status: z.string().optional(),
    hashKey: z.string().min(1),
    transactionKey: z.string().optional(),
    transactionId: signable.optional(),
    pay_load: z.unknown().optional(),
  })
  .passthrough();

// ─── Processor contract ─────────────────────────────────────────────────────

export interface FawaterakWebhookOrder {
  id: string;
  paymentMethod: string;
  paymentStatus: string;
  paymentSessionId: string | null;
  paymentTransactionId: string | null;
  total: string;
}

export interface FawaterakWebhookDeps {
  findOrderById(orderId: string): Promise<FawaterakWebhookOrder | null>;
  fetchTransaction(intentKey: string): Promise<FawaterakTransactionData>;
  applyPaymentUpdate(
    orderId: string,
    update: {
      paymentStatus: "paid" | "failed";
      transactionId?: string | null;
      gatewayData?: unknown;
    },
  ): Promise<unknown>;
  /** Store the latest gateway payload without touching payment status. */
  recordGatewayData(orderId: string, gatewayData: unknown): Promise<void>;
  log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
}

export interface FawaterakWebhookOutcome {
  statusCode: number;
  body: Record<string, unknown>;
  /** Persisted to webhook_log; null when the webhook was fully processed. */
  error: string | null;
  orderId: string | null;
}

const ok = (
  orderId: string | null,
  extra: Record<string, unknown> = {},
): FawaterakWebhookOutcome => ({
  statusCode: 200,
  body: { status: "ok", ...extra },
  error: null,
  orderId,
});

const reject = (
  statusCode: number,
  error: string,
  orderId: string | null = null,
): FawaterakWebhookOutcome => ({
  statusCode,
  body: { status: "error", error },
  error,
  orderId,
});

/** Accepted but deliberately not acted upon — still a 200 for the provider. */
const accepted = (orderId: string | null, note: string): FawaterakWebhookOutcome => ({
  statusCode: 200,
  body: { status: "ok", result: "ignored", reason: note },
  error: note,
  orderId,
});

const FINAL_PAID_STATES = new Set(["paid", "refunded"]);

/**
 * Locate the order BOTH ways: pay_load must name an order, and that order's
 * stored paymentSessionId must equal the webhook's transaction key. Either
 * side failing means we don't touch anything.
 */
async function locateOrder(
  deps: FawaterakWebhookDeps,
  payLoadRaw: unknown,
  transactionKey: string | undefined,
): Promise<
  | { ok: true; order: FawaterakWebhookOrder }
  | { ok: false; outcome: FawaterakWebhookOutcome }
> {
  const payLoad = parseFawaterakPayLoad(payLoadRaw);
  if (!payLoad) {
    return { ok: false, outcome: reject(400, "pay_load missing or malformed") };
  }
  const found = await deps.findOrderById(payLoad.orderId);
  if (!found) {
    return { ok: false, outcome: reject(404, "Order not found", payLoad.orderId) };
  }
  if (found.paymentMethod !== "fawaterak") {
    return {
      ok: false,
      outcome: reject(409, "Order is not a Fawaterak payment", found.id),
    };
  }
  if (transactionKey !== undefined) {
    if (!found.paymentSessionId || found.paymentSessionId !== transactionKey) {
      return {
        ok: false,
        outcome: reject(409, "transaction_key does not match order payment session", found.id),
      };
    }
  } else if (!found.paymentSessionId) {
    return { ok: false, outcome: reject(409, "Order has no payment session", found.id) };
  }
  return { ok: true, order: found };
}

// ─── Paid / pending ─────────────────────────────────────────────────────────

export async function processFawaterakPaidWebhook(
  body: unknown,
  deps: FawaterakWebhookDeps,
): Promise<FawaterakWebhookOutcome> {
  const parsed = fawaterakPaidWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return reject(400, "Invalid webhook payload");
  }
  const payload = parsed.data;

  if (!verifyFawaterakPaidWebhookHash(payload)) {
    deps.log.warn("[Fawaterak] Rejected paid webhook — invalid transactionHashKey");
    return reject(401, "Invalid signature");
  }

  const located = await locateOrder(deps, payload.pay_load, payload.transaction_key);
  if (!located.ok) return located.outcome;
  const { order: orderRow } = located;

  // Idempotency: a repeated "paid" (or anything after a refund) is a no-op —
  // no provider call, no update, no side effects.
  if (FINAL_PAID_STATES.has(orderRow.paymentStatus)) {
    deps.log.info(`[Fawaterak] Order ${orderRow.id} already ${orderRow.paymentStatus} — webhook ignored`);
    return ok(orderRow.id, { result: "already_paid" });
  }

  if (payload.status === "pending") {
    // Async method (Fawry, Aman…) awaiting the customer. Keep paymentStatus
    // "pending"; just retain the payload for support/debugging.
    await deps.recordGatewayData(orderRow.id, payload);
    deps.log.info(`[Fawaterak] Order ${orderRow.id} pending via ${payload.payment_method}`);
    return ok(orderRow.id, { result: "pending" });
  }

  // status === "paid": the webhook is only a hint. Ask Fawaterak directly.
  let providerData: FawaterakTransactionData;
  try {
    providerData = await deps.fetchTransaction(payload.transaction_key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log.error(`[Fawaterak] getTransactionData failed for order ${orderRow.id}: ${message}`);
    // 502 so the failure is visible; our DB is untouched and the confirmation
    // page's verify poll will re-check the provider.
    return reject(502, "Provider verification unavailable", orderRow.id);
  }

  const verification = verifyFawaterakPaidTransaction(
    { id: orderRow.id, paymentSessionId: orderRow.paymentSessionId, total: orderRow.total },
    providerData,
  );

  if (!verification.ok) {
    deps.log.warn(
      `[Fawaterak] Paid webhook for order ${orderRow.id} NOT confirmed: ${verification.reason}`,
    );
    await deps.recordGatewayData(orderRow.id, { webhook: payload, provider: providerData });
    return accepted(orderRow.id, `Not confirmed: ${verification.reason}`);
  }

  await deps.applyPaymentUpdate(orderRow.id, {
    paymentStatus: "paid",
    transactionId: verification.transactionId,
    gatewayData: providerData,
  });
  deps.log.info(
    `[Fawaterak] Payment confirmed for order ${orderRow.id} (txn ${verification.transactionId})`,
  );
  return ok(orderRow.id, { result: "paid" });
}

// ─── Failed ─────────────────────────────────────────────────────────────────

export async function processFawaterakFailedWebhook(
  body: unknown,
  deps: FawaterakWebhookDeps,
): Promise<FawaterakWebhookOutcome> {
  const parsed = fawaterakFailedWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return reject(400, "Invalid webhook payload");
  }
  const payload = parsed.data;

  if (!verifyFawaterakFailedWebhookHash(payload)) {
    deps.log.warn("[Fawaterak] Rejected failed webhook — invalid hashKey");
    return reject(401, "Invalid signature");
  }

  const located = await locateOrder(deps, payload.pay_load, payload.transaction_key);
  if (!located.ok) return located.outcome;
  const { order: orderRow } = located;

  return markAttemptFailed(deps, orderRow, payload, String(payload.transaction_id), "failed");
}

// ─── Cancel / expired ───────────────────────────────────────────────────────

export async function processFawaterakCancelWebhook(
  body: unknown,
  deps: FawaterakWebhookDeps,
): Promise<FawaterakWebhookOutcome> {
  const parsed = fawaterakCancelWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return reject(400, "Invalid webhook payload");
  }
  const payload = parsed.data;

  if (!verifyFawaterakCancelWebhookHash(payload)) {
    deps.log.warn("[Fawaterak] Rejected cancel webhook — invalid hashKey");
    return reject(401, "Invalid signature");
  }

  const located = await locateOrder(deps, payload.pay_load, payload.transactionKey);
  if (!located.ok) return located.outcome;
  const { order: orderRow } = located;

  const transactionId =
    payload.transactionId !== undefined ? String(payload.transactionId) : null;
  return markAttemptFailed(
    deps,
    orderRow,
    payload,
    transactionId,
    (payload.status ?? "cancelled").toLowerCase(),
  );
}

/**
 * Shared tail for failed/cancel. Never downgrades a paid order; otherwise
 * records the failed attempt through the existing payment-update path, which
 * leaves the customer order alive ("pending") so payment can be retried.
 */
async function markAttemptFailed(
  deps: FawaterakWebhookDeps,
  orderRow: FawaterakWebhookOrder,
  payload: unknown,
  transactionId: string | null,
  kind: string,
): Promise<FawaterakWebhookOutcome> {
  if (FINAL_PAID_STATES.has(orderRow.paymentStatus)) {
    deps.log.warn(
      `[Fawaterak] Ignoring ${kind} webhook for order ${orderRow.id} — already ${orderRow.paymentStatus}`,
    );
    return ok(orderRow.id, { result: "already_paid" });
  }

  await deps.applyPaymentUpdate(orderRow.id, {
    paymentStatus: "failed",
    transactionId,
    gatewayData: payload,
  });
  deps.log.info(`[Fawaterak] Payment ${kind} for order ${orderRow.id}`);
  return ok(orderRow.id, { result: kind });
}

// ─── Fastify plugin (real deps) ─────────────────────────────────────────────

function buildDeps(db: DatabaseClient, fastify: FastifyInstance): FawaterakWebhookDeps {
  const run = <T, E>(effect: Effect.Effect<T, E, DatabaseClientService>) =>
    Effect.runPromise(Effect.provideService(effect, DatabaseClientService, db));

  return {
    findOrderById: (orderId) =>
      run(
        query(async (client) => {
          const [row] = await client
            .select({
              id: order.id,
              paymentMethod: order.paymentMethod,
              paymentStatus: order.paymentStatus,
              paymentSessionId: order.paymentSessionId,
              paymentTransactionId: order.paymentTransactionId,
              total: order.total,
            })
            .from(order)
            .where(eq(order.id, orderId))
            .limit(1)
            .execute();
          return row ?? null;
        }),
      ),
    fetchTransaction: (intentKey) => fetchFawaterakTransactionData(intentKey),
    applyPaymentUpdate: (orderId, update) =>
      run(query((client) => applyOnlinePaymentUpdate(client, orderId, update))),
    recordGatewayData: (orderId, gatewayData) =>
      run(
        query(async (client) => {
          await client
            .update(order)
            .set({ paymentGatewayData: gatewayData as never, updatedAt: new Date() })
            .where(eq(order.id, orderId))
            .execute();
        }),
      ),
    log: {
      info: (m) => fastify.log.info(m),
      warn: (m) => fastify.log.warn(m),
      error: (m) => fastify.log.error(m),
    },
  };
}

type Processor = (
  body: unknown,
  deps: FawaterakWebhookDeps,
) => Promise<FawaterakWebhookOutcome>;

function route(
  fastify: FastifyInstance,
  path: string,
  webhookType: string,
  processor: Processor,
) {
  fastify.post(path, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body;
    const webhookLogId = await recordWebhookLog({
      webhookType,
      provider: "fawaterak",
      payload: body,
    });

    try {
      const outcome = await processor(body, buildDeps(request.db, fastify));
      if (webhookLogId) {
        await updateWebhookLogStatus(
          webhookLogId,
          outcome.error ? "failed" : "processed",
          outcome.error,
        );
      }
      return reply.code(outcome.statusCode).send(outcome.body);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      fastify.log.error(`[Fawaterak] Webhook error (${webhookType}): ${message}`);
      if (webhookLogId) {
        await updateWebhookLogStatus(webhookLogId, "failed", message);
      }
      return reply.code(500).send({ status: "error", error: "Webhook processing failed" });
    }
  });
}

export async function fawaterakWebhookPlugin(fastify: FastifyInstance) {
  if (!isFawaterakConfigured()) {
    for (const path of ["/fawaterak_json", "/fawaterak-failed_json", "/fawaterak-cancel_json"]) {
      fastify.post(path, async (_req, reply) =>
        reply.code(404).send({ error: "Fawaterak is not configured" }),
      );
    }
    return;
  }

  route(fastify, "/fawaterak_json", "payment", processFawaterakPaidWebhook);
  route(fastify, "/fawaterak-failed_json", "payment_failed", processFawaterakFailedWebhook);
  route(fastify, "/fawaterak-cancel_json", "payment_cancel", processFawaterakCancelWebhook);
}
