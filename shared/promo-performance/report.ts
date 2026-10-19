import { z } from "zod";

/**
 * Promo Performance report — types and rules shared by the backend and the
 * dashboard page. The classification itself lives in
 * backend/promo-performance/classify.ts.
 */

/** Report days and months are Cairo calendar days (DST-aware, done in SQL). */
export const REPORT_TIME_ZONE = "Africa/Cairo";

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid date");

/** Inclusive Cairo-day range. Either end may be omitted (open-ended / all time). */
export const reportRangeSchema = z
  .object({ from: ymd.optional(), to: ymd.optional() })
  .refine((r) => !r.from || !r.to || r.from <= r.to, "Start date must be on or before end date");

export type ReportRange = z.infer<typeof reportRangeSchema>;

/**
 * Production report queries must be closed and short. The live database does
 * not currently have indexes on order.created_at or order_log.order_id, so an
 * open-ended historical scan is deliberately rejected at the API boundary.
 */
export const MAX_REPORT_DAYS = 31;
export const boundedReportRangeSchema = z
  .object({ from: ymd, to: ymd })
  .refine((r) => r.from <= r.to, "Start date must be on or before end date")
  .refine((r) => {
    const from = Date.parse(`${r.from}T00:00:00Z`);
    const to = Date.parse(`${r.to}T00:00:00Z`);
    return (to - from) / 86_400_000 + 1 <= MAX_REPORT_DAYS;
  }, `Reports are limited to ${MAX_REPORT_DAYS} days`);
export type BoundedReportRange = z.infer<typeof boundedReportRangeSchema>;

/** "2026-10" → { from: "2026-10-01", to: "2026-10-31" }. */
export function monthRange(month: string): { from: string; to: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`Invalid month: ${month}`);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) throw new Error(`Invalid month: ${month}`);
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** The Cairo calendar month containing `now`, as "YYYY-MM". */
export function cairoMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}`;
}

/**
 * Where an order sits for commission purposes. Every attributed order is in
 * exactly one bucket, so the buckets always add up to net sales.
 */
export const PROMO_BUCKETS = [
  "eligible",
  "review",
  "in_progress",
  "cancelled",
  "returned",
  "refunded",
] as const;
export type PromoBucket = (typeof PROMO_BUCKETS)[number];

export const PROMO_BUCKET_LABELS: Record<PromoBucket, string> = {
  eligible: "Commission-eligible",
  review: "Requires review",
  in_progress: "Not yet delivered",
  cancelled: "Cancelled",
  returned: "Returned",
  refunded: "Refunded",
};

/** How the order is tied to its code. */
export type PromoAttribution =
  /** order.promo_code_id → promo_code (the normal case). */
  | "promo_link"
  /** The code was deleted; the online payment record still holds its text. */
  | "payment_record"
  /** A discount with neither — an automatic offer or a deleted code. */
  | "none";

/** Why an amount can't be confirmed automatically. */
export const REVIEW_REASONS = {
  admin_edited:
    "Edited by an admin after checkout. The original amounts aren't kept, so this amount can't be confirmed automatically.",
  total_mismatch:
    "The stored total doesn't equal subtotal − discount + shipping + tax, so the total was overridden by hand.",
  negative_net: "The recorded discount is larger than the subtotal.",
  refund_amount_unknown:
    "Marked refunded, but refund amounts aren't recorded. It's treated as a full refund — check whether only part was refunded.",
  online_not_paid: "Delivered, but the online payment isn't marked paid.",
  payment_failed: "Delivered, but the payment is marked failed.",
  on_hold: "Delivered while on a fulfillment hold.",
  archived: "The order is archived.",
  return_status_conflict:
    "Bosta reported this order returned, but its status is not cancelled.",
} as const;
export type ReviewReason = keyof typeof REVIEW_REASONS;

export type FinancialStatus =
  /** Eligible, and nothing makes the amount uncertain. */
  | "verified"
  /** Payable or partly payable, but a person must confirm the amount. */
  | "needs_review"
  /** Not payable under the commission rules (yet, or at all). */
  | "not_payable";

export interface BucketTotals {
  orders: number;
  /** Net product revenue (subtotal − discount) of the orders in the bucket. */
  amount: string;
}

export interface PromoTotals {
  orders: number;
  /** Σ subtotal — product sales before promo and offer discounts. */
  grossSales: string;
  /** Σ discount — promo + automatic offers combined, as stored on the order. */
  totalDiscounts: string;
  /** Σ promo-only discount over the orders where it is separately recorded. */
  promoOnlyDiscounts: string;
  /** How many orders `promoOnlyDiscounts` covers. */
  promoOnlyKnownOrders: number;
  /** Σ (subtotal − discount). Equals the sum of all bucket amounts. */
  netSales: string;
  buckets: Record<PromoBucket, BucketTotals>;
  /** Orders whose financial status is needs_review (includes refunded). */
  flaggedOrders: number;
  /** Orders attributed only through the payment record (code deleted). */
  recoveredOrders: number;
}

export interface PromoSummaryRow extends PromoTotals {
  code: string;
  /** The promo code still exists (false = deleted, recovered from payments). */
  codeExists: boolean;
  description: string | null;
}

export interface PromoSummary {
  range: ReportRange;
  rows: PromoSummaryRow[];
  /** Σ over `rows`. */
  attributedTotals: PromoTotals;
  /** Discounted orders that can't be tied to any code. Never in `rows`. */
  unattributed: PromoTotals;
  generatedAt: string;
}

export interface PromoOrderRow {
  id: string;
  reference: string;
  createdAt: string;
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled";
  paymentMethod: string;
  paymentStatus: string;
  subtotal: string;
  /** Combined (promo + offers). */
  discount: string;
  /** null when not separately recorded. */
  promoOnlyDiscount: string | null;
  offerDiscount: string | null;
  net: string;
  shipping: string;
  total: string;
  bucket: PromoBucket;
  eligibleAmount: string;
  reviewAmount: string;
  financialStatus: FinancialStatus;
  reasons: ReviewReason[];
  attribution: PromoAttribution;
  bostaStatus: string | null;
}

export interface PromoOrdersPage {
  code: string | null;
  range: ReportRange;
  /** Totals over every order of the code in the range (all pages). */
  totals: PromoTotals;
  rows: PromoOrderRow[];
  /** Rows matching the bucket filter (= totals.orders without a filter). */
  filteredCount: number;
  limit: number;
  offset: number;
}
