/**
 * Sale countdown rules shared by the server, the storefront banner and the
 * dashboard. Pure: no database, no clock of its own — `now` is always passed
 * in, so the same function gives the same answer everywhere it runs.
 */

export type SaleCountdownStatus = "inactive" | "running" | "expired";

export const DEFAULT_COUNTDOWN_MINUTES = 60;
export const MAX_COUNTDOWN_MINUTES = 525_600; // one year
export const DEFAULT_COUNTDOWN_LABEL = "Sale ends in";
export const MAX_COUNTDOWN_LABEL_LENGTH = 60;

/** What every storefront visitor is told, from GET /api/sale-countdown. */
export interface PublicSaleCountdown {
  /** True only while the countdown is running and its deadline is ahead. */
  active: boolean;
  /** ISO deadline; null when not active. */
  endsAt: string | null;
  label: string;
  /** ISO server time when the response was built, for clock-offset correction. */
  serverNow: string;
}

/**
 * The phase a countdown is really in at `now`. A stored "running" row whose
 * deadline has passed is already expired — before the expiry transaction has
 * caught up — so nothing ever shows or honours a countdown past its end.
 */
export function effectiveCountdownStatus(
  row: { status: SaleCountdownStatus; endsAt: Date | null } | null | undefined,
  now: Date,
): SaleCountdownStatus {
  if (!row) return "inactive";
  if (row.status === "running") {
    if (!row.endsAt || row.endsAt.getTime() <= now.getTime()) return "expired";
    return "running";
  }
  return row.status;
}

/** "00:59:59", or "2d 03:04:05" once the remaining time reaches a day. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

// ─── Money (integer piastres, never floats) ──────────────────────────────────

/** "1400.00" | 1400 → 140000. Null for missing / non-numeric input. */
export function toCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * The `product.discount_price` a sale product gets when its sale ends.
 *
 * The post-sale price is what the shopper pays afterwards. Below the list
 * price it stays a (non-sale) discount; at or above it the discount is
 * removed and the list price applies. `product.price` itself is never
 * written, so a post-sale price above a since-lowered list price can only
 * make the product cheaper than configured, never dearer than its list price.
 */
export function postSaleDiscountPrice(
  listPrice: string | number,
  postSalePrice: string | number,
): { discountPrice: string | null; cappedAtListPrice: boolean } {
  const list = toCents(listPrice);
  const post = toCents(postSalePrice);
  if (list === null || post === null) {
    throw new Error("postSaleDiscountPrice: prices must be numeric");
  }
  if (post < list) return { discountPrice: centsToDecimalString(post), cappedAtListPrice: false };
  return { discountPrice: null, cappedAtListPrice: post > list };
}

// ─── Sale product validation ─────────────────────────────────────────────────

export interface SaleItemForValidation {
  productId: string;
  name: string;
  postSalePrice: string | number | null;
  listPrice: string | number;
  deleted: boolean;
}

/**
 * Why the configured sale products are not ready for an automatic sale end.
 * Empty = ready. Nothing is guessed: a product without an explicit post-sale
 * price is a problem, not a product that falls back to some other price.
 */
export function saleItemProblems(items: readonly SaleItemForValidation[]): string[] {
  if (items.length === 0) {
    return ["Add at least one sale product with its post-sale price."];
  }
  const problems: string[] = [];
  for (const item of items) {
    const post = toCents(item.postSalePrice);
    const list = toCents(item.listPrice);
    if (item.deleted) {
      problems.push(`${item.name}: the product was deleted — remove it from the sale.`);
    } else if (post === null) {
      problems.push(`${item.name}: post-sale price is not set.`);
    } else if (post <= 0) {
      problems.push(`${item.name}: post-sale price must be more than 0.`);
    } else if (list !== null && post > list) {
      problems.push(
        `${item.name}: post-sale price ${centsToDecimalString(post)} is above the list price ${centsToDecimalString(list)}.`,
      );
    }
  }
  return problems;
}

// ─── Browser clock correction ────────────────────────────────────────────────

/** Window event fired once when a visitor's countdown reaches zero. */
export const SALE_COUNTDOWN_ENDED_EVENT = "mach:sale-countdown-ended";

/**
 * server clock − browser clock, in ms, from one request: the server's
 * `serverNow` is taken as the midpoint of the round trip. A visitor whose
 * device clock is minutes off still sees the same remaining time as everyone.
 */
export function clockOffsetMs(requestStartMs: number, responseEndMs: number, serverNowIso: string): number {
  const serverNow = Date.parse(serverNowIso);
  if (!Number.isFinite(serverNow)) return 0;
  return serverNow + (responseEndMs - requestStartMs) / 2 - responseEndMs;
}

/** ms until the displayed second changes (display rounds remaining time up). */
export function msUntilNextTick(remainingMs: number): number {
  if (remainingMs <= 0) return 1000;
  const rest = remainingMs % 1000;
  return rest === 0 ? 1000 : rest;
}
