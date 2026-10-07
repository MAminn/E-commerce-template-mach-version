/**
 * Payment-attempt-first online checkout (Fawaterak).
 *
 *   startOnlineCheckout  price the cart (shared priceCheckout) → insert a
 *                        payment_attempt holding the frozen snapshot → create
 *                        the Fawaterak transaction with the attempt id as the
 *                        opaque reference → hand back the hosted payment URL.
 *                        NO order, NO stock change, NO promo usage, NO email,
 *                        NO Bosta, NO cart conversion.
 *
 *   finalizePaidAttempt  called by the paid webhook, the confirmation-page
 *                        poll, the admin retry and the reconciliation sweep —
 *                        all the same idempotent operation:
 *                          1. persist "provider verified paid" on the attempt
 *                             (its own statement — never lost if step 2 fails)
 *                          2. materialize: one transaction holding the attempt
 *                             row lock creates the order (order.id = attempt.id,
 *                             so the primary key forbids a second order),
 *                             commits stock and promo usage, marks it
 *                             materialized
 *                          3. post-order effects (emails, cart conversion,
 *                             Bosta) run once, by whoever claims them.
 *
 * Callers must have verified the payment with the provider before passing a
 * VerifiedPayment; this module trusts it.
 */

import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { Effect, Either } from "effect";
import { z } from "zod";
import type { ClientSession } from "#root/backend/auth/shared/entities";
import type { DatabaseClient } from "#root/shared/database/drizzle/db";
import {
  order,
  orderItem,
  orderLog,
  paymentAttempt,
  product,
  promoCode,
  user,
  type PaymentAttemptRow,
} from "#root/shared/database/drizzle/schema";
import { ServerError } from "#root/shared/error/server";
import {
  buildOrderAddressFields,
  createOrderSchema,
  priceCheckout,
  renderNewOrderEmail,
  resolveCheckoutUserId,
} from "#root/backend/orders/create-order/service";
import { getStoreOwnerId } from "#root/shared/config/store";
import { getEmailBranding } from "#root/backend/emails/branding";
import { createEmailServiceFromEnv } from "#root/shared/email/from-env";
import type { EmailServiceInterface } from "#root/shared/email/service";
import { markCartConverted } from "#root/backend/cart-capture/service";
import { isBostaEnabled } from "#root/backend/orders/bosta/service";
import { dispatchOrderToBosta } from "#root/backend/orders/bosta/dispatch";
import {
  FAWATERAK_CURRENCY,
  createFawaterakTransactionRequest,
  fetchFawaterakTransactionData,
  verifyFawaterakPaidTransaction,
  type FawaterakTransactionData,
} from "#root/backend/payments/fawaterak-service";
import type { PaymentAttemptOrderSnapshot } from "#root/shared/types/payment-attempt";
import { claimOrderReference } from "#root/backend/orders/order-reference";
import { displayOrderNumber } from "#root/shared/orders/order-reference";
import {
  paidOnHoldAdminNotice,
  paidUnderReviewCustomerNotice,
} from "#root/backend/emails/order-email-notice";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PaymentAttemptStatus = PaymentAttemptRow["status"];

/** States from which a provider-reported failure/cancel may still be recorded. */
const UNPAID_STATES: PaymentAttemptStatus[] = ["created", "pending", "failed"];
/** States in which the money is ours — nothing may move an attempt out of these. */
export const PAID_STATES: PaymentAttemptStatus[] = [
  "paid_pending_materialization",
  "materialized",
];
/** States worth asking the provider about (an intent exists, not yet paid). */
const CHECKABLE_STATES: PaymentAttemptStatus[] = [
  "created",
  "pending",
  "failed",
  "cancelled",
  "expired",
];

export interface VerifiedPayment {
  transactionId: string;
  /** Provider-reported paid_at, kept for the record (gateway data has it too). */
  providerPaidAt: string | null;
  gatewayData: unknown;
  providerPaymentMethod?: string | null;
}

export type FinalizeOutcome =
  | { kind: "materialized"; orderId: string; held: boolean }
  | { kind: "already_materialized"; orderId: string | null; held: boolean }
  | { kind: "materialization_failed"; error: string }
  | { kind: "not_paid"; status: PaymentAttemptStatus }
  | { kind: "not_found" };

export const startCheckoutSchema = createOrderSchema.extend({
  paymentMethod: z.literal("fawaterak"),
  /** Browser cart-capture token: resume key + paid-time cart conversion. */
  cartSessionToken: z.string().trim().min(1).max(200).optional(),
});
export type StartCheckoutInput = z.infer<typeof startCheckoutSchema>;

export type StartCheckoutResult =
  | { kind: "redirect"; attemptId: string; paymentUrl: string; resumed: boolean }
  | { kind: "already_paid"; attemptId: string };

/** Provider calls, injectable for tests. */
export interface ProviderDeps {
  createTransaction: typeof createFawaterakTransactionRequest;
  fetchTransaction: typeof fetchFawaterakTransactionData;
}

const defaultProvider: ProviderDeps = {
  createTransaction: createFawaterakTransactionRequest,
  fetchTransaction: fetchFawaterakTransactionData,
};

// ─── Fingerprint ────────────────────────────────────────────────────────────

/**
 * Identity of "the same priced checkout": who, where, what, at what price.
 * An identical re-submit from the same browser resumes the open attempt
 * instead of opening a second payable Fawaterak transaction. Any change —
 * cart, address, promo, or a price change that moves the total — is a new
 * checkout.
 */
export function computeCheckoutFingerprint(parts: {
  userId: string | null;
  snapshot: PaymentAttemptOrderSnapshot;
  lines: Array<{ productId: string; selectedOptions: string | null; quantity: number; unitPrice: number }>;
  promoCodeId: string | null;
  total: number;
}): string {
  const canonical = JSON.stringify({
    u: parts.userId,
    c: [
      parts.snapshot.customerName,
      parts.snapshot.customerEmail,
      parts.snapshot.customerPhone,
      parts.snapshot.shippingAddress,
      parts.snapshot.shippingCity,
      parts.snapshot.shippingState ?? null,
      parts.snapshot.shippingDistrict ?? null,
      parts.snapshot.shippingPostalCode ?? null,
      parts.snapshot.shippingCountry ?? null,
      parts.snapshot.notes ?? null,
    ],
    l: parts.lines.map((l) => [l.productId, l.selectedOptions, l.quantity, l.unitPrice]),
    p: parts.promoCodeId,
    t: parts.total,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ─── Start checkout ─────────────────────────────────────────────────────────

const START_FAILED_MESSAGE =
  "We couldn't start the online payment. Nothing was charged and your cart is still here — please try again.";

export async function startOnlineCheckout(
  db: DatabaseClient,
  input: StartCheckoutInput,
  session?: ClientSession,
  provider: ProviderDeps = defaultProvider,
  options: { newId?: () => string } = {},
): Promise<StartCheckoutResult> {
  // 1. Authoritative pricing — the same function COD uses. Read-only.
  const userId = await resolveCheckoutUserId(db, session);
  const priced = await priceCheckout(db, input, userId);

  const address = buildOrderAddressFields(input);
  const snapshot: PaymentAttemptOrderSnapshot = {
    userId,
    customerName: address.customerName,
    customerEmail: address.customerEmail,
    customerPhone: address.customerPhone,
    shippingAddress: address.shippingAddress,
    shippingCity: address.shippingCity,
    shippingState: address.shippingState,
    shippingDistrict: address.shippingDistrict,
    shippingPostalCode: address.shippingPostalCode,
    shippingCountry: address.shippingCountry,
    notes: address.notes,
    appliedOffers: priced.appliedOffers.map((o) => ({
      id: o.id,
      name: o.name,
      discountAmount: o.discountAmount,
      freeShipping: o.freeShipping,
    })),
  };
  const promoCodeId = priced.promoCodeData?.id ?? null;
  const fingerprint = computeCheckoutFingerprint({
    userId,
    snapshot,
    lines: priced.lines,
    promoCodeId,
    total: priced.total,
  });

  // 2. Resume an open attempt for this exact checkout from this browser.
  if (input.cartSessionToken) {
    const resumed = await tryResumeAttempt(db, input.cartSessionToken, fingerprint, provider);
    if (resumed) return resumed;
  }

  // 3. Freeze the snapshot. Money columns are written as the same strings
  //    createOrder writes and read back from the DB, so the provider is
  //    charged exactly the decimal the order will store. The id is drawn
  //    together with its unique reference (registry claim + insert commit
  //    together; a collision just draws another id).
  const [attempt] = await db.transaction(async (tx) => {
    const { id, reference } = await claimOrderReference(tx, "attempt", options.newId);
    return tx
      .insert(paymentAttempt)
      .values({
        id,
        reference,
        provider: "fawaterak",
        status: "created",
        userId,
        cartSessionToken: input.cartSessionToken ?? null,
        fingerprint,
        customerName: snapshot.customerName,
        customerEmail: snapshot.customerEmail,
        customerPhone: snapshot.customerPhone,
        orderSnapshot: snapshot,
        itemsSnapshot: priced.lines,
        subtotal: priced.subtotal.toString(),
        offerDiscount: priced.offerDiscount.toString(),
        promoDiscount: priced.promoDiscount.toString(),
        discount: priced.combinedDiscount > 0 ? priced.combinedDiscount.toString() : null,
        shipping: priced.shipping.toString(),
        tax: "0",
        total: priced.total.toString(),
        currency: FAWATERAK_CURRENCY,
        promoCodeId,
        promoCode: priced.promoCodeData?.code ?? null,
      })
      .returning();
  });

  if (!attempt) {
    throw new ServerError({
      tag: "PaymentAttemptCreationFailed",
      statusCode: 500,
      clientMessage: START_FAILED_MESSAGE,
    });
  }

  // 4. Fawaterak hosted transaction, referenced by the attempt id.
  let session_: { sessionId: string; paymentUrl: string };
  try {
    session_ = await provider.createTransaction({
      orderId: attempt.id,
      referenceKind: "attempt",
      reference: attempt.reference ?? undefined,
      customerName: attempt.customerName,
      customerEmail: attempt.customerEmail,
      customerPhone: attempt.customerPhone,
      shippingAddress: snapshot.shippingAddress,
      total: attempt.total,
      itemNames: priced.lines.map((l) => l.name),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Kept for audit; terminal — it never had a payable intent.
    await db
      .update(paymentAttempt)
      .set({
        status: "session_failed",
        failureReason: reason.slice(0, 500),
        failedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(paymentAttempt.id, attempt.id), eq(paymentAttempt.status, "created")))
      .execute();
    throw new ServerError({
      tag: "PaymentError",
      message: `Fawaterak createTransaction failed for attempt ${attempt.id}: ${reason}`,
      statusCode: 502,
      clientMessage: START_FAILED_MESSAGE,
    });
  }

  await db
    .update(paymentAttempt)
    .set({
      status: "pending",
      intentKey: session_.sessionId,
      paymentUrl: session_.paymentUrl,
      nextProviderCheckAt: new Date(Date.now() + nextProviderCheckDelayMs(0)),
      updatedAt: new Date(),
    })
    .where(and(eq(paymentAttempt.id, attempt.id), eq(paymentAttempt.status, "created")))
    .execute();

  return { kind: "redirect", attemptId: attempt.id, paymentUrl: session_.paymentUrl, resumed: false };
}

/**
 * Reuse the newest open attempt (pending, or failed — a failed try on the
 * hosted page is not terminal) with the same fingerprint. Before sending the
 * customer back to pay, ask the provider whether it is in fact already paid
 * (e.g. a lost webhook) so they are never asked to pay twice.
 */
async function tryResumeAttempt(
  db: DatabaseClient,
  cartSessionToken: string,
  fingerprint: string,
  provider: ProviderDeps,
): Promise<StartCheckoutResult | null> {
  const [open] = await db
    .select()
    .from(paymentAttempt)
    .where(
      and(
        eq(paymentAttempt.cartSessionToken, cartSessionToken),
        eq(paymentAttempt.fingerprint, fingerprint),
        inArray(paymentAttempt.status, ["pending", "failed"]),
      ),
    )
    .orderBy(sql`${paymentAttempt.createdAt} desc`)
    .limit(1)
    .execute();

  if (!open?.intentKey || !open.paymentUrl) return null;

  const outcome = await checkProviderAndFinalize(db, open, provider);
  if (outcome && (outcome.kind === "materialized" || outcome.kind === "already_materialized" || outcome.kind === "materialization_failed")) {
    return { kind: "already_paid", attemptId: open.id };
  }
  return { kind: "redirect", attemptId: open.id, paymentUrl: open.paymentUrl, resumed: true };
}

// ─── Provider check (poll / resume / admin re-check) ────────────────────────

/**
 * Ask Fawaterak about an attempt's intent and, if it verifies as paid against
 * the attempt snapshot, finalize it. Returns null when there is nothing to do
 * or the provider is unreachable (state untouched).
 */
/**
 * What Fawaterak currently says about an attempt's intent, verified against
 * the attempt snapshot. Pure lookup — no writes.
 */
export type ProviderInspection =
  | { kind: "paid"; payment: VerifiedPayment }
  | { kind: "unpaid"; statusText: string | null; terminal: "cancelled" | "expired" | null }
  | { kind: "unverified"; reason: string; data: FawaterakTransactionData }
  | { kind: "error"; error: string };

/**
 * Provider statuses that end an attempt. Only these exact words are treated
 * as terminal (the cancel/expired webhook's own vocabulary); anything else
 * the provider reports for an unpaid transaction keeps the attempt open.
 * Terminal never blocks a later verified payment.
 */
function terminalFromStatusText(statusText: string | null): "cancelled" | "expired" | null {
  const value = statusText?.trim().toLowerCase();
  if (value === "expired") return "expired";
  if (value === "cancelled" || value === "canceled") return "cancelled";
  return null;
}

export async function inspectProvider(
  attempt: Pick<PaymentAttemptRow, "id" | "intentKey" | "total">,
  provider: Pick<ProviderDeps, "fetchTransaction"> = defaultProvider,
): Promise<ProviderInspection> {
  if (!attempt.intentKey) return { kind: "error", error: "attempt has no provider intent" };

  let data: FawaterakTransactionData;
  try {
    data = await provider.fetchTransaction(attempt.intentKey);
  } catch (error) {
    return { kind: "error", error: error instanceof Error ? error.message : String(error) };
  }

  const verification = verifyFawaterakPaidTransaction(
    { id: attempt.id, paymentSessionId: attempt.intentKey, total: attempt.total },
    data,
  );
  if (verification.ok) {
    return {
      kind: "paid",
      payment: {
        transactionId: verification.transactionId,
        providerPaidAt: verification.paidAt,
        gatewayData: data,
        providerPaymentMethod: typeof data.payment_method === "string" ? data.payment_method : null,
      },
    };
  }
  if (verification.paid) {
    return { kind: "unverified", reason: verification.reason, data };
  }
  const statusText = typeof data.status_text === "string" ? data.status_text : null;
  return { kind: "unpaid", statusText, terminal: terminalFromStatusText(statusText) };
}

/**
 * Ask Fawaterak about an attempt's intent and act on the answer: a verified
 * payment is finalized (the same idempotent finalizer as the webhook), an
 * explicit provider cancel/expiry is recorded, a paid-but-mismatched answer
 * is kept as evidence and never finalized. Returns the finalize outcome when
 * one ran, otherwise null (state untouched on provider errors).
 */
export async function checkProviderAndFinalize(
  db: DatabaseClient,
  attempt: Pick<PaymentAttemptRow, "id" | "status" | "intentKey" | "total">,
  provider: Pick<ProviderDeps, "fetchTransaction"> = defaultProvider,
): Promise<FinalizeOutcome | null> {
  if (!attempt.intentKey || !CHECKABLE_STATES.includes(attempt.status)) return null;
  const inspection = await inspectProvider(attempt, provider);
  return applyInspection(db, attempt, inspection);
}

async function applyInspection(
  db: DatabaseClient,
  attempt: Pick<PaymentAttemptRow, "id">,
  inspection: ProviderInspection,
): Promise<FinalizeOutcome | null> {
  switch (inspection.kind) {
    case "paid":
      return finalizePaidAttempt(db, attempt.id, inspection.payment);
    case "unverified":
      // Provider says paid but something doesn't match — never finalize,
      // keep the evidence for a human.
      console.error(`[PaymentAttempt] ${attempt.id} paid but NOT verified: ${inspection.reason}`);
      await recordAttemptGatewayData(db, attempt.id, {
        provider: inspection.data,
        unverified: inspection.reason,
      });
      return null;
    case "unpaid":
      if (inspection.terminal) {
        await recordAttemptOutcome(db, attempt.id, inspection.terminal, {
          gatewayData: { providerStatus: inspection.statusText },
          failureReason: `Provider status: ${inspection.statusText}`,
        });
      }
      return null;
    case "error":
      console.warn(`[PaymentAttempt] Provider lookup failed for ${attempt.id}: ${inspection.error}`);
      return null;
  }
}

// ─── Automatic provider reconciliation (unpaid attempts) ────────────────────

/**
 * How long until an unpaid attempt is asked about again, by number of checks
 * already made. This is a polling cadence, NOT an expiry: after the last step
 * an attempt keeps being checked once a day until the provider reports it
 * paid, cancelled or expired. Nothing is ever expired because it is old.
 */
export const PROVIDER_CHECK_BACKOFF_MINUTES = [2, 5, 10, 30, 60, 180, 360, 720, 1440] as const;
/** Max provider lookups per sweep — the hard ceiling on Fawaterak traffic. */
export const PROVIDER_RECONCILE_BATCH_SIZE = 20;
/** A claimed attempt is skipped by other sweeps for this long. */
const PROVIDER_CHECK_LEASE_MINUTES = 10;

export function nextProviderCheckDelayMs(checksDone: number): number {
  const steps = PROVIDER_CHECK_BACKOFF_MINUTES;
  const minutes = steps[Math.min(Math.max(checksDone, 0), steps.length - 1)] ?? 1440;
  return minutes * 60_000;
}

const RECONCILABLE_STATES: PaymentAttemptStatus[] = ["pending", "failed"];

export interface ProviderReconcileSummary {
  checked: number;
  finalized: number;
  closed: number;
  errors: number;
}

/**
 * Record one provider check on the attempt (time, count, result, error) and
 * schedule the next one. Never touches status.
 */
async function recordProviderCheck(
  db: DatabaseClient,
  attemptId: string,
  checksBefore: number,
  result: string,
  error: string | null,
  reschedule: boolean,
): Promise<void> {
  const now = new Date();
  await db
    .update(paymentAttempt)
    .set({
      providerCheckedAt: now,
      providerCheckCount: sql`${paymentAttempt.providerCheckCount} + 1`,
      providerCheckResult: result.slice(0, 200),
      providerCheckError: error ? error.slice(0, 500) : null,
      nextProviderCheckAt: reschedule
        ? new Date(now.getTime() + nextProviderCheckDelayMs(checksBefore + 1))
        : null,
      updatedAt: now,
    })
    .where(eq(paymentAttempt.id, attemptId))
    .execute();
}

/**
 * Check one attempt with Fawaterak and record the check. Used by the sweep and
 * by the admin "Check with Fawaterak" action.
 */
export async function reconcileAttemptWithProvider(
  db: DatabaseClient,
  attempt: Pick<PaymentAttemptRow, "id" | "status" | "intentKey" | "total" | "providerCheckCount">,
  provider: Pick<ProviderDeps, "fetchTransaction"> = defaultProvider,
): Promise<{ inspection: ProviderInspection["kind"]; outcome: FinalizeOutcome | null }> {
  const inspection = await inspectProvider(attempt, provider);
  const outcome = await applyInspection(db, attempt, inspection);

  const label =
    inspection.kind === "unpaid"
      ? `unpaid${inspection.statusText ? `: ${inspection.statusText}` : ""}`
      : inspection.kind === "unverified"
        ? `paid but not verified: ${inspection.reason}`
        : inspection.kind;
  const stillOpen =
    inspection.kind === "error" ||
    inspection.kind === "unverified" ||
    (inspection.kind === "unpaid" && !inspection.terminal);
  await recordProviderCheck(
    db,
    attempt.id,
    attempt.providerCheckCount,
    label,
    inspection.kind === "error" ? inspection.error : null,
    stillOpen,
  );
  return { inspection: inspection.kind, outcome };
}

/**
 * The webhook-lost safety net: ask Fawaterak about unpaid attempts that are
 * due for a check, newest first, at most PROVIDER_RECONCILE_BATCH_SIZE per
 * run. Each due row is claimed with FOR UPDATE SKIP LOCKED and leased, so
 * concurrent sweeps (several app instances) never check the same attempt
 * twice; a verified payment goes through the same idempotent finalizer as
 * the webhook. Provider errors are recorded and retried on the backoff.
 */
export async function reconcilePendingAttempts(
  db: DatabaseClient,
  options: {
    provider?: Pick<ProviderDeps, "fetchTransaction">;
    batchSize?: number;
  } = {},
): Promise<ProviderReconcileSummary> {
  const provider = options.provider ?? defaultProvider;
  const batchSize = options.batchSize ?? PROVIDER_RECONCILE_BATCH_SIZE;
  const now = new Date();
  const lease = new Date(now.getTime() + PROVIDER_CHECK_LEASE_MINUTES * 60_000);

  const due = db
    .select({ id: paymentAttempt.id })
    .from(paymentAttempt)
    .where(
      and(
        inArray(paymentAttempt.status, RECONCILABLE_STATES),
        isNotNull(paymentAttempt.intentKey),
        or(
          isNull(paymentAttempt.nextProviderCheckAt),
          lte(paymentAttempt.nextProviderCheckAt, now),
        ),
      ),
    )
    .orderBy(desc(paymentAttempt.createdAt))
    .limit(batchSize)
    .for("update", { skipLocked: true });

  const claimed = await db
    .update(paymentAttempt)
    .set({ nextProviderCheckAt: lease })
    .where(inArray(paymentAttempt.id, due))
    .returning({
      id: paymentAttempt.id,
      status: paymentAttempt.status,
      intentKey: paymentAttempt.intentKey,
      total: paymentAttempt.total,
      providerCheckCount: paymentAttempt.providerCheckCount,
    })
    .execute();

  const summary: ProviderReconcileSummary = { checked: 0, finalized: 0, closed: 0, errors: 0 };
  for (const attempt of claimed) {
    summary.checked++;
    try {
      const { inspection, outcome } = await reconcileAttemptWithProvider(db, attempt, provider);
      if (outcome && (outcome.kind === "materialized" || outcome.kind === "already_materialized")) {
        summary.finalized++;
      }
      if (inspection === "error") summary.errors++;
      if (inspection === "unpaid") {
        const [after] = await db
          .select({ status: paymentAttempt.status })
          .from(paymentAttempt)
          .where(eq(paymentAttempt.id, attempt.id))
          .execute();
        if (after && (after.status === "cancelled" || after.status === "expired")) summary.closed++;
      }
    } catch (error) {
      // Unexpected (e.g. DB) — leave the lease to expire and retry later.
      summary.errors++;
      console.error(`[PaymentReconcile] Attempt ${attempt.id} check failed:`, error);
    }
  }
  return summary;
}

// ─── Provider outcomes (webhooks) ───────────────────────────────────────────

/**
 * Record a non-paid provider outcome. Conditional updates mean a paid or
 * materialized attempt can never be downgraded, even racing a paid webhook.
 */
export async function recordAttemptOutcome(
  db: DatabaseClient,
  attemptId: string,
  outcome: "pending" | "failed" | "cancelled" | "expired",
  data: { gatewayData: unknown; failureReason?: string | null; providerPaymentMethod?: string | null },
): Promise<boolean> {
  const now = new Date();
  const allowedFrom: PaymentAttemptStatus[] =
    outcome === "cancelled" || outcome === "expired"
      ? [...UNPAID_STATES, "cancelled", "expired"]
      : UNPAID_STATES;

  const rows = await db
    .update(paymentAttempt)
    .set({
      status: outcome,
      gatewayData: data.gatewayData as never,
      ...(data.providerPaymentMethod ? { providerPaymentMethod: data.providerPaymentMethod } : {}),
      ...(outcome === "failed"
        ? { failedAt: now, failureReason: data.failureReason?.slice(0, 500) ?? null }
        : {}),
      ...(outcome === "cancelled" || outcome === "expired"
        ? { cancelledAt: now, failureReason: data.failureReason?.slice(0, 500) ?? null }
        : {}),
      updatedAt: now,
    })
    .where(and(eq(paymentAttempt.id, attemptId), inArray(paymentAttempt.status, allowedFrom)))
    .returning({ id: paymentAttempt.id })
    .execute();
  return rows.length > 0;
}

/** Keep the latest provider payload without touching status. */
export async function recordAttemptGatewayData(
  db: DatabaseClient,
  attemptId: string,
  gatewayData: unknown,
): Promise<void> {
  await db
    .update(paymentAttempt)
    .set({ gatewayData: gatewayData as never, updatedAt: new Date() })
    .where(eq(paymentAttempt.id, attemptId))
    .execute();
}

// ─── Finalize ───────────────────────────────────────────────────────────────

/**
 * The single paid-finalization operation. Safe to call any number of times,
 * concurrently, from anywhere: one order at most, side effects at most once.
 * Pass `payment` only after provider verification; pass null to retry
 * materialization / effects of an attempt already recorded as paid.
 */
export async function finalizePaidAttempt(
  db: DatabaseClient,
  attemptId: string,
  payment: VerifiedPayment | null,
): Promise<FinalizeOutcome> {
  if (payment) {
    await recordAttemptPaid(db, attemptId, payment);
  }

  const outcome = await materializeAttempt(db, attemptId);

  if (outcome.kind === "materialized" || outcome.kind === "already_materialized") {
    await runPostOrderEffects(db, attemptId);
  }
  return outcome;
}

/**
 * Step 1 — durable payment truth, committed on its own so a later
 * materialization failure can never lose it. Any unpaid state (including a
 * provider-reported failed/cancelled/expired) yields to a verified payment.
 */
async function recordAttemptPaid(
  db: DatabaseClient,
  attemptId: string,
  payment: VerifiedPayment,
): Promise<void> {
  const now = new Date();
  await db
    .update(paymentAttempt)
    .set({
      status: "paid_pending_materialization",
      transactionId: payment.transactionId,
      gatewayData: payment.gatewayData as never,
      ...(payment.providerPaymentMethod ? { providerPaymentMethod: payment.providerPaymentMethod } : {}),
      paidAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(paymentAttempt.id, attemptId),
        sql`${paymentAttempt.status} not in ('paid_pending_materialization', 'materialized')`,
      ),
    )
    .execute();
}

class MaterializationError extends Error {}

interface StockShortfall {
  productId: string;
  name: string;
  available: number;
  requested: number;
}

/**
 * Step 2 — create the order from the frozen snapshot. Holds the attempt row
 * lock (SELECT … FOR UPDATE) for the whole transaction, so a concurrent
 * caller waits and then sees "materialized". order.id = attempt.id makes a
 * second order a primary-key violation even if that lock were bypassed.
 */
export async function materializeAttempt(
  db: DatabaseClient,
  attemptId: string,
): Promise<FinalizeOutcome> {
  try {
    return await db.transaction(async (tx) => {
      const [att] = await tx
        .select()
        .from(paymentAttempt)
        .where(eq(paymentAttempt.id, attemptId))
        .for("update")
        .execute();

      if (!att) return { kind: "not_found" } as const;

      if (att.status === "materialized") {
        const [existing] = att.orderId
          ? await tx
              .select({ fulfillmentHold: order.fulfillmentHold })
              .from(order)
              .where(eq(order.id, att.orderId))
              .execute()
          : [];
        return {
          kind: "already_materialized",
          orderId: att.orderId,
          held: !!existing?.fulfillmentHold,
        } as const;
      }

      if (att.status !== "paid_pending_materialization") {
        return { kind: "not_paid", status: att.status } as const;
      }

      // ── Stock: lock the products (in id order — no deadlocks between two
      // materializations sharing products), then commit all or nothing.
      const need = new Map<string, number>();
      for (const line of att.itemsSnapshot) {
        need.set(line.productId, (need.get(line.productId) ?? 0) + line.quantity);
      }
      const productIds = [...need.keys()].sort();
      const locked = await tx
        .select({ id: product.id, stock: product.stock, name: product.name })
        .from(product)
        .where(inArray(product.id, productIds))
        .orderBy(asc(product.id))
        .for("update")
        .execute();

      const missing = productIds.filter((id) => !locked.some((p) => p.id === id));
      if (missing.length > 0) {
        // order_item needs the product row; this cannot become an order
        // automatically. The attempt stays paid_pending_materialization and
        // is listed for an admin.
        throw new MaterializationError(
          `Product(s) no longer exist, cannot create the order automatically: ${missing.join(", ")}`,
        );
      }

      const shortfalls: StockShortfall[] = locked
        .filter((p) => p.stock < (need.get(p.id) ?? 0))
        .map((p) => ({
          productId: p.id,
          name: p.name,
          available: p.stock,
          requested: need.get(p.id) ?? 0,
        }));
      const held = shortfalls.length > 0;

      if (!held) {
        for (const id of productIds) {
          const qty = need.get(id) ?? 0;
          const updated = await tx
            .update(product)
            .set({ stock: sql`${product.stock} - ${qty}` })
            .where(and(eq(product.id, id), gte(product.stock, qty)))
            .returning({ id: product.id })
            .execute();
          if (updated.length === 0) {
            // Impossible while we hold the row lock; never write negative stock.
            throw new MaterializationError(`Stock for ${id} changed under lock`);
          }
        }
      }

      // ── Promo: honor the paid snapshot, record usage atomically, flag
      // (never reject) an overage caused by concurrent paid attempts.
      const notes: string[] = [];
      let orderPromoCodeId: string | null = att.promoCodeId;
      if (!att.promoCodeId && att.promoCode) {
        // The promo row was deleted while the customer paid (FK set null).
        notes.push(
          `PROMO: code ${att.promoCode} was deleted before payment completed — the paid discount is honored, usage not recorded.`,
        );
      }
      if (att.promoCodeId) {
        const [promo] = await tx
          .update(promoCode)
          .set({
            usedCount: sql`${promoCode.usedCount} + 1`,
            status: sql`case when ${promoCode.usageLimit} is not null and ${promoCode.usedCount} + 1 >= ${promoCode.usageLimit} then 'exhausted'::promo_code_status else ${promoCode.status} end`,
          })
          .where(eq(promoCode.id, att.promoCodeId))
          .returning({
            usedCount: promoCode.usedCount,
            usageLimit: promoCode.usageLimit,
            usageLimitPerUser: promoCode.usageLimitPerUser,
          })
          .execute();

        if (!promo) {
          orderPromoCodeId = null;
          notes.push(
            `PROMO: code ${att.promoCode ?? att.promoCodeId} no longer exists — the paid discount is honored, usage not recorded.`,
          );
        } else {
          if (promo.usageLimit !== null && promo.usedCount > promo.usageLimit) {
            notes.push(
              `PROMO OVERAGE: ${att.promoCode} is now used ${promo.usedCount} times, limit ${promo.usageLimit} — honored because the customer had already paid.`,
            );
          }
          if (promo.usageLimitPerUser !== null) {
            const priorUses = await tx
              .select({ id: order.id })
              .from(order)
              .where(
                and(
                  eq(order.promoCodeId, att.promoCodeId),
                  att.userId ? eq(order.userId, att.userId) : eq(order.customerEmail, att.customerEmail),
                ),
              )
              .execute();
            if (priorUses.length >= promo.usageLimitPerUser) {
              notes.push(
                `PROMO OVERAGE: this customer has now used ${att.promoCode} ${priorUses.length + 1} times, per-customer limit ${promo.usageLimitPerUser} — honored because the customer had already paid.`,
              );
            }
          }
        }
      }

      // ── The order: exact frozen pricing, verified payment.
      const snap = att.orderSnapshot;
      const holdNote = held
        ? `Paid online, but stock ran out while the customer was paying: ${shortfalls
            .map((s) => `${s.name} (requested ${s.requested}, available ${s.available})`)
            .join("; ")}. DO NOT PREPARE — manual review required.`
        : null;

      await tx
        .insert(order)
        .values({
          id: att.id,
          reference: att.reference,
          userId: att.userId,
          customerName: snap.customerName,
          customerEmail: snap.customerEmail,
          customerPhone: snap.customerPhone,
          shippingAddress: snap.shippingAddress,
          shippingCity: snap.shippingCity,
          shippingState: snap.shippingState ?? "",
          shippingDistrict: snap.shippingDistrict ?? "",
          shippingPostalCode: snap.shippingPostalCode ?? "",
          shippingCountry: snap.shippingCountry ?? "",
          subtotal: att.subtotal,
          discount: att.discount,
          promoCodeId: orderPromoCodeId,
          shipping: att.shipping,
          tax: att.tax,
          total: att.total,
          notes: snap.notes ?? null,
          status: held ? "pending" : "processing",
          paymentMethod: "fawaterak",
          paymentStatus: "paid",
          paymentSessionId: att.intentKey,
          paymentTransactionId: att.transactionId,
          paymentGatewayData: att.gatewayData as never,
          fulfillmentHold: held ? "stock_conflict" : null,
          fulfillmentHoldNote: holdNote,
          // A held order took no stock, so cancelling it must not give any back.
          stockRestored: held,
        })
        .execute();

      for (const line of att.itemsSnapshot) {
        await tx
          .insert(orderItem)
          .values({
            orderId: att.id,
            productId: line.productId,
            vendorId: getStoreOwnerId(),
            quantity: line.quantity,
            price: line.listPrice,
            discountPrice: line.discountPrice,
            name: line.name,
            vendorName: null,
          })
          .execute();
      }

      // Audit trail, atomic with the order itself.
      await tx
        .insert(orderLog)
        .values([
          {
            orderId: att.id,
            action: "created",
            newStatus: held ? "pending" : "processing",
            note: `Order created from verified Fawaterak payment (attempt ${att.id}${
              att.transactionId ? `, txn ${att.transactionId}` : ""
            }), total ${att.total} EGP${notes.length ? ` — ${notes.join(" ")}` : ""}`,
          },
          {
            orderId: att.id,
            action: "payment_confirmed",
            oldStatus: "pending",
            newStatus: "paid",
            note: `Payment confirmed paid via fawaterak${att.transactionId ? ` (txn ${att.transactionId})` : ""}`,
          },
          ...(held
            ? [
                {
                  orderId: att.id,
                  action: "status_changed" as const,
                  newStatus: "pending",
                  note: `FULFILLMENT HOLD (stock_conflict): ${holdNote}`,
                },
              ]
            : []),
        ])
        .execute();

      const now = new Date();
      await tx
        .update(paymentAttempt)
        .set({
          status: "materialized",
          orderId: att.id,
          materializedAt: now,
          materializationError: null,
          materializationAttempts: sql`${paymentAttempt.materializationAttempts} + 1`,
          lastMaterializationAttemptAt: now,
          updatedAt: now,
        })
        .where(eq(paymentAttempt.id, att.id))
        .execute();

      return { kind: "materialized", orderId: att.id, held } as const;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[PaymentAttempt] Materialization failed for ${attemptId}: ${message}`);
    try {
      const now = new Date();
      await db
        .update(paymentAttempt)
        .set({
          materializationError: message.slice(0, 500),
          materializationAttempts: sql`${paymentAttempt.materializationAttempts} + 1`,
          lastMaterializationAttemptAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(paymentAttempt.id, attemptId),
            eq(paymentAttempt.status, "paid_pending_materialization"),
          ),
        )
        .execute();
    } catch {
      /* the paid status itself is already committed */
    }
    return { kind: "materialization_failed", error: message };
  }
}

// ─── Post-order effects ─────────────────────────────────────────────────────

let emailServicePromise: Promise<EmailServiceInterface> | null = null;
function getEmailService(): Promise<EmailServiceInterface> {
  emailServicePromise ??= createEmailServiceFromEnv({
    info: (obj, msg) => console.info("[PaymentAttempt email]", msg ?? obj),
    warn: (obj, msg) => console.warn("[PaymentAttempt email]", msg ?? obj),
    error: (obj, msg) => console.error("[PaymentAttempt email]", msg ?? obj),
  });
  return emailServicePromise;
}

/** Test hook. */
export function __setPaymentAttemptEmailService(service: EmailServiceInterface | null) {
  emailServicePromise = service ? Promise.resolve(service) : null;
}

/**
 * Step 3 — the order's business side effects, run at most once: the caller
 * that wins the effects_claimed_at claim runs them. If the process dies
 * before anyone claims, the next finalize call (poll, webhook, sweep, admin
 * retry) does.
 */
export async function runPostOrderEffects(db: DatabaseClient, attemptId: string): Promise<boolean> {
  const [claimed] = await db
    .update(paymentAttempt)
    .set({ effectsClaimedAt: new Date() })
    .where(
      and(
        eq(paymentAttempt.id, attemptId),
        eq(paymentAttempt.status, "materialized"),
        isNull(paymentAttempt.effectsClaimedAt),
      ),
    )
    .returning()
    .execute();

  if (!claimed?.orderId) return false;
  const orderId = claimed.orderId;

  const [orderRow] = await db.select().from(order).where(eq(order.id, orderId)).limit(1).execute();
  if (!orderRow) return false;
  const held = !!orderRow.fulfillmentHold;

  // Emails — the same templates COD sends. A held order never gets the normal
  // "Order Confirmation" (it would imply normal fulfillment): the customer
  // gets a truthful "payment received, under review" email instead, and
  // admins get the hold in red at the top. Runs once, under the claim above.
  try {
    const items = await db.select().from(orderItem).where(eq(orderItem.orderId, orderId)).execute();
    const branding = await getEmailBranding();
    const emailData = { ...orderRow, items };
    const number = displayOrderNumber(orderRow);
    const customerHtml = await Effect.runPromise(
      renderNewOrderEmail(emailData, branding, held ? paidUnderReviewCustomerNotice(number) : undefined),
    );
    const adminHtml = held
      ? await Effect.runPromise(
          renderNewOrderEmail(emailData, branding, paidOnHoldAdminNotice(number, orderRow.fulfillmentHoldNote)),
        )
      : customerHtml;
    const emailService = await getEmailService();
    const send = async (to: string, subject: string, html: string) => {
      const result = await Effect.runPromise(Effect.either(emailService.sendEmail(to, subject, html)));
      if (Either.isLeft(result)) {
        console.error(`[PaymentAttempt] Email to ${to} failed for order ${orderId}:`, result.left);
      }
    };

    await send(
      orderRow.customerEmail,
      held
        ? `${branding.storeName} — Payment received, order ${number} under review`
        : `${branding.storeName} Order Confirmation`,
      customerHtml,
    );
    const admins = await db.select({ email: user.email }).from(user).where(eq(user.role, "admin")).execute();
    for (const admin of admins) {
      await send(
        admin.email,
        held
          ? `PAID ORDER ON HOLD ${number} — stock issue, DO NOT PREPARE (manual review)`
          : "New Order Received",
        adminHtml,
      );
    }
  } catch (error) {
    console.error(`[PaymentAttempt] Order emails failed for ${orderId}:`, error);
  }

  // Cart conversion — now that a real, paid order exists.
  if (claimed.cartSessionToken) {
    await markCartConverted(claimed.cartSessionToken, orderId);
  }

  // Fulfillment — never for a held order (dispatch refuses it as well).
  if (!held && isBostaEnabled()) {
    try {
      const outcome = await dispatchOrderToBosta(db, orderId, { trigger: "payment_confirmed" });
      if (outcome.status !== "sent") {
        console.warn(`[PaymentAttempt] Bosta not dispatched for ${orderId}: ${outcome.reason}`);
      }
    } catch (error) {
      console.error(`[PaymentAttempt] Bosta dispatch failed for ${orderId}:`, error);
    }
  }

  return true;
}

// ─── Reconciliation ─────────────────────────────────────────────────────────

/**
 * Retry every paid attempt that has no order yet, and run effects nobody
 * claimed. Payment truth is already stored, so no provider call is needed.
 */
export async function reconcilePaidAttempts(db: DatabaseClient): Promise<{ checked: number }> {
  const rows = await db
    .select({ id: paymentAttempt.id })
    .from(paymentAttempt)
    .where(
      or(
        eq(paymentAttempt.status, "paid_pending_materialization"),
        and(eq(paymentAttempt.status, "materialized"), isNull(paymentAttempt.effectsClaimedAt)),
      ),
    )
    .limit(50)
    .execute();

  for (const row of rows) {
    await finalizePaidAttempt(db, row.id, null);
  }
  return { checked: rows.length };
}
