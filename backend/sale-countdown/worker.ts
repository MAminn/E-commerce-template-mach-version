import { db } from "#root/shared/database/drizzle/db";
import { isKnownDeadlinePassed, noteSaleCountdownState } from "./deadline-cache";
import { finalizeDueSaleCountdown, readCountdown } from "./service";

/**
 * Keeps the sale countdown's expiry on time without any traffic, and lets
 * every request trigger it the moment the deadline passes.
 *
 * Every second: if this process knows the deadline has passed, finalize.
 * Every REFRESH_MS: re-read the deadline from the database, so a change made
 * by another instance (a rolling deploy runs two) is picked up. The cache only
 * saves queries — checkout never relies on it (see assertNoPendingSaleExpiry).
 */
const TICK_MS = 1000;
const REFRESH_MS = 10_000;

let inflight: Promise<void> | null = null;
let lastErrorLog = 0;

/** Failures are retried (next tick / next request); log at most once a
 * minute so a database outage doesn't flood the log. */
function logThrottled(message: string, error: unknown): void {
  if (Date.now() - lastErrorLog < 60_000) return;
  lastErrorLog = Date.now();
  console.error(message, error);
}

/** One finalize at a time per process; concurrent callers share it. */
function finalizeOnce(): Promise<void> {
  if (!inflight) {
    inflight = (async () => {
      try {
        const result = await finalizeDueSaleCountdown(db());
        if (result.finalized) {
          const saleEnd = result.saleEnded
            ? `; sale ended, ${result.changed} product price(s) switched to post-sale`
            : "";
          console.info(`[SaleCountdown] Countdown ${result.runId ?? ""} expired${saleEnd}`);
        }
        noteSaleCountdownState(await readCountdown(db()));
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

/**
 * Fastify onRequest hook body. No database work unless this process already
 * knows the deadline passed; then the request waits for the (single, shared)
 * expiry so the page it renders shows post-sale prices. Never throws — a
 * failure here only affects display, and checkout refuses to price a cart
 * while the expiry is still due.
 */
export async function ensureSaleExpiryApplied(): Promise<void> {
  if (!process.env.DATABASE_URL || !isKnownDeadlinePassed()) return;
  try {
    await finalizeOnce();
  } catch (error) {
    logThrottled("[SaleCountdown] Expiry on request failed (will retry):", error);
  }
}

export function startSaleCountdownWorker(): { stop: () => void } {
  let lastRefresh = 0;
  let busy = false;

  const tick = async () => {
    if (busy || !process.env.DATABASE_URL) return;
    busy = true;
    try {
      if (Date.now() - lastRefresh >= REFRESH_MS) {
        noteSaleCountdownState(await readCountdown(db()));
        lastRefresh = Date.now();
      }
      if (isKnownDeadlinePassed()) await finalizeOnce();
    } catch (error) {
      logThrottled("[SaleCountdown] Tick failed (retrying every second):", error);
    } finally {
      busy = false;
    }
  };

  const intervalId = setInterval(() => void tick(), TICK_MS);
  intervalId.unref?.();
  void tick();
  return { stop: () => clearInterval(intervalId) };
}
