/**
 * The one place an order is sent to Bosta.
 *
 * Used by: COD checkout auto-send, paid-online auto-send (confirm-online-
 * payment) and the admin "Send to Bosta" action. All three share the same
 * eligibility rules, the same canonical input builder and the same
 * duplicate protection:
 *
 *   eligible? → atomically claim `bostaSyncStatus = pending` (conditional
 *   UPDATE … RETURNING) → call Bosta → sent | failed
 *
 * A concurrent caller loses the claim and never reaches the network. Bosta
 * additionally receives a deterministic `uniqueBusinessReference` (the order
 * id, or `<orderId>:resend:<oldTracking>` for a resend after termination) so
 * a duplicate request that slips through is rejected on their side too.
 * `businessReference` is always the order id — that is what webhooks map on.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { DatabaseClient } from "#root/shared/database/drizzle/db";
import { order, orderItem } from "#root/shared/database/drizzle/schema";
import { isOnlinePaymentMethod } from "#root/shared/config/payment-methods";
import { logOrderEvent } from "#root/backend/orders/order-log";
import { createBostaDelivery, isBostaEnabled } from "./service";
import { persistBostaSyncStatus } from "./sync-status";
import { buildBostaInputFromOrder } from "./order-input";

export type BostaDispatchTrigger = "checkout_cod" | "payment_confirmed" | "manual";

export interface BostaDispatchOptions {
  trigger: BostaDispatchTrigger;
  /** Admin email for the audit log (manual sends). */
  actor?: string | null;
  /**
   * Explicit opt-in to create a new delivery for an order whose previous
   * delivery was terminated. Never set by automatic paths.
   */
  resendAfterCancel?: boolean;
}

export type BostaDispatchResult =
  | { status: "sent"; trackingNumber: string; deliveryId: string }
  | { status: "skipped"; code: "not_configured"; reason: string }
  | {
      status: "blocked";
      code: "not_found" | "payment_not_confirmed" | "already_sent" | "in_flight" | "cancelled";
      reason: string;
    }
  | { status: "failed"; code: "validation" | "api"; reason: string };

/** A "pending" claim older than this is treated as abandoned and may be retaken. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

function triggerLabel(trigger: BostaDispatchTrigger, actor?: string | null): string {
  switch (trigger) {
    case "checkout_cod":
      return "Auto-sent to Bosta at checkout (COD)";
    case "payment_confirmed":
      return "Auto-sent to Bosta after payment was confirmed paid";
    case "manual":
      return `Manual "Send to Bosta"${actor ? ` by ${actor}` : ""}`;
  }
}

export async function dispatchOrderToBosta(
  db: DatabaseClient,
  orderId: string,
  opts: BostaDispatchOptions,
): Promise<BostaDispatchResult> {
  if (!isBostaEnabled()) {
    return { status: "skipped", code: "not_configured", reason: "Bosta is not configured" };
  }

  const [row] = await db.select().from(order).where(eq(order.id, orderId)).limit(1).execute();
  if (!row) {
    return { status: "blocked", code: "not_found", reason: "Order not found" };
  }

  // Payment gate — an online order only ships once its payment is confirmed.
  if (isOnlinePaymentMethod(row.paymentMethod) && row.paymentStatus !== "paid") {
    return {
      status: "blocked",
      code: "payment_not_confirmed",
      reason: `Cannot send to Bosta — this order's ${row.paymentMethod} payment is "${row.paymentStatus}", not confirmed paid.`,
    };
  }

  if (row.bostaSyncStatus === "cancelled" && !opts.resendAfterCancel) {
    return {
      status: "blocked",
      code: "cancelled",
      reason: `This order's Bosta delivery${row.bostaTrackingNumber ? ` (${row.bostaTrackingNumber})` : ""} was terminated. Use "Send again" to deliberately create a new delivery.`,
    };
  }

  const alreadySent =
    row.bostaSyncStatus === "sent" ||
    (row.bostaSyncStatus !== "cancelled" &&
      row.bostaSyncStatus !== "pending" &&
      (!!row.bostaDeliveryId || !!row.bostaTrackingNumber));
  if (alreadySent) {
    return {
      status: "blocked",
      code: "already_sent",
      reason: `This order already has a Bosta delivery${row.bostaTrackingNumber ? ` (${row.bostaTrackingNumber})` : ""}.`,
    };
  }

  // ── Atomic claim ──────────────────────────────────────────────────────────
  // Only one caller can move the row into "pending"; everyone else sees an
  // empty RETURNING and stops before any network call.
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS);
  const claimable = or(
    isNull(order.bostaSyncStatus),
    eq(order.bostaSyncStatus, "skipped"),
    eq(order.bostaSyncStatus, "failed"),
    and(
      eq(order.bostaSyncStatus, "pending"),
      or(isNull(order.bostaSyncAttemptedAt), sql`${order.bostaSyncAttemptedAt} < ${staleBefore}`),
    ),
    ...(opts.resendAfterCancel ? [eq(order.bostaSyncStatus, "cancelled")] : []),
  );

  const claimed = await db
    .update(order)
    .set({
      bostaSyncStatus: "pending",
      bostaSyncError: null,
      bostaSyncAttemptedAt: now,
      updatedAt: now,
    })
    .where(and(eq(order.id, orderId), claimable))
    .returning({ id: order.id })
    .execute();

  if (!claimed || claimed.length === 0) {
    return {
      status: "blocked",
      code: "in_flight",
      reason: "A Bosta send for this order is already in progress.",
    };
  }

  const label = triggerLabel(opts.trigger, opts.actor);

  // A tracking number on a row we are allowed to ship again can only belong
  // to a terminated delivery (a live one is blocked above). It seeds the
  // Bosta-side dedupe key: `<orderId>:resend:<oldTracking>` — stable across
  // retries of the same resend, different after another termination.
  const previousTrackingNumber = row.bostaTrackingNumber?.trim() || null;
  const isResend = !!previousTrackingNumber;

  const fail = async (code: "validation" | "api", reason: string): Promise<BostaDispatchResult> => {
    if (isResend) {
      // The terminated delivery is still the order's last one; keep the row
      // in "cancelled" (with the error) so the next attempt is again an
      // explicit resend and reuses the same dedupe key.
      const at = new Date();
      await db
        .update(order)
        .set({ bostaSyncStatus: "cancelled", bostaSyncError: reason, bostaSyncAttemptedAt: at, updatedAt: at })
        .where(eq(order.id, orderId))
        .execute();
    } else {
      await persistBostaSyncStatus(orderId, "failed", { error: reason, client: db });
    }
    await logOrderEvent({
      orderId,
      action: "bosta_send_failed",
      note: `${label}: ${reason}`,
    });
    return { status: "failed", code, reason };
  };

  // ── Build the canonical input from trusted DB data ────────────────────────
  const items = await db
    .select({ name: orderItem.name, quantity: orderItem.quantity })
    .from(orderItem)
    .where(eq(orderItem.orderId, orderId))
    .execute();

  const built = buildBostaInputFromOrder(row, items, { previousTrackingNumber });
  if (!built.ok) return fail("validation", built.reason);

  // ── Call Bosta ────────────────────────────────────────────────────────────
  let outcome: Awaited<ReturnType<typeof createBostaDelivery>>;
  try {
    outcome = await createBostaDelivery(built.input);
  } catch (err) {
    return fail("api", err instanceof Error ? err.message : String(err));
  }

  if (!outcome) {
    // Key disappeared between the enabled-check and the call — release the claim.
    if (isResend) {
      await fail("api", "Bosta is not configured");
    } else {
      await persistBostaSyncStatus(orderId, "skipped", {
        error: "Bosta is not configured",
        client: db,
      });
    }
    return { status: "skipped", code: "not_configured", reason: "Bosta is not configured" };
  }

  if (!outcome.success) return fail(outcome.kind, outcome.error);

  await persistBostaSyncStatus(orderId, "sent", { delivery: outcome.result, client: db });
  await logOrderEvent({
    orderId,
    action: "bosta_sent",
    note: `${label} — tracking ${outcome.result.trackingNumber}`,
  });

  return {
    status: "sent",
    trackingNumber: outcome.result.trackingNumber,
    deliveryId: outcome.result.deliveryId,
  };
}
