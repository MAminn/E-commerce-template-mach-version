"use client";

import { useCallback, useEffect, useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#root/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#root/components/ui/table";
import { Badge } from "#root/components/ui/badge";
import { Button } from "#root/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#root/components/ui/select";
import { Link } from "#root/components/utils/Link";
import { trpc } from "#root/shared/trpc/client";
import { toast } from "sonner";
import { displayOrderNumber } from "#root/shared/orders/order-reference";

/**
 * Payment Attempts — online payments that are not (or not yet) orders.
 * Read-only operational visibility; NOT a fulfillment queue. The only
 * actions are recovery: ask Fawaterak again, or retry creating the order for
 * a payment that is already verified.
 */

type Status =
  | "created"
  | "session_failed"
  | "pending"
  | "failed"
  | "cancelled"
  | "expired"
  | "paid_pending_materialization"
  | "materialized";

interface AttemptRow {
  id: string;
  createdAt: string | Date;
  status: Status;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  total: string;
  currency: string;
  promoCode: string | null;
  intentKey: string | null;
  transactionId: string | null;
  providerPaymentMethod: string | null;
  failureReason: string | null;
  materializationError: string | null;
  materializationAttempts: number;
  paidAt: string | Date | null;
  materializedAt: string | Date | null;
  orderId: string | null;
  orderFulfillmentHold: string | null;
  reference: string;
  providerCheckedAt: string | Date | null;
  providerCheckCount: number;
  providerCheckResult: string | null;
  providerCheckError: string | null;
  nextProviderCheckAt: string | Date | null;
  needsAttention: boolean;
}

const STATUS_LABEL: Record<Status, { label: string; className: string }> = {
  created: { label: "Created", className: "bg-gray-100 text-gray-700 border-gray-200" },
  session_failed: { label: "Couldn't start", className: "bg-gray-100 text-gray-700 border-gray-200" },
  pending: { label: "Awaiting payment", className: "bg-amber-100 text-amber-800 border-amber-200" },
  failed: { label: "Payment failed", className: "bg-red-50 text-red-700 border-red-200" },
  cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-700 border-gray-200" },
  expired: { label: "Expired (provider)", className: "bg-gray-100 text-gray-700 border-gray-200" },
  paid_pending_materialization: {
    label: "PAID — no order yet",
    className: "bg-red-600 text-white border-red-700",
  },
  materialized: { label: "Order created", className: "bg-green-100 text-green-800 border-green-200" },
};

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All attempts" },
  { value: "exceptions", label: "Needs attention" },
  { value: "pending", label: "Awaiting payment" },
  { value: "failed", label: "Payment failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired (provider)" },
  { value: "session_failed", label: "Couldn't start" },
  { value: "paid_pending_materialization", label: "Paid — no order yet" },
  { value: "materialized", label: "Order created" },
];

const PAGE_SIZE = 25;

function formatDate(value: string | Date | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PaymentAttemptsPage() {
  const pageContext = usePageContext();
  const initialFilter = pageContext.urlParsed?.search?.status ?? "all";
  const [filter, setFilter] = useState(initialFilter);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AttemptRow[]>([]);
  const [total, setTotal] = useState(0);
  const [exceptions, setExceptions] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await trpc.paymentAttempts.list.query({
        status: filter === "all" ? undefined : (filter as Status | "exceptions"),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      if (res.success) {
        setRows(res.result.items as AttemptRow[]);
        setTotal(res.result.total);
        setExceptions(res.result.exceptions);
      } else {
        toast.error(res.error ?? "Couldn't load payment attempts");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't load payment attempts");
    } finally {
      setIsLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (row: AttemptRow, action: "retry" | "recheck") => {
    setBusyId(row.id);
    try {
      const res =
        action === "retry"
          ? await trpc.paymentAttempts.retryMaterialization.mutate({ attemptId: row.id })
          : await trpc.paymentAttempts.recheckProvider.mutate({ attemptId: row.id });
      if (!res.success) {
        toast.error(res.error ?? "Action failed");
      } else {
        const result = res.result as { kind?: string; outcome?: { kind: string }; status?: string };
        const kind = result.kind ?? result.outcome?.kind ?? "done";
        toast.success(
          kind === "materialized" || kind === "already_materialized"
            ? "Order exists for this payment."
            : kind === "materialization_failed"
              ? "Payment is recorded, but the order still couldn't be created — see the error."
              : kind === "unchanged"
                ? "Fawaterak doesn't report this as paid."
                : `Result: ${kind}`,
        );
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className='p-4 md:p-6 space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>Payment Attempts</CardTitle>
          <CardDescription>
            Online (Fawaterak) payments. An attempt becomes an order only after the payment is
            verified — unpaid attempts are never orders and never reach fulfillment.
          </CardDescription>
          {exceptions > 0 && (
            <div className='mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800'>
              <AlertTriangle className='h-4 w-4 mt-0.5 shrink-0' />
              <p>
                <span className='font-semibold'>{exceptions}</span> verified payment
                {exceptions === 1 ? "" : "s"} still need{exceptions === 1 ? "s" : ""} attention (paid,
                order not yet created or not yet notified). Retries also run automatically every few
                minutes.
              </p>
            </div>
          )}
          <div className='mt-3 flex items-center gap-2'>
            <Select
              value={filter}
              onValueChange={(v) => {
                setPage(0);
                setFilter(v);
              }}>
              <SelectTrigger className='h-9 w-[220px]'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant='outline' size='sm' className='h-9 gap-1.5' onClick={() => void load()}>
              <RefreshCw className='h-3.5 w-3.5' /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className='py-10 text-center'>
              <Loader2 className='mx-auto h-8 w-8 animate-spin text-muted-foreground' />
            </div>
          ) : rows.length === 0 ? (
            <p className='py-10 text-center text-muted-foreground'>No payment attempts.</p>
          ) : (
            <div className='overflow-x-auto'>
              <Table data-testid='payment-attempts-table'>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Fawaterak reference</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead className='text-right'>Recovery</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const s = STATUS_LABEL[row.status];
                    return (
                      <TableRow key={row.id} className={row.needsAttention ? "bg-red-50/60" : ""}>
                        <TableCell className='text-xs whitespace-nowrap'>{formatDate(row.createdAt)}</TableCell>
                        <TableCell className='text-sm'>
                          <div className='font-medium'>{row.customerName}</div>
                          <div className='text-xs text-muted-foreground'>{row.customerEmail}</div>
                          <div className='text-xs text-muted-foreground'>{row.customerPhone}</div>
                        </TableCell>
                        <TableCell className='whitespace-nowrap'>
                          {Number.parseFloat(row.total).toFixed(2)} {row.currency}
                          {row.promoCode && (
                            <div className='text-xs text-muted-foreground'>promo {row.promoCode}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant='outline' className={`text-[11px] ${s.className}`}>
                            {s.label}
                          </Badge>
                          {row.providerPaymentMethod && (
                            <div className='text-xs text-muted-foreground mt-1'>{row.providerPaymentMethod}</div>
                          )}
                          {row.failureReason && !["paid_pending_materialization", "materialized"].includes(row.status) && (
                            <div className='text-xs text-muted-foreground mt-1 max-w-[220px] break-words'>
                              {row.failureReason}
                            </div>
                          )}
                          {row.providerCheckCount > 0 && (
                            <div className='text-[11px] text-muted-foreground mt-1 max-w-[240px] break-words'>
                              Auto-checked {row.providerCheckCount}× · last {formatDate(row.providerCheckedAt)}
                              {row.providerCheckResult ? ` · ${row.providerCheckResult}` : ""}
                              {row.nextProviderCheckAt && ["pending", "failed"].includes(row.status)
                                ? ` · next ${formatDate(row.nextProviderCheckAt)}`
                                : ""}
                            </div>
                          )}
                          {row.providerCheckError && ["pending", "failed"].includes(row.status) && (
                            <div className='text-[11px] text-amber-700 mt-1 max-w-[240px] break-words'>
                              Last check error: {row.providerCheckError}
                            </div>
                          )}
                          {row.materializationError && (
                            <div className='text-xs text-red-700 mt-1 max-w-[260px] break-words'>
                              Order creation error ({row.materializationAttempts}×): {row.materializationError}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className='font-mono text-xs'>
                          <div>{row.reference}</div>
                          {row.transactionId && <div className='text-muted-foreground'>txn {row.transactionId}</div>}
                          {row.intentKey && (
                            <div className='text-muted-foreground truncate max-w-[160px]' title={row.intentKey}>
                              intent {row.intentKey}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.orderId ? (
                            <div className='space-y-1'>
                              <Link
                                href='/dashboard/orders'
                                className='inline-flex items-center gap-1 font-mono text-xs underline'>
                                {displayOrderNumber({ id: row.orderId, reference: row.reference })}{" "}
                                <ExternalLink className='h-3 w-3' />
                              </Link>
                              {row.orderFulfillmentHold && (
                                <Badge variant='outline' className='bg-red-100 text-red-800 border-red-300 text-[10px]'>
                                  ON HOLD
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className='text-xs text-muted-foreground'>—</span>
                          )}
                        </TableCell>
                        <TableCell className='text-right'>
                          <div className='flex flex-col items-end gap-1'>
                            {row.status === "paid_pending_materialization" && (
                              <Button
                                size='sm'
                                variant='destructive'
                                disabled={busyId === row.id}
                                onClick={() => void act(row, "retry")}>
                                Retry order creation
                              </Button>
                            )}
                            {row.intentKey &&
                              ["pending", "failed", "cancelled", "expired"].includes(row.status) && (
                                <Button
                                  size='sm'
                                  variant='outline'
                                  disabled={busyId === row.id}
                                  onClick={() => void act(row, "recheck")}>
                                  Check with Fawaterak
                                </Button>
                              )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {totalPages > 1 && (
            <div className='mt-4 flex items-center justify-between text-sm'>
              <Button variant='outline' size='sm' disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className='text-muted-foreground'>
                Page {page + 1} of {totalPages} · {total} attempts
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
        </CardContent>
      </Card>
    </div>
  );
}
