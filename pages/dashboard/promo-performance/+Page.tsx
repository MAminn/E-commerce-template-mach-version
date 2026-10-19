"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#root/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "#root/components/ui/table";
import { Badge } from "#root/components/ui/badge";
import { Button } from "#root/components/ui/button";
import { Input } from "#root/components/ui/input";
import { Label } from "#root/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#root/components/ui/select";
import { trpc } from "#root/shared/trpc/client";
import { STORE_CURRENCY } from "#root/shared/config/branding";
import {
  cairoMonth,
  monthRange,
  PROMO_BUCKET_LABELS,
  PROMO_BUCKETS,
  REPORT_TIME_ZONE,
  REVIEW_REASONS,
  type BoundedReportRange,
  type FinancialStatus,
  type PromoBucket,
  type PromoOrdersPage,
  type PromoSummary,
  type PromoTotals,
  type ReportRange,
} from "#root/shared/promo-performance/report";

/**
 * Promo Performance — revenue per promo code from the orders as stored, and
 * the commission-eligible base (subtotal − discount; no shipping or tax).
 * Read-only. Uncertain amounts are shown as "Requires review", never as
 * eligible, and discounted orders without a code are listed separately.
 */

type PeriodMode = "month" | "custom";

const PAGE_SIZE = 25;

/** "1234567.5" → "1,234,567.50" — string math, no floats. */
function money(value: string): string {
  const negative = value.startsWith("-");
  const [int = "0", frac = ""] = (negative ? value.slice(1) : value).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${frac.padEnd(2, "0").slice(0, 2)}`;
}

function cairoDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: REPORT_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function rangeLabel(range: ReportRange): string {
  return `${range.from} → ${range.to} (Cairo time)`;
}

const BUCKET_CLASS: Record<PromoBucket, string> = {
  eligible: "bg-green-100 text-green-800 border-green-200",
  review: "bg-amber-100 text-amber-800 border-amber-200",
  in_progress: "bg-gray-100 text-gray-700 border-gray-200",
  cancelled: "bg-gray-100 text-gray-700 border-gray-200",
  returned: "bg-red-50 text-red-700 border-red-200",
  refunded: "bg-red-50 text-red-700 border-red-200",
};

const FINANCIAL_LABEL: Record<FinancialStatus, string> = {
  verified: "Verified",
  needs_review: "Needs review",
  not_payable: "Not payable",
};

/** Amount with its order count underneath. */
function Amount({ amount, orders }: { amount: string; orders?: number }) {
  return (
    <div className='whitespace-nowrap text-right'>
      <div className='tabular-nums'>{money(amount)}</div>
      {orders !== undefined && (
        <div className='text-[11px] text-muted-foreground'>
          {orders} order{orders === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}

function PromoOnly({ totals }: { totals: PromoTotals }) {
  if (totals.orders === 0) return <Amount amount='0.00' />;
  const all = totals.promoOnlyKnownOrders === totals.orders;
  return (
    <div className='whitespace-nowrap text-right'>
      <div className='tabular-nums'>{totals.promoOnlyKnownOrders === 0 ? "—" : money(totals.promoOnlyDiscounts)}</div>
      <div className={`text-[11px] ${all ? "text-muted-foreground" : "text-amber-700"}`}>
        {all ? "all orders" : `recorded for ${totals.promoOnlyKnownOrders} of ${totals.orders}`}
      </div>
    </div>
  );
}

/**
 * The summary columns, shared by code rows, the total row and the unattributed
 * row. `noCode`: the orders meet the payout rules but no influencer can be
 * credited, so nothing is shown as commission.
 */
function TotalsCells({ totals, noCode = false }: { totals: PromoTotals; noCode?: boolean }) {
  const b = totals.buckets;
  return (
    <>
      <TableCell className='text-right tabular-nums'>{totals.orders}</TableCell>
      <TableCell><Amount amount={totals.grossSales} /></TableCell>
      <TableCell><Amount amount={totals.totalDiscounts} /></TableCell>
      <TableCell><PromoOnly totals={totals} /></TableCell>
      <TableCell><Amount amount={totals.netSales} /></TableCell>
      <TableCell className={noCode ? "" : "bg-green-50/60 font-semibold text-green-900"}>
        <Amount amount={b.eligible.amount} orders={b.eligible.orders} />
      </TableCell>
      <TableCell className={b.review.orders > 0 ? "bg-amber-50/70 text-amber-900" : ""}>
        <Amount amount={b.review.amount} orders={b.review.orders} />
      </TableCell>
      <TableCell><Amount amount={b.in_progress.amount} orders={b.in_progress.orders} /></TableCell>
      <TableCell><Amount amount={b.cancelled.amount} orders={b.cancelled.orders} /></TableCell>
      <TableCell><Amount amount={b.returned.amount} orders={b.returned.orders} /></TableCell>
      <TableCell><Amount amount={b.refunded.amount} orders={b.refunded.orders} /></TableCell>
    </>
  );
}

function SummaryHead({ first, noCode = false }: { first: string; noCode?: boolean }) {
  return (
    <TableRow>
      <TableHead>{first}</TableHead>
      <TableHead className='text-right'>Orders</TableHead>
      <TableHead className='text-right'>Gross product sales</TableHead>
      <TableHead className='text-right'>Total discounts</TableHead>
      <TableHead className='text-right'>Promo-only discounts</TableHead>
      <TableHead className='text-right'>Net product sales</TableHead>
      <TableHead className='text-right'>
        {noCode ? "Meets payout rules (no code to credit)" : "Commission-eligible (verified)"}
      </TableHead>
      <TableHead className='text-right'>Requires review</TableHead>
      <TableHead className='text-right'>Not yet delivered</TableHead>
      <TableHead className='text-right'>Cancelled</TableHead>
      <TableHead className='text-right'>Returned</TableHead>
      <TableHead className='text-right'>Refunded</TableHead>
    </TableRow>
  );
}

/** Field-by-field equality of two totals (the drill-down vs. its summary row). */
function sameTotals(a: PromoTotals, b: PromoTotals): boolean {
  const pick = (t: PromoTotals) =>
    JSON.stringify([
      t.orders,
      t.grossSales,
      t.totalDiscounts,
      t.promoOnlyDiscounts,
      t.promoOnlyKnownOrders,
      t.netSales,
      PROMO_BUCKETS.map((k) => [t.buckets[k].orders, t.buckets[k].amount]),
      t.flaggedOrders,
    ]);
  return pick(a) === pick(b);
}

export default function PromoPerformancePage() {
  const [mode, setMode] = useState<PeriodMode>("month");
  const [month, setMonth] = useState(() => cairoMonth(new Date()));
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [range, setRange] = useState<BoundedReportRange>(() => monthRange(cairoMonth(new Date())));
  const [summary, setSummary] = useState<PromoSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEmpty, setShowEmpty] = useState(false);

  const [selected, setSelected] = useState<{ code: string | null } | null>(null);
  const [bucket, setBucket] = useState<PromoBucket | "all">("all");
  const [page, setPage] = useState(0);
  const [orders, setOrders] = useState<PromoOrdersPage | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await trpc.promoPerformance.summary.query({ range });
      if (res.success) setSummary(res.result as PromoSummary);
      else toast.error(res.error ?? "Couldn't load the report");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't load the report");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const loadOrders = useCallback(async () => {
    if (!selected) return;
    setOrdersLoading(true);
    try {
      const res = await trpc.promoPerformance.orders.query({
        range,
        code: selected.code,
        bucket: bucket === "all" ? undefined : bucket,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      if (res.success) setOrders(res.result as PromoOrdersPage);
      else toast.error(res.error ?? "Couldn't load the orders");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't load the orders");
    } finally {
      setOrdersLoading(false);
    }
  }, [selected, range, bucket, page]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const applyMode = (next: PeriodMode) => {
    setMode(next);
    if (next === "month" && month) setRange(monthRange(month));
  };

  const openCode = (code: string | null) => {
    setSelected({ code });
    setBucket("all");
    setPage(0);
    setOrders(null);
  };

  const rows = summary?.rows.filter((r) => showEmpty || r.orders > 0) ?? [];
  const hiddenEmpty = (summary?.rows.length ?? 0) - rows.length;
  const summaryForSelected: PromoTotals | null = !summary || !selected
    ? null
    : selected.code === null
      ? summary.unattributed
      : (summary.rows.find((r) => r.code === selected.code) ?? null);
  const totalPages = orders ? Math.max(1, Math.ceil(orders.filteredCount / PAGE_SIZE)) : 1;
  const reconciles =
    orders && summaryForSelected && summary && JSON.stringify(orders.range) === JSON.stringify(summary.range)
      ? sameTotals(orders.totals, summaryForSelected)
      : null;

  return (
    <div className='p-4 md:p-6 space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>Promo Performance</CardTitle>
          <CardDescription>
            Revenue per promo code from the orders as stored, including orders placed before this
            report existed. Amounts are in {STORE_CURRENCY}. Commission base = subtotal − discount
            (shipping and tax excluded), counted only for delivered orders that aren't refunded —
            and online orders must also be paid. Amounts that can't be confirmed are shown under
            “Requires review”, never as eligible.
          </CardDescription>
          <div className='mt-3 flex flex-wrap items-end gap-2'>
            <Select value={mode} onValueChange={(v) => applyMode(v as PeriodMode)}>
              <SelectTrigger className='h-9 w-[160px]' aria-label='Period'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='month'>Month</SelectItem>
                <SelectItem value='custom'>Custom range (up to 31 days)</SelectItem>
              </SelectContent>
            </Select>
            {mode === "month" && (
              <Input
                type='month'
                aria-label='Month'
                className='h-9 w-[170px]'
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  if (/^\d{4}-\d{2}$/.test(e.target.value)) setRange(monthRange(e.target.value));
                }}
              />
            )}
            {mode === "custom" && (
              <>
                <div className='grid gap-1'>
                  <Label htmlFor='promo-range-from' className='text-xs text-muted-foreground'>
                    From
                  </Label>
                  <Input
                    id='promo-range-from'
                    type='date'
                    className='h-9 w-[160px]'
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </div>
                <div className='grid gap-1'>
                  <Label htmlFor='promo-range-to' className='text-xs text-muted-foreground'>
                    To
                  </Label>
                  <Input
                    id='promo-range-to'
                    type='date'
                    className='h-9 w-[160px]'
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </div>
                <Button
                  size='sm'
                  className='h-9'
                  onClick={() => {
                    if (!customFrom || !customTo) {
                      toast.error("Choose both a start and end date.");
                      return;
                    }
                    if (customFrom && customTo && customFrom > customTo) {
                      toast.error("The start date must be on or before the end date.");
                      return;
                    }
                    const days = (Date.parse(`${customTo}T00:00:00Z`) - Date.parse(`${customFrom}T00:00:00Z`)) / 86_400_000 + 1;
                    if (days > 31) {
                      toast.error("Reports are limited to 31 days while production indexes are being prepared.");
                      return;
                    }
                    setRange({ from: customFrom, to: customTo });
                  }}>
                  Apply
                </Button>
              </>
            )}
            <Button variant='outline' size='sm' className='h-9 gap-1.5' onClick={() => void loadSummary()}>
              <RefreshCw className='h-3.5 w-3.5' /> Refresh
            </Button>
          </div>
          <p className='mt-2 text-xs text-muted-foreground'>
            Showing orders created {rangeLabel(summary?.range ?? range)}.
          </p>
        </CardHeader>
        <CardContent>
          {loading && !summary ? (
            <div className='py-10 text-center'>
              <Loader2 className='mx-auto h-8 w-8 animate-spin text-muted-foreground' />
            </div>
          ) : !summary ? (
            <p className='py-10 text-center text-muted-foreground'>The report couldn't be loaded.</p>
          ) : (
            <div className={loading ? "opacity-60" : ""}>
              <div className='overflow-x-auto'>
                <Table data-testid='promo-summary-table'>
                  <TableHeader>
                    <SummaryHead first='Promo code' />
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={12} className='py-8 text-center text-muted-foreground'>
                          No promo-code orders in this period.
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map((row) => (
                        <TableRow
                          key={row.code}
                          className={selected?.code === row.code ? "bg-muted/60" : ""}>
                          <TableCell>
                            <button
                              type='button'
                              className='font-mono font-semibold underline underline-offset-2 disabled:no-underline disabled:text-muted-foreground'
                              disabled={row.orders === 0}
                              onClick={() => openCode(row.code)}>
                              {row.code}
                            </button>
                            {row.description && (
                              <div className='max-w-[200px] truncate text-xs text-muted-foreground' title={row.description}>
                                {row.description}
                              </div>
                            )}
                            {!row.codeExists && (
                              <Badge variant='outline' className='mt-1 text-[10px]'>
                                Deleted code
                              </Badge>
                            )}
                            {row.recoveredOrders > 0 && (
                              <div className='text-[11px] text-muted-foreground'>
                                {row.recoveredOrders} via payment record
                              </div>
                            )}
                          </TableCell>
                          <TotalsCells totals={row} />
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className='font-semibold'>All codes</TableCell>
                      <TotalsCells totals={summary.attributedTotals} />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
              {hiddenEmpty > 0 && (
                <button
                  type='button'
                  className='mt-2 text-xs underline text-muted-foreground'
                  onClick={() => setShowEmpty((v) => !v)}>
                  {showEmpty ? "Hide" : "Show"} {hiddenEmpty} code{hiddenEmpty === 1 ? "" : "s"} with no orders in this period
                </button>
              )}

              {summary.unattributed.orders > 0 && (
                <div className='mt-6 rounded-md border border-amber-200 bg-amber-50/60 p-3'>
                  <div className='flex items-start gap-2 text-sm text-amber-900'>
                    <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
                    <p>
                      <span className='font-semibold'>{summary.unattributed.orders}</span> discounted
                      order{summary.unattributed.orders === 1 ? " has" : "s have"} no promo code on record. The
                      discount came from an automatic offer or from a promo code that was later deleted — the
                      records can't tell which. They aren't credited to any code.
                    </p>
                  </div>
                  <div className='mt-2 overflow-x-auto'>
                    <Table>
                      <TableHeader>
                        <SummaryHead first='' noCode />
                      </TableHeader>
                      <TableBody>
                        <TableRow className={selected?.code === null ? "bg-muted/60" : ""}>
                          <TableCell>
                            <button type='button' className='font-semibold underline' onClick={() => openCode(null)}>
                              Unattributed
                            </button>
                          </TableCell>
                          <TotalsCells totals={summary.unattributed} noCode />
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              <details className='mt-6 text-sm text-muted-foreground'>
                <summary className='cursor-pointer font-medium text-foreground'>How amounts are classified</summary>
                <ul className='mt-2 list-disc space-y-1 pl-5'>
                  <li>Dates are when the order was placed, by Cairo calendar day.</li>
                  <li>
                    Gross = order subtotal (after product sale prices). Total discounts = everything stored on the
                    order — the promo code plus any automatic offer. The promo-only part is shown only where it was
                    recorded separately (online orders since 7 Oct 2026, or orders with no discount).
                  </li>
                  <li>Net = gross − total discounts. Each order lands in exactly one of the six columns after Net, so those columns add up to Net.</li>
                  <li>Commission-eligible: delivered, not refunded; online orders must be paid; nothing makes the amount uncertain.</li>
                  <li>
                    Requires review: delivered, but the amount is uncertain — edited by an admin after checkout, a hand-set total, an unpaid online payment, a failed payment,
                    a fulfillment hold, an archived order, or a Bosta return on a non-cancelled order.
                  </li>
                  <li>
                    Returned = cancelled after Bosta reported “Returned to business”. Refunded orders are excluded and
                    flagged: refund amounts aren't recorded, so a partial refund can't be told apart from a full one.
                  </li>
                  <li>Orders deleted from the dashboard no longer exist and can't be reported.</li>
                </ul>
              </details>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card data-testid='promo-orders'>
          <CardHeader>
            <div className='flex items-start justify-between gap-2'>
              <div>
                <CardTitle className='font-mono'>{selected.code ?? "Unattributed discounted orders"}</CardTitle>
                <CardDescription>
                  Orders created {rangeLabel(range)}, newest first.
                  {selected.code === null &&
                    " No promo code is on record for these orders, so none of their revenue is credited to an influencer."}
                </CardDescription>
              </div>
              <Button variant='ghost' size='sm' aria-label='Close' onClick={() => setSelected(null)}>
                <X className='h-4 w-4' />
              </Button>
            </div>
            <div className='mt-2 flex flex-wrap items-center gap-2'>
              <Select
                value={bucket}
                onValueChange={(v) => {
                  setPage(0);
                  setBucket(v as PromoBucket | "all");
                }}>
                <SelectTrigger className='h-9 w-[220px]' aria-label='Filter orders'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>All orders</SelectItem>
                  {PROMO_BUCKETS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {PROMO_BUCKET_LABELS[b]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {reconciles === true && (
                <span className='inline-flex items-center gap-1 text-xs text-green-700'>
                  <CheckCircle2 className='h-3.5 w-3.5' /> Totals match the summary row
                </span>
              )}
              {reconciles === false && (
                <span className='inline-flex items-center gap-1 text-xs text-red-700'>
                  <AlertTriangle className='h-3.5 w-3.5' /> Orders changed since the summary loaded — refresh both
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {ordersLoading && !orders ? (
              <div className='py-10 text-center'>
                <Loader2 className='mx-auto h-8 w-8 animate-spin text-muted-foreground' />
              </div>
            ) : !orders ? null : (
              <div className={ordersLoading ? "opacity-60" : ""}>
                <div className='overflow-x-auto'>
                  <Table data-testid='promo-orders-table'>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order</TableHead>
                        <TableHead>Placed (Cairo)</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead className='text-right'>Subtotal</TableHead>
                        <TableHead className='text-right'>Discounts</TableHead>
                        <TableHead className='text-right'>Net product revenue</TableHead>
                        <TableHead>Commission</TableHead>
                        <TableHead className='text-right'>Eligible amount</TableHead>
                        <TableHead>Financial status</TableHead>
                        <TableHead>Return / cancellation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.rows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={11} className='py-8 text-center text-muted-foreground'>
                            No orders.
                          </TableCell>
                        </TableRow>
                      ) : (
                        orders.rows.map((o) => (
                          <TableRow key={o.id}>
                            <TableCell className='font-mono text-xs'>
                              {o.reference}
                              {o.attribution === "payment_record" && (
                                <div className='text-[10px] text-muted-foreground'>code from payment record</div>
                              )}
                            </TableCell>
                            <TableCell className='whitespace-nowrap text-xs'>{cairoDateTime(o.createdAt)}</TableCell>
                            <TableCell className='capitalize'>{o.status}</TableCell>
                            <TableCell className='text-xs'>
                              <div className='uppercase'>{o.paymentMethod}</div>
                              <div className='text-muted-foreground'>{o.paymentStatus.replace(/_/g, " ")}</div>
                            </TableCell>
                            <TableCell><Amount amount={o.subtotal} /></TableCell>
                            <TableCell>
                              <Amount amount={o.discount} />
                              <div className='text-right text-[11px] text-muted-foreground whitespace-nowrap'>
                                {o.promoOnlyDiscount === null
                                  ? "promo + offers combined"
                                  : `promo ${money(o.promoOnlyDiscount)}${
                                      o.offerDiscount && o.offerDiscount !== "0.00" ? ` · offers ${money(o.offerDiscount)}` : ""
                                    }`}
                              </div>
                            </TableCell>
                            <TableCell><Amount amount={o.net} /></TableCell>
                            <TableCell>
                              <Badge variant='outline' className={`text-[11px] ${BUCKET_CLASS[o.bucket]}`}>
                                {selected.code === null && o.bucket === "eligible"
                                  ? "Meets payout rules — no code"
                                  : PROMO_BUCKET_LABELS[o.bucket]}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Amount amount={o.eligibleAmount} />
                              {o.reviewAmount !== "0.00" && (
                                <div className='text-right text-[11px] text-amber-700 whitespace-nowrap'>
                                  {money(o.reviewAmount)} under review
                                </div>
                              )}
                            </TableCell>
                            <TableCell className='text-xs'>
                              <div className={o.financialStatus === "needs_review" ? "font-medium text-amber-800" : ""}>
                                {selected.code === null && o.financialStatus === "verified"
                                  ? "Amount verified — no code"
                                  : FINANCIAL_LABEL[o.financialStatus]}
                              </div>
                              {o.reasons.map((r) => (
                                <div key={r} className='max-w-[260px] text-[11px] text-muted-foreground'>
                                  {REVIEW_REASONS[r]}
                                </div>
                              ))}
                            </TableCell>
                            <TableCell className='text-xs'>
                              {o.bucket === "returned"
                                ? `Returned${o.bostaStatus ? ` · Bosta: ${o.bostaStatus}` : ""}`
                                : o.bucket === "cancelled"
                                  ? `Cancelled${o.bostaStatus ? ` · Bosta: ${o.bostaStatus}` : ""}`
                                  : o.bucket === "refunded"
                                    ? "Refunded (amount not recorded)"
                                    : "—"}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={4} className='text-xs'>
                          All {orders.totals.orders} order{orders.totals.orders === 1 ? "" : "s"} in this period (every page)
                        </TableCell>
                        <TableCell><Amount amount={orders.totals.grossSales} /></TableCell>
                        <TableCell><Amount amount={orders.totals.totalDiscounts} /></TableCell>
                        <TableCell><Amount amount={orders.totals.netSales} /></TableCell>
                        <TableCell />
                        <TableCell className={selected.code === null ? "" : "text-green-900"}>
                          <Amount amount={orders.totals.buckets.eligible.amount} />
                          {orders.totals.buckets.review.orders > 0 && (
                            <div className='text-right text-[11px] text-amber-700 whitespace-nowrap'>
                              {money(orders.totals.buckets.review.amount)} under review
                            </div>
                          )}
                        </TableCell>
                        <TableCell className='text-xs'>{orders.totals.flaggedOrders} flagged</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
                {totalPages > 1 && (
                  <div className='mt-4 flex items-center justify-between text-sm'>
                    <Button variant='outline' size='sm' disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                      Previous
                    </Button>
                    <span className='text-muted-foreground'>
                      Page {page + 1} of {totalPages} · {orders.filteredCount} orders
                    </span>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={page + 1 >= totalPages}
                      onClick={() => setPage((p) => p + 1)}>
                      Next
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
