import { db } from "#root/shared/database/drizzle/db";
import { isFawaterakConfigured } from "#root/shared/config/payment";
import { reconcilePaidAttempts, reconcilePendingAttempts } from "./service";

/**
 * Payment safety net, every 5 minutes (a retry cadence, not an expiry):
 *
 *  A. Paid-but-no-order retry — attempts in paid_pending_materialization
 *     (and materialized attempts whose effects nobody claimed). Payment truth
 *     is already stored, so no provider call.
 *  B. Pending provider reconciliation — unpaid attempts due for a check are
 *     asked about at Fawaterak (bounded batch, per-attempt backoff, leased so
 *     instances don't overlap). A verified payment goes through the same
 *     finalizer as the webhook, so a lost webhook + absent customer still
 *     becomes an order. Nothing is ever expired for being old.
 */
const RECONCILE_INTERVAL_MS = 5 * 60_000;

export function startPaymentReconciliationWorker(): { stop: () => void } {
  let running = false;
  const run = async () => {
    if (running || !process.env.DATABASE_URL) return;
    running = true;
    try {
      const client = db();
      const { checked } = await reconcilePaidAttempts(client);
      if (checked > 0) {
        console.info(`[PaymentReconcile] Retried ${checked} paid attempt(s)`);
      }
      if (isFawaterakConfigured()) {
        const pending = await reconcilePendingAttempts(client);
        if (pending.checked > 0) {
          console.info(
            `[PaymentReconcile] Checked ${pending.checked} unpaid attempt(s) with Fawaterak: ${pending.finalized} paid, ${pending.closed} closed by provider, ${pending.errors} error(s)`,
          );
        }
      }
    } catch (error) {
      console.error("[PaymentReconcile] Sweep failed:", error);
    } finally {
      running = false;
    }
  };

  const intervalId = setInterval(() => void run(), RECONCILE_INTERVAL_MS);
  intervalId.unref?.();
  void run();
  return { stop: () => clearInterval(intervalId) };
}
