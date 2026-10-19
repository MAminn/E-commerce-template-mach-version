import { asc, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "#root/shared/database/drizzle/db";
import { promoCode } from "#root/shared/database/drizzle/schema";
import {
  PROMO_BUCKETS,
  REPORT_TIME_ZONE,
  boundedReportRangeSchema,
  type PromoOrdersPage,
  type PromoSummary,
  type PromoSummaryRow,
  type ReportRange,
} from "#root/shared/promo-performance/report";
import {
  classifyOrder,
  sumTotals,
  toCents,
  toOrderRow,
  type ClassifiedOrder,
  type PromoOrderFacts,
} from "./classify";

/**
 * Promo Performance report — reads historical orders as they are stored.
 * Nothing here writes: every read runs in a READ ONLY transaction.
 *
 * In scope: every order in the range that links a promo code, came from an
 * online payment attempt that recorded a code, or carries any discount (the
 * last group without a code is reported as "unattributed").
 */

export const promoOrdersInputSchema = z.object({
  range: boundedReportRangeSchema,
  /** null = the unattributed discounted orders. */
  code: z.string().trim().min(1).max(100).nullable(),
  bucket: z.enum(PROMO_BUCKETS).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});
export type PromoOrdersInput = z.infer<typeof promoOrdersInputSchema>;

type Tx = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

/** Cairo-day bounds: [from 00:00 Cairo, (to + 1 day) 00:00 Cairo). */
export function rangeCondition(range: ReportRange): SQL {
  const parts: SQL[] = [sql`true`];
  if (range.from) {
    parts.push(sql`o.created_at >= (${range.from}::date::timestamp at time zone ${REPORT_TIME_ZONE})`);
  }
  if (range.to) {
    parts.push(sql`o.created_at < ((${range.to}::date + 1)::timestamp at time zone ${REPORT_TIME_ZONE})`);
  }
  return sql.join(parts, sql` and `);
}

interface FactsRow extends Record<string, unknown> {
  id: string;
  reference: string | null;
  created_at: Date | string;
  status: PromoOrderFacts["status"];
  payment_method: string;
  payment_status: string;
  subtotal: string;
  discount: string | null;
  shipping: string;
  tax: string;
  total: string;
  linked_code: string | null;
  attempt_code: string | null;
  attempt_id: string | null;
  attempt_subtotal: string | null;
  attempt_discount: string | null;
  attempt_promo_discount: string | null;
  attempt_offer_discount: string | null;
  attempt_total: string | null;
  bosta_status: string | null;
  bosta_status_code: string | null;
  on_hold: boolean;
  archived: boolean;
  return_logged: boolean;
  admin_edited: boolean;
}

/**
 * The facts for every in-scope order in the range, newest first.
 * `code` undefined = all; null = unattributed only; a string = that code.
 */
export async function loadPromoOrderFacts(
  tx: Tx,
  range: ReportRange,
  code?: string | null,
): Promise<PromoOrderFacts[]> {
  const codeFilter =
    code === undefined
      ? sql`true`
      : code === null
        ? sql`coalesce(s.linked_code, s.attempt_code) is null`
        : sql`coalesce(s.linked_code, s.attempt_code) = ${code}`;

  const result = await tx.execute<FactsRow>(sql`
    with scoped as (
      select o.id, o.reference, o.created_at, o.status, o.payment_method, o.payment_status,
             o.subtotal, o.discount, o.shipping, o.tax, o.total,
             p.code as linked_code,
             a.promo_code as attempt_code,
             a.id as attempt_id,
             a.subtotal as attempt_subtotal,
             a.discount as attempt_discount,
             a.promo_discount as attempt_promo_discount,
             a.offer_discount as attempt_offer_discount,
             a.total as attempt_total,
             o.bosta_status, o.bosta_status_code,
             (o.fulfillment_hold is not null) as on_hold,
             (o.archived_at is not null) as archived
      from "order" o
      left join promo_code p on p.id = o.promo_code_id
      -- payment_attempt.order_id is unique: at most one row per order.
      left join payment_attempt a on a.order_id = o.id
      where ${rangeCondition(range)}
        and (o.promo_code_id is not null
             or a.promo_code is not null
             or coalesce(o.discount, 0) > 0)
    ),
    logs as (
      select l.order_id,
             bool_or(l.action = 'bosta_status_updated' and l.note like '%(code 46)%') as return_logged,
             bool_or(l.note like 'Order edited by %') as admin_edited
      from order_log l
      where l.order_id in (select id from scoped)
      group by l.order_id
    )
    select s.*,
           coalesce(logs.return_logged, false) as return_logged,
           coalesce(logs.admin_edited, false) as admin_edited
    from scoped s
    left join logs on logs.order_id = s.id
    where ${codeFilter}
    order by s.created_at desc, s.id desc
  `);

  return result.rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    status: r.status,
    paymentMethod: r.payment_method,
    paymentStatus: r.payment_status,
    subtotal: r.subtotal,
    discount: r.discount,
    shipping: r.shipping,
    tax: r.tax,
    total: r.total,
    linkedCode: r.linked_code,
    attemptCode: r.attempt_code,
    attempt:
      r.attempt_id && r.attempt_subtotal !== null && r.attempt_total !== null
        ? {
            subtotal: r.attempt_subtotal,
            discount: r.attempt_discount,
            promoDiscount: r.attempt_promo_discount ?? "0",
            offerDiscount: r.attempt_offer_discount ?? "0",
            total: r.attempt_total,
          }
        : null,
    bostaStatus: r.bosta_status,
    bostaStatusCode: r.bosta_status_code,
    returnLogged: r.return_logged,
    adminEdited: r.admin_edited,
    onHold: r.on_hold,
    archived: r.archived,
  }));
}

function readOnly<T>(db: DatabaseClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // Production currently lacks the report's supporting order/log indexes.
    // Bound every request so a report cannot compete indefinitely with paid
    // storefront traffic; PostgreSQL cancels the statement on expiry.
    await tx.execute(sql`set local statement_timeout = '1500ms'`);
    await tx.execute(sql`set local lock_timeout = '250ms'`);
    await tx.execute(sql`set local idle_in_transaction_session_timeout = '5s'`);
    await tx.execute(sql`set local max_parallel_workers_per_gather = 0`);
    return fn(tx);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** One row per promo code (including codes with no orders in the range). */
export async function getPromoPerformanceSummary(
  db: DatabaseClient,
  range: ReportRange,
): Promise<PromoSummary> {
  const safeRange = boundedReportRangeSchema.parse(range);
  return readOnly(db, async (tx) => {
    const facts = await loadPromoOrderFacts(tx, safeRange);
    const codes = await tx
      .select({ code: promoCode.code, description: promoCode.description })
      .from(promoCode)
      .orderBy(asc(promoCode.code))
      .execute();

    const byCode = new Map<string, ClassifiedOrder[]>();
    const unattributed: ClassifiedOrder[] = [];
    for (const f of facts) {
      const classified = classifyOrder(f);
      if (classified.code === null) {
        unattributed.push(classified);
        continue;
      }
      const list = byCode.get(classified.code);
      if (list) list.push(classified);
      else byCode.set(classified.code, [classified]);
    }

    const existing = new Map(codes.map((c) => [c.code, c.description]));
    const allCodes = new Set([...existing.keys(), ...byCode.keys()]);
    const rows: PromoSummaryRow[] = [...allCodes].map((code) => ({
      code,
      codeExists: existing.has(code),
      description: existing.get(code) ?? null,
      ...sumTotals(byCode.get(code) ?? []),
    }));
    // Highest net sales first; codes with no orders last, alphabetically.
    rows.sort(
      (a, b) => toCents(b.netSales) - toCents(a.netSales) || b.orders - a.orders || a.code.localeCompare(b.code),
    );

    return {
      range: safeRange,
      rows,
      attributedTotals: sumTotals([...byCode.values()].flat()),
      unattributed: sumTotals(unattributed),
      generatedAt: new Date().toISOString(),
    };
  });
}

/** One code's orders, a page at a time, with the code's full-range totals. */
export async function getPromoOrders(
  db: DatabaseClient,
  input: PromoOrdersInput,
): Promise<PromoOrdersPage> {
  const safeInput = promoOrdersInputSchema.parse(input);
  return readOnly(db, async (tx) => {
    const classified = (await loadPromoOrderFacts(tx, safeInput.range, safeInput.code)).map(classifyOrder);
    const filtered = safeInput.bucket ? classified.filter((o) => o.bucket === safeInput.bucket) : classified;
    return {
      code: safeInput.code,
      range: safeInput.range,
      totals: sumTotals(classified),
      rows: filtered.slice(safeInput.offset, safeInput.offset + safeInput.limit).map(toOrderRow),
      filteredCount: filtered.length,
      limit: safeInput.limit,
      offset: safeInput.offset,
    };
  });
}
