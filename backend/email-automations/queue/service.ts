import { sharedDb as db, type DatabaseClient } from "#root/shared/database/drizzle/db";
import { scheduledEmail } from "#root/shared/database/drizzle/schema";
import { and, desc, eq, inArray, like, lt, lte, ne, sql } from "drizzle-orm";
import { getOrCreateSubscriptionToken } from "#root/backend/email-subscription/service";

export type EmailAutomationType =
  | "welcome"
  | "review_check"
  | "abandoned_cart"
  | "abandoned_browse"
  | "win_back"
  | "new_drops"
  | "flash_offer"
  | "retention";

/**
 * Transactional emails share the queue's durable rows, claim locking, dedupe
 * and retries, but none of the marketing rules (master switch, test mode,
 * unsubscribe, List-Unsubscribe). Kept out of EmailAutomationType so the
 * marketing template/broadcast code never sees them.
 */
export const TRANSACTIONAL_EMAIL_TYPES = ["order_confirmation", "order_admin_notification"] as const;
export type TransactionalEmailType = (typeof TRANSACTIONAL_EMAIL_TYPES)[number];

/** Every value the scheduled_email.automation_type column can hold. */
export type ScheduledEmailType = EmailAutomationType | TransactionalEmailType;

export function isTransactionalEmailType(type: string): type is TransactionalEmailType {
  return (TRANSACTIONAL_EMAIL_TYPES as readonly string[]).includes(type);
}

export type ScheduledEmailLocale = "en" | "ar";

export interface EnqueueScheduledEmailParams {
  automationType: EmailAutomationType;
  recipientEmail: string;
  locale?: ScheduledEmailLocale;
  /** Arbitrary data the template needs to render (order items, product, discount code, campaign id, ...). */
  payload: Record<string, unknown>;
  scheduledFor: Date;
  /**
   * Identifies the logical send (e.g. `abandoned_cart:step1:{cartId}`,
   * `broadcast:{campaignId}:{email}`). Enqueuing the same dedupeKey again
   * updates the still-pending row instead of creating a duplicate, and is a
   * silent no-op if that row already sent/is sending/was cancelled.
   */
  dedupeKey: string;
}

/**
 * Schedules a marketing-automation email. Never throws — a queueing failure
 * must not break the checkout/signup/order flow that triggered it. Callers
 * fire-and-forget this, matching backend/orders/order-log.ts's convention.
 */
export async function enqueueScheduledEmail(
  params: EnqueueScheduledEmailParams,
): Promise<void> {
  try {
    // Ensure a subscription row (and unsubscribe token) exists as soon as
    // something is queued — not deferred to send time — so the row is
    // visible/manageable immediately and never racing the worker for it.
    await getOrCreateSubscriptionToken(params.recipientEmail);

    await db()
      .insert(scheduledEmail)
      .values({
        automationType: params.automationType,
        recipientEmail: params.recipientEmail,
        locale: params.locale ?? "en",
        payload: params.payload,
        scheduledFor: params.scheduledFor,
        dedupeKey: params.dedupeKey,
      })
      .onConflictDoUpdate({
        target: scheduledEmail.dedupeKey,
        set: {
          payload: params.payload,
          scheduledFor: params.scheduledFor,
          locale: params.locale ?? "en",
          updatedAt: new Date(),
        },
        // Only refresh a row that hasn't gone out yet. If it already
        // sent/is sending/was cancelled, leave it alone — re-triggering the
        // same event later (e.g. adding another item to an already-tracked
        // abandoned cart) must not resurrect or resend a completed send.
        setWhere: eq(scheduledEmail.status, "pending"),
      });
  } catch (err) {
    console.error(
      `[EmailQueue] Failed to enqueue "${params.automationType}" for ${params.recipientEmail} (${params.dedupeKey}):`,
      err,
    );
  }
}

/**
 * Cancels every still-pending row whose dedupeKey starts with the given
 * prefix — e.g. cancel every remaining abandoned-cart step for a cart that
 * just converted to an order: `cancelScheduledEmailsByPrefix("abandoned_cart:step")`
 * combined with the cart id, or a single exact dedupeKey for one row.
 * Never throws, for the same reason as enqueueScheduledEmail.
 */
export async function cancelScheduledEmailsByPrefix(
  dedupeKeyPrefix: string,
): Promise<void> {
  try {
    await db()
      .update(scheduledEmail)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(scheduledEmail.status, "pending"),
          like(scheduledEmail.dedupeKey, `${dedupeKeyPrefix}%`),
        ),
      );
  } catch (err) {
    console.error(
      `[EmailQueue] Failed to cancel rows matching "${dedupeKeyPrefix}":`,
      err,
    );
  }
}

type DbOrTx = DatabaseClient | Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

/**
 * Queues one transactional email on the given client — pass the caller's
 * transaction so the row commits (or rolls back) together with the business
 * row it describes. Insert-only: an existing row with the same dedupeKey is
 * left exactly as it is (pending, sending, sent or failed), so however many
 * times this runs for one logical send, at most one row — and one email —
 * exists. Returns true when this call created the row.
 *
 * Unlike enqueueScheduledEmail this THROWS: the caller decides whether a
 * queueing failure is fatal, and must record it if not. It also never
 * creates a marketing subscription row — an order is not an opt-in.
 */
export async function enqueueTransactionalEmail(
  client: DbOrTx,
  params: {
    type: TransactionalEmailType;
    recipientEmail: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
    scheduledFor?: Date;
  },
): Promise<boolean> {
  const inserted = await client
    .insert(scheduledEmail)
    .values({
      automationType: params.type,
      recipientEmail: params.recipientEmail,
      locale: "en",
      payload: params.payload,
      scheduledFor: params.scheduledFor ?? new Date(),
      dedupeKey: params.dedupeKey,
    })
    .onConflictDoNothing({ target: scheduledEmail.dedupeKey })
    .returning({ id: scheduledEmail.id });
  return inserted.length > 0;
}

// ─── Worker-internal operations ─────────────────────────────────────────────
// Unlike the enqueue/cancel helpers above (fire-and-forget side effects of
// unrelated flows), these ARE the core logic of the worker loop — they
// intentionally throw on failure so the worker's own try/catch can log and
// back off, instead of silently swallowing a real DB problem.

const MAX_ATTEMPTS = 5;

/**
 * Retry policy for transactional rows: bounded, with backoff, so a provider
 * outage (rate limit, daily sending quota, DNS) is ridden out over about a
 * day instead of burning every attempt in five minutes. Delay index =
 * attempts already made (1 → wait 1 min before the 2nd attempt, ...).
 */
export const TRANSACTIONAL_MAX_ATTEMPTS = 8;
export const TRANSACTIONAL_RETRY_DELAYS_MS = [
  60_000, // 1 min
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
] as const;

export function transactionalRetryDelayMs(attemptsMade: number): number {
  const i = Math.max(0, Math.min(attemptsMade - 1, TRANSACTIONAL_RETRY_DELAYS_MS.length - 1));
  return TRANSACTIONAL_RETRY_DELAYS_MS[i] ?? 60_000;
}

/**
 * Atomically claims up to `limit` due rows and marks them "sending".
 * Uses SELECT ... FOR UPDATE SKIP LOCKED inside a transaction so multiple
 * app instances (or overlapping worker ticks) never claim the same row.
 * `onlyTypes` restricts the claim (e.g. transactional rows while marketing
 * automations are switched off). Transactional rows are claimed first.
 */
export async function claimDueScheduledEmails(
  limit: number,
  onlyTypes?: readonly ScheduledEmailType[],
): Promise<Array<typeof scheduledEmail.$inferSelect>> {
  return db().transaction(async (tx) => {
    const now = new Date();
    const due = await tx
      .select({ id: scheduledEmail.id })
      .from(scheduledEmail)
      .where(
        and(
          eq(scheduledEmail.status, "pending"),
          lte(scheduledEmail.scheduledFor, now),
          onlyTypes ? inArray(scheduledEmail.automationType, [...onlyTypes]) : undefined,
        ),
      )
      .orderBy(
        sql`case when ${scheduledEmail.automationType} in ('order_confirmation', 'order_admin_notification') then 0 else 1 end`,
        scheduledEmail.scheduledFor,
      )
      .limit(limit)
      .for("update", { skipLocked: true });

    if (due.length === 0) return [];

    const ids = due.map((row) => row.id);
    return tx
      .update(scheduledEmail)
      .set({ status: "sending", lastAttemptAt: now, updatedAt: now })
      .where(and(inArray(scheduledEmail.id, ids), eq(scheduledEmail.status, "pending")))
      .returning();
  });
}

/**
 * Marks a claimed row sent. `evidence` is the provider's acceptance (Message-ID
 * and final SMTP reply) — acceptance, not inbox delivery. Deliberately NOT
 * guarded on status: an acceptance that arrives after the row was re-queued
 * as stale must still win, or the retry would send a duplicate.
 */
export async function markScheduledEmailSent(
  id: string,
  evidence?: { messageId?: string; response?: string },
): Promise<void> {
  const now = new Date();
  await db()
    .update(scheduledEmail)
    .set({
      status: "sent",
      sentAt: now,
      updatedAt: now,
      lastError: null,
      providerMessageId: evidence?.messageId ?? null,
      providerResponse: evidence?.response ?? null,
    })
    .where(eq(scheduledEmail.id, id));
}

/**
 * Records a failed send attempt. Retries (back to "pending") until the
 * attempt limit, then marks permanently "failed". Marketing rows keep the
 * original policy (5 attempts, next tick); pass `policy` for transactional
 * rows (more attempts, backoff via scheduled_for).
 */
export async function markScheduledEmailFailed(
  id: string,
  attempts: number,
  error: string,
  policy?: { maxAttempts: number; retryDelayMs: (attemptsMade: number) => number },
): Promise<{ attempts: number; willRetry: boolean; recorded: boolean }> {
  const nextAttempts = attempts + 1;
  const maxAttempts = policy?.maxAttempts ?? MAX_ATTEMPTS;
  const willRetry = nextAttempts < maxAttempts;
  const now = new Date();
  const updated = await db()
    .update(scheduledEmail)
    .set({
      status: willRetry ? "pending" : "failed",
      attempts: nextAttempts,
      lastError: error.slice(0, 1000),
      updatedAt: now,
      ...(willRetry && policy
        ? { scheduledFor: new Date(now.getTime() + policy.retryDelayMs(nextAttempts)) }
        : {}),
    })
    // Never downgrade a row that is already "sent" (a re-claimed copy of a
    // stale row succeeded first) — flipping it back to pending would send a
    // duplicate. `recorded: false` tells the caller nothing changed.
    .where(and(eq(scheduledEmail.id, id), ne(scheduledEmail.status, "sent")))
    .returning({ id: scheduledEmail.id });
  return { attempts: nextAttempts, willRetry, recorded: updated.length > 0 };
}

/**
 * Rows of the given types stuck in "sending" since before `staleMs` ago were
 * orphaned by a crash or restart mid-send. Each goes back to "pending" and
 * the interrupted try counts as an attempt (so a row that crashes the
 * process cannot loop forever); past the limit it is marked "failed".
 * Whether the interrupted send reached the provider is unknowable — the
 * retry reuses the same Message-ID so a duplicate is recognisable.
 */
export async function requeueStaleSendingEmails(
  types: readonly ScheduledEmailType[],
  staleMs: number,
  maxAttempts: number = TRANSACTIONAL_MAX_ATTEMPTS,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs);
  const rows = await db()
    .update(scheduledEmail)
    .set({
      status: sql`case when ${scheduledEmail.attempts} + 1 >= ${maxAttempts} then 'failed'::scheduled_email_status else 'pending'::scheduled_email_status end`,
      attempts: sql`${scheduledEmail.attempts} + 1`,
      lastError: "Interrupted mid-send (process restart or crash) — provider outcome unknown",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scheduledEmail.status, "sending"),
        inArray(scheduledEmail.automationType, [...types]),
        lt(sql`coalesce(${scheduledEmail.lastAttemptAt}, ${scheduledEmail.updatedAt})`, cutoff),
      ),
    )
    .returning({ id: scheduledEmail.id });
  return rows.length;
}

/**
 * Most-recently-touched rows across every automation type, for the admin
 * queue-activity view — lets the admin confirm a triggered send actually
 * went out (or see why it didn't: cancelled/failed + lastError) without a
 * direct DB query.
 */
export async function listRecentScheduledEmails(
  limit = 50,
): Promise<Array<typeof scheduledEmail.$inferSelect>> {
  return db()
    .select()
    .from(scheduledEmail)
    .orderBy(desc(scheduledEmail.updatedAt))
    .limit(limit);
}

/** Marks a claimed row cancelled without sending — used when a send-time check (e.g. unsubscribe, test mode) says it shouldn't go out. */
export async function markScheduledEmailCancelled(
  id: string,
  reason?: string,
): Promise<void> {
  await db()
    .update(scheduledEmail)
    .set({
      status: "cancelled",
      ...(reason ? { lastError: reason } : {}),
      updatedAt: new Date(),
    })
    .where(eq(scheduledEmail.id, id));
}
