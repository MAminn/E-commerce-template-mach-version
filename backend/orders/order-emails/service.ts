/**
 * Transactional order emails — the customer confirmation and the store's
 * new-order notification — through a durable outbox.
 *
 * Before: checkout rendered and sent both emails inline after the order
 * committed, discarded the send result (sendEmail never fails its Effect, so
 * the surrounding try/catch was dead code), never retried, and recorded
 * nothing. A failed or skipped send left no trace anywhere except a console
 * line.
 *
 * Now:
 *   1. The order's own transaction (COD in createOrder, online in payment
 *      materialization) writes one `scheduled_email` row per recipient, in a
 *      SAVEPOINT — so the email is queued if and only if the order commits,
 *      and a queueing problem can never roll back a placed/paid order. The
 *      unique dedupe key (`order_confirmation:<orderId>`) means repeated
 *      webhooks, polls, retries and concurrent workers produce at most one
 *      row — one email — per recipient.
 *   2. The email worker (backend/email-automations/worker.ts) claims rows
 *      with FOR UPDATE SKIP LOCKED, loads the order FRESH, renders it here,
 *      and sends with a stable Message-ID. Success is recorded only when the
 *      SMTP server accepted the recipient (its Message-ID and reply are
 *      stored). Failures retry with backoff, then end in an explicit
 *      "failed" state. Rows orphaned by a restart are re-queued.
 *   3. Each customer-row outcome is written to the order's activity log:
 *      confirmation_email_queued / _sent (provider accepted) / _failed.
 *
 * These are NOT marketing: no master switch, no automation test mode, no
 * unsubscribe check, no List-Unsubscribe. Order lifecycle rule: a COD order
 * is confirmed when placed; an online order only once its payment is
 * verified paid (re-checked at send time).
 */

import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { render } from "@react-email/components";
import { z } from "zod";
import { sharedDb as db, type DatabaseClient } from "#root/shared/database/drizzle/db";
import {
  order,
  orderItem,
  orderLog,
  promoCode,
  user,
  type ScheduledEmailRow,
} from "#root/shared/database/drizzle/schema";
import {
  enqueueTransactionalEmail,
  type TransactionalEmailType,
} from "#root/backend/email-automations/queue/service";
import {
  registerEmailRenderer,
  type RenderedScheduledEmail,
} from "#root/backend/email-automations/render";
import { logOrderEvent } from "#root/backend/orders/order-log";
import { getEmailBranding, type EmailBranding } from "#root/backend/emails/branding";
import {
  OrderConfirmationEmailTemplate,
  type OrderEmailLine,
} from "#root/backend/emails/minimal/order-confirmation";
import {
  paidOnHoldAdminNotice,
  paidUnderReviewCustomerNotice,
} from "#root/backend/emails/order-email-notice";
import { displayOrderNumber } from "#root/shared/orders/order-reference";
import { maskEmailAddress } from "#root/shared/email/service";

export const ORDER_CONFIRMATION = "order_confirmation" as const satisfies TransactionalEmailType;
export const ORDER_ADMIN_NOTIFICATION = "order_admin_notification" as const satisfies TransactionalEmailType;

export const confirmationDedupeKey = (orderId: string) => `order_confirmation:${orderId}`;
export const adminNotificationDedupeKey = (orderId: string, email: string) =>
  `order_admin_notification:${orderId}:${email.trim().toLowerCase()}`;

type DbOrTx = DatabaseClient | Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

const emailSchema = z.string().trim().email();
export const isUsableEmailAddress = (value: string | null | undefined): value is string =>
  !!value && emailSchema.safeParse(value).success;

// ─── Lifecycle rule ─────────────────────────────────────────────────────────

/**
 * Is this order at the point where its confirmation must go out? COD: as
 * soon as it exists. Any online method: only once payment is verified paid —
 * never for pending / failed / abandoned checkouts.
 */
export function orderEmailEligibility(o: {
  paymentMethod: string | null;
  paymentStatus: string | null;
}): { eligible: true } | { eligible: false; reason: string } {
  if ((o.paymentMethod ?? "cod") === "cod") return { eligible: true };
  if (o.paymentStatus === "paid") return { eligible: true };
  return {
    eligible: false,
    reason: `online payment (${o.paymentMethod}) is ${o.paymentStatus ?? "unknown"}, not paid — the confirmation is sent only after payment is confirmed`,
  };
}

// ─── Queueing (inside the order's transaction) ─────────────────────────────

export interface QueueOrderEmailsResult {
  /** Not queued because the order isn't confirmable yet (online, unpaid). */
  skippedReason?: string;
  customerQueued: boolean;
  /** Customer row already existed (a repeat call — nothing new). */
  customerAlreadyQueued: boolean;
  /** Why no customer row was written, when one wasn't. */
  customerNotQueuedReason?: string;
  adminQueued: number;
}

/**
 * Writes the order's email rows on `client` (pass the order's transaction).
 * Idempotent: rows are keyed per order + recipient and existing rows are
 * never touched. THROWS on database errors — use queueOrderPlacedEmailsInTx
 * from inside an order transaction.
 */
export async function queueOrderPlacedEmails(
  client: DbOrTx,
  orderId: string,
): Promise<QueueOrderEmailsResult> {
  const [row] = await client
    .select({
      id: order.id,
      reference: order.reference,
      customerEmail: order.customerEmail,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
    })
    .from(order)
    .where(eq(order.id, orderId))
    .limit(1);
  if (!row) throw new Error(`Order ${orderId} not found while queueing its emails`);

  const eligibility = orderEmailEligibility(row);
  if (!eligibility.eligible) {
    return { skippedReason: eligibility.reason, customerQueued: false, customerAlreadyQueued: false, adminQueued: 0 };
  }

  const result: QueueOrderEmailsResult = { customerQueued: false, customerAlreadyQueued: false, adminQueued: 0 };
  const number = displayOrderNumber(row);

  if (isUsableEmailAddress(row.customerEmail)) {
    const inserted = await enqueueTransactionalEmail(client, {
      type: ORDER_CONFIRMATION,
      recipientEmail: row.customerEmail.trim(),
      payload: { orderId },
      dedupeKey: confirmationDedupeKey(orderId),
    });
    result.customerQueued = inserted;
    result.customerAlreadyQueued = !inserted;
    if (inserted) {
      await client.insert(orderLog).values({
        orderId,
        action: "confirmation_email_queued",
        note: `Order confirmation email for ${number} queued for ${maskEmailAddress(row.customerEmail)}`,
      });
    }
  } else {
    // createOrderSchema requires a valid email, so this is a data problem
    // (legacy row, manual edit) — recorded, never silently dropped.
    result.customerNotQueuedReason = row.customerEmail
      ? "the customer email address on the order is not a valid address"
      : "the order has no customer email address";
    await client.insert(orderLog).values({
      orderId,
      action: "confirmation_email_failed",
      note: `Order confirmation email for ${number} not queued: ${result.customerNotQueuedReason}.`,
    });
  }

  const admins = await client.select({ email: user.email }).from(user).where(eq(user.role, "admin"));
  const seen = new Set<string>();
  for (const admin of admins) {
    const email = admin.email?.trim();
    if (!isUsableEmailAddress(email) || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    const inserted = await enqueueTransactionalEmail(client, {
      type: ORDER_ADMIN_NOTIFICATION,
      recipientEmail: email,
      payload: { orderId },
      dedupeKey: adminNotificationDedupeKey(orderId, email),
    });
    if (inserted) result.adminQueued++;
  }
  return result;
}

/**
 * The call to make from inside an order transaction: runs in a SAVEPOINT so
 * a failure (e.g. migration 0064 not applied yet) rolls back only the email
 * rows, never the order. Never throws. On failure the caller must, after its
 * transaction commits, call ensureOrderEmailsQueued.
 */
export async function queueOrderPlacedEmailsInTx(
  tx: Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0],
  orderId: string,
): Promise<{ ok: true; result: QueueOrderEmailsResult } | { ok: false; error: string }> {
  try {
    const result = await tx.transaction((savepoint) => queueOrderPlacedEmails(savepoint, orderId));
    return { ok: true, result };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[OrderEmails] Could not queue emails for order ${orderId} in its transaction: ${error}`);
    return { ok: false, error };
  }
}

/**
 * Post-commit fallback for a failed in-transaction queueing, and the
 * idempotent safety net for paths that may predate this outbox (e.g. an
 * online order materialized before deploy whose effects run after it).
 * Never throws; a failure is recorded on the order's activity log so it is
 * visible to the store instead of silently lost.
 */
export async function ensureOrderEmailsQueued(orderId: string): Promise<boolean> {
  try {
    await db().transaction((tx) => queueOrderPlacedEmails(tx, orderId));
    return true;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[OrderEmails] Could not queue emails for order ${orderId}: ${error}`);
    await logOrderEvent({
      orderId,
      action: "confirmation_email_failed",
      note: `Order confirmation email could not be queued and was NOT sent: ${error.slice(0, 300)}`,
    });
    return false;
  }
}

// ─── Worker kick ────────────────────────────────────────────────────────────

let workerKick: () => void = () => {};

/** Called by the email worker on start-up so a freshly queued order email goes out now, not at the next poll. */
export function setOrderEmailWorkerKick(kick: () => void): void {
  workerKick = kick;
}

/** Ask the worker to run now. Safe to call anywhere; never throws. */
export function kickOrderEmailWorker(): void {
  try {
    workerKick();
  } catch (err) {
    console.error("[OrderEmails] Worker kick failed (the next poll will send):", err);
  }
}

// ─── Outcome → order activity log ───────────────────────────────────────────

export type OrderEmailOutcome =
  | { status: "sent"; messageId?: string; response?: string }
  | { status: "failed"; error: string; attempts: number; willRetry: boolean }
  | { status: "cancelled"; reason: string };

export function readOrderId(row: Pick<ScheduledEmailRow, "payload">): string | null {
  const payload = row.payload as Record<string, unknown> | null;
  const id = payload?.orderId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Records one attempt's outcome. Customer confirmations go to the order's
 * activity log; store notifications only to the server log (masked).
 * Never throws.
 */
export async function recordOrderEmailOutcome(
  row: ScheduledEmailRow,
  outcome: OrderEmailOutcome,
): Promise<void> {
  const orderId = readOrderId(row);
  if (!orderId) return;
  const to = maskEmailAddress(row.recipientEmail);

  if (row.automationType !== ORDER_CONFIRMATION) {
    if (outcome.status !== "sent") {
      console.warn(
        `[OrderEmails] Store notification for order ${orderId} to ${to} ${outcome.status}: ${
          outcome.status === "failed" ? outcome.error : outcome.reason
        }`,
      );
    }
    return;
  }

  if (outcome.status === "sent") {
    const reply = outcome.response ? ` — SMTP reply: ${outcome.response.slice(0, 160)}` : "";
    await logOrderEvent({
      orderId,
      action: "confirmation_email_sent",
      note: `Order confirmation email accepted by the mail server for ${to}${
        outcome.messageId ? ` (Message-ID ${outcome.messageId})` : ""
      }${reply}. Acceptance is not proof of inbox delivery.`,
    });
  } else if (outcome.status === "failed") {
    await logOrderEvent({
      orderId,
      action: "confirmation_email_failed",
      note: `Order confirmation email to ${to} failed (attempt ${outcome.attempts}): ${outcome.error.slice(0, 300)}${
        outcome.willRetry ? " — will retry automatically" : " — retries exhausted, NOT sent"
      }`,
    });
  } else {
    await logOrderEvent({
      orderId,
      action: "confirmation_email_failed",
      note: `Order confirmation email to ${to} not sent: ${outcome.reason}`,
    });
  }
}

// ─── Loading + rendering ────────────────────────────────────────────────────

const money = (value: string | null | undefined) => {
  const n = value === null || value === undefined ? 0 : Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

const PAYMENT_LABELS: Record<string, string> = {
  cod: "Cash on delivery",
  fawaterak: "Paid online",
  stripe: "Paid online",
  paymob: "Paid online",
};

function formatOrderDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Africa/Cairo",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Domain for the stable Message-ID: the From domain the transport will use. */
function messageIdDomain(): string {
  const from = (process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER || "").trim();
  const at = from.lastIndexOf("@");
  return at > 0 ? from.slice(at + 1).toLowerCase() : "localhost";
}

export function orderEmailMessageId(row: Pick<ScheduledEmailRow, "automationType" | "recipientEmail">, orderId: string): string {
  const kind = row.automationType === ORDER_CONFIRMATION ? "order-confirmation" : "order-notification";
  const recipient =
    row.automationType === ORDER_CONFIRMATION
      ? ""
      : `.${createHash("sha256").update(row.recipientEmail.trim().toLowerCase()).digest("hex").slice(0, 12)}`;
  return `<${kind}.${orderId}${recipient}@${messageIdDomain()}>`;
}

export interface OrderEmailData {
  order: typeof order.$inferSelect;
  items: Array<typeof orderItem.$inferSelect>;
  promoCode: string | null;
}

export async function loadOrderEmailData(orderId: string): Promise<OrderEmailData | null> {
  const database = db();
  const [row] = await database.select().from(order).where(eq(order.id, orderId)).limit(1);
  if (!row) return null;
  const [items, promo] = await Promise.all([
    database
      .select()
      .from(orderItem)
      .where(eq(orderItem.orderId, orderId))
      .orderBy(asc(orderItem.isFreeGift), asc(orderItem.createdAt), asc(orderItem.id)),
    row.promoCodeId
      ? database
          .select({ code: promoCode.code })
          .from(promoCode)
          .where(and(eq(promoCode.id, row.promoCodeId)))
          .limit(1)
      : Promise.resolve([] as Array<{ code: string }>),
  ]);
  return { order: row, items, promoCode: promo[0]?.code ?? null };
}

export function buildOrderEmailLines(items: OrderEmailData["items"]): OrderEmailLine[] {
  return items.map((item) => {
    const quantity = item.quantity ?? 0;
    const list = money(item.price);
    const discounted = item.discountPrice !== null && item.discountPrice !== undefined ? money(item.discountPrice) : null;
    const unitPrice = item.isFreeGift ? 0 : discounted !== null && discounted > 0 ? discounted : list;
    return {
      name: item.name ?? "Item",
      quantity,
      unitPrice,
      listUnitPrice: !item.isFreeGift && list > unitPrice ? list : undefined,
      lineTotal: Math.round(unitPrice * quantity * 100) / 100,
      isFreeGift: !!item.isFreeGift,
    };
  });
}

/** Pure render of one order email — exported for tests. */
export async function renderOrderEmailHtml(
  data: OrderEmailData,
  branding: EmailBranding,
  audience: "customer" | "admin",
): Promise<{ subject: string; html: string }> {
  const o = data.order;
  const number = displayOrderNumber(o);
  const held = !!o.fulfillmentHold;
  const notice = held
    ? audience === "customer"
      ? paidUnderReviewCustomerNotice(number)
      : paidOnHoldAdminNotice(number, o.fulfillmentHoldNote)
    : undefined;
  const total = money(o.total);

  const html = await render(
    OrderConfirmationEmailTemplate({
      storeName: branding.storeName,
      logoUrl: branding.logoUrl,
      supportEmail: branding.supportEmail,
      websiteUrl: branding.websiteUrl,
      currency: branding.currency,
      orderNumber: number,
      orderDate: formatOrderDate(o.createdAt),
      paymentMethodLabel: PAYMENT_LABELS[o.paymentMethod] ?? "Paid online",
      items: buildOrderEmailLines(data.items),
      subTotal: money(o.subtotal),
      discount: money(o.discount),
      promoCode: data.promoCode ?? undefined,
      shippingFees: money(o.shipping),
      total,
      address: o.shippingAddress,
      city: o.shippingCity,
      state: o.shippingState ?? "",
      postalCode: o.shippingPostalCode ?? "",
      country: o.shippingCountry ?? "",
      customerName: o.customerName,
      customerEmail: o.customerEmail ?? "",
      customerPhone: o.customerPhone,
      notice,
      audience,
    }),
  );

  const subject =
    audience === "customer"
      ? held
        ? `${branding.storeName} — Payment received, order ${number} under review`
        : `${branding.storeName} — Order Confirmation ${number}`
      : held
        ? `PAID ORDER ON HOLD ${number} — stock issue, DO NOT PREPARE (manual review)`
        : `New order ${number} — ${total.toFixed(2)} ${branding.currency}`;
  return { subject, html };
}

/**
 * Branding is read from layout settings (several queries, each on a fresh
 * pool — see shared/database/drizzle/db.ts). An order produces one email per
 * recipient, so reuse it briefly: an admin's logo/name change shows up within
 * a minute.
 */
const BRANDING_TTL_MS = 60_000;
let brandingCache: { at: number; value: Promise<EmailBranding> } | null = null;
function getOrderEmailBranding(): Promise<EmailBranding> {
  if (!brandingCache || Date.now() - brandingCache.at > BRANDING_TTL_MS) {
    brandingCache = { at: Date.now(), value: getEmailBranding() };
  }
  return brandingCache.value;
}

async function renderQueuedOrderEmail(
  row: ScheduledEmailRow,
  audience: "customer" | "admin",
): Promise<RenderedScheduledEmail> {
  const orderId = readOrderId(row);
  if (!orderId) return { subject: "", html: "", skip: "queue row has no orderId" };
  if (!isUsableEmailAddress(row.recipientEmail)) {
    return { subject: "", html: "", skip: "recipient address is not a valid email address" };
  }
  const data = await loadOrderEmailData(orderId);
  // Thrown, not skipped: the worker retries, then records the failure.
  if (!data) throw new Error(`Order ${orderId} no longer exists`);

  const eligibility = orderEmailEligibility(data.order);
  if (!eligibility.eligible) return { subject: "", html: "", skip: eligibility.reason };
  if (data.order.status === "cancelled") {
    return { subject: "", html: "", skip: "the order was cancelled before its confirmation was sent" };
  }

  const branding = await getOrderEmailBranding();
  const { subject, html } = await renderOrderEmailHtml(data, branding, audience);
  return { subject, html, messageId: orderEmailMessageId(row, orderId) };
}

registerEmailRenderer(ORDER_CONFIRMATION, (row) => renderQueuedOrderEmail(row, "customer"));
registerEmailRenderer(ORDER_ADMIN_NOTIFICATION, (row) => renderQueuedOrderEmail(row, "admin"));
