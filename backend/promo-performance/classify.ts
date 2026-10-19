import { resolveOrderReference } from "#root/shared/orders/order-reference";
import {
  PROMO_BUCKETS,
  type FinancialStatus,
  type PromoAttribution,
  type PromoBucket,
  type PromoOrderRow,
  type PromoTotals,
  type ReviewReason,
} from "#root/shared/promo-performance/report";

/**
 * Commission classification for promo-attributed orders. Pure: the summary
 * and the drill-down both run every order through `classifyOrder` and add up
 * with `sumTotals`, so a code's summary row always equals its order list.
 *
 * Money is integer piastres (cents) parsed from the stored numeric(10,2)
 * text — never floats.
 */

export interface PromoOrderFacts {
  id: string;
  reference: string | null;
  createdAt: Date;
  status: PromoOrderRow["status"];
  paymentMethod: string;
  paymentStatus: string;
  subtotal: string;
  discount: string | null;
  shipping: string;
  tax: string;
  total: string;
  /** Code of the promo the order links to (null if none or deleted). */
  linkedCode: string | null;
  /** Code text kept on the online payment attempt, if the order came from one. */
  attemptCode: string | null;
  /** The priced checkout the payment attempt recorded, if any. */
  attempt: {
    subtotal: string;
    discount: string | null;
    promoDiscount: string;
    offerDiscount: string;
    total: string;
  } | null;
  bostaStatus: string | null;
  bostaStatusCode: string | null;
  /** order_log holds a Bosta "(code 46)" Returned-to-business entry. */
  returnLogged: boolean;
  /** order_log holds an "Order edited by …" entry (admin edit panel). */
  adminEdited: boolean;
  onHold: boolean;
  archived: boolean;
}

export interface ClassifiedOrder {
  facts: PromoOrderFacts;
  /** null = unattributed. */
  code: string | null;
  attribution: PromoAttribution;
  subtotal: number;
  discount: number;
  net: number;
  promoOnlyDiscount: number | null;
  offerDiscount: number | null;
  bucket: PromoBucket;
  financialStatus: FinancialStatus;
  reasons: ReviewReason[];
}

const MONEY = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/** "1234.5" → 123450. Throws on anything that isn't a plain decimal. */
export function toCents(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const match = MONEY.exec(value.trim());
  if (!match) throw new Error(`Not a money amount: ${JSON.stringify(value)}`);
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error(`Money amount out of range: ${value}`);
  return match[1] === "-" && cents !== 0 ? -cents : cents;
}

/** 123450 → "1234.50". */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Not a cent amount: ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Bosta "Returned to business". */
export const BOSTA_RETURNED_CODE = "46";

/**
 * Rounding slack for the total check: each stored column was rounded to
 * 2 decimals on its own, so a legitimate total can differ by one piastre.
 */
const TOTAL_TOLERANCE_CENTS = 1;

export function classifyOrder(f: PromoOrderFacts): ClassifiedOrder {
  const code = f.linkedCode ?? f.attemptCode ?? null;
  const attribution: PromoAttribution = f.linkedCode
    ? "promo_link"
    : f.attemptCode
      ? "payment_record"
      : "none";

  const subtotal = toCents(f.subtotal);
  const discount = toCents(f.discount);
  const shipping = toCents(f.shipping);
  const tax = toCents(f.tax);
  const total = toCents(f.total);
  const net = subtotal - discount;

  // The order still carries exactly what the customer was charged at
  // checkout, per the payment attempt's own record.
  const attemptMatches =
    f.attempt !== null &&
    toCents(f.attempt.subtotal) === subtotal &&
    toCents(f.attempt.discount) === discount &&
    toCents(f.attempt.total) === total;

  const reasons: ReviewReason[] = [];
  if (f.adminEdited && !attemptMatches) reasons.push("admin_edited");
  // Checkout: max(0, subtotal − discount) + shipping (+ tax 0).
  // Admin edit: max(0, subtotal + shipping + tax − discount).
  const checkoutTotal = Math.max(0, net) + shipping + tax;
  const editTotal = Math.max(0, subtotal + shipping + tax - discount);
  if (
    Math.abs(total - checkoutTotal) > TOTAL_TOLERANCE_CENTS &&
    Math.abs(total - editTotal) > TOTAL_TOLERANCE_CENTS
  ) {
    reasons.push("total_mismatch");
  }
  if (net < 0) reasons.push("negative_net");
  if (f.archived) reasons.push("archived");

  // Promo-only discount is known only where it was recorded on its own (the
  // online payment attempt, untouched since) or when there was no discount.
  let promoOnlyDiscount: number | null = null;
  let offerDiscount: number | null = null;
  if (attemptMatches && f.attempt) {
    const promo = toCents(f.attempt.promoDiscount);
    const offer = toCents(f.attempt.offerDiscount);
    if (promo + offer === discount) {
      promoOnlyDiscount = promo;
      offerDiscount = offer;
    }
  } else if (discount === 0) {
    promoOnlyDiscount = 0;
    offerDiscount = 0;
  }

  const returned = f.bostaStatusCode === BOSTA_RETURNED_CODE || f.returnLogged;

  let bucket: PromoBucket;
  if (f.status === "cancelled") {
    bucket = returned ? "returned" : "cancelled";
  } else if (f.paymentStatus === "refunded") {
    bucket = "refunded";
    reasons.push("refund_amount_unknown");
  } else if (f.status === "delivered") {
    if (returned) reasons.push("return_status_conflict");
    const online = f.paymentMethod !== "cod";
    if (online && f.paymentStatus !== "paid") reasons.push("online_not_paid");
    if (!online && f.paymentStatus === "failed") reasons.push("payment_failed");
    if (f.onHold) reasons.push("on_hold");
    bucket = reasons.length === 0 ? "eligible" : "review";
  } else {
    bucket = "in_progress";
  }

  const financialStatus: FinancialStatus =
    bucket === "eligible"
      ? "verified"
      : bucket === "review" || bucket === "refunded"
        ? "needs_review"
        : "not_payable";

  return {
    facts: f,
    code,
    attribution,
    subtotal,
    discount,
    net,
    promoOnlyDiscount,
    offerDiscount,
    bucket,
    financialStatus,
    reasons,
  };
}

/** Exact totals over a list of classified orders. */
export function sumTotals(orders: readonly ClassifiedOrder[]): PromoTotals {
  const buckets = Object.fromEntries(
    PROMO_BUCKETS.map((b) => [b, { orders: 0, cents: 0 }]),
  ) as Record<PromoBucket, { orders: number; cents: number }>;
  let gross = 0;
  let discounts = 0;
  let promoOnly = 0;
  let promoOnlyKnown = 0;
  let net = 0;
  let flagged = 0;
  let recovered = 0;

  for (const o of orders) {
    gross += o.subtotal;
    discounts += o.discount;
    net += o.net;
    if (o.promoOnlyDiscount !== null) {
      promoOnly += o.promoOnlyDiscount;
      promoOnlyKnown += 1;
    }
    if (o.financialStatus === "needs_review") flagged += 1;
    if (o.attribution === "payment_record") recovered += 1;
    buckets[o.bucket].orders += 1;
    buckets[o.bucket].cents += o.net;
  }

  return {
    orders: orders.length,
    grossSales: formatCents(gross),
    totalDiscounts: formatCents(discounts),
    promoOnlyDiscounts: formatCents(promoOnly),
    promoOnlyKnownOrders: promoOnlyKnown,
    netSales: formatCents(net),
    buckets: Object.fromEntries(
      PROMO_BUCKETS.map((b) => [b, { orders: buckets[b].orders, amount: formatCents(buckets[b].cents) }]),
    ) as PromoTotals["buckets"],
    flaggedOrders: flagged,
    recoveredOrders: recovered,
  };
}

export function toOrderRow(o: ClassifiedOrder): PromoOrderRow {
  const f = o.facts;
  return {
    id: f.id,
    reference: resolveOrderReference(f),
    createdAt: f.createdAt.toISOString(),
    status: f.status,
    paymentMethod: f.paymentMethod,
    paymentStatus: f.paymentStatus,
    subtotal: formatCents(o.subtotal),
    discount: formatCents(o.discount),
    promoOnlyDiscount: o.promoOnlyDiscount === null ? null : formatCents(o.promoOnlyDiscount),
    offerDiscount: o.offerDiscount === null ? null : formatCents(o.offerDiscount),
    net: formatCents(o.net),
    shipping: f.shipping,
    total: f.total,
    bucket: o.bucket,
    eligibleAmount: formatCents(o.bucket === "eligible" ? o.net : 0),
    reviewAmount: formatCents(o.bucket === "review" ? o.net : 0),
    financialStatus: o.financialStatus,
    reasons: o.reasons,
    attribution: o.attribution,
    bostaStatus: f.bostaStatus,
  };
}
