"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "#root/components/ui/badge";
import { Button } from "#root/components/ui/button";
import { Link } from "#root/components/utils/Link";
import { trpc } from "#root/shared/trpc/client";

/**
 * Fulfillment-hold UI for the admin Orders page. A held order is a real,
 * PAID order that must not be prepared (e.g. stock ran out while the
 * customer was paying online). Bosta dispatch and status changes toward
 * fulfillment are refused server-side as well — this just makes it obvious.
 */

export function FulfillmentHoldBadge({ hold }: { hold?: string | null }) {
  if (!hold) return null;
  return (
    <Badge
      variant='outline'
      className='bg-red-100 text-red-800 border-red-300 text-[10px] font-semibold leading-tight flex-col items-start'
      title='Paid, but stock ran out — DO NOT PREPARE. Manual review required.'
      data-testid='fulfillment-hold-badge'>
      <span className='whitespace-nowrap'>PAID — STOCK ISSUE</span>
      <span className='whitespace-nowrap'>DO NOT PREPARE</span>
    </Badge>
  );
}

export function FulfillmentHoldPanel({
  orderId,
  hold,
  note,
  internalNotes,
  canRelease,
  onReleased,
  onError,
}: {
  orderId: string;
  hold?: string | null;
  note?: string | null;
  /** order.notes — the only field editable while the order is held. */
  internalNotes?: string | null;
  canRelease: boolean;
  onReleased: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [isReleasing, setIsReleasing] = useState(false);
  const [notes, setNotes] = useState(internalNotes ?? "");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  if (!hold) return null;

  const saveNotes = async () => {
    setIsSavingNotes(true);
    try {
      const res = await trpc.order.edit.mutate({
        orderId,
        notes: notes.trim() === "" ? null : notes,
      });
      if (!res.success) {
        onError(res.error ?? "Couldn't save the notes.");
        return;
      }
      onReleased("Internal notes saved — the order stays on hold.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Couldn't save the notes.");
    } finally {
      setIsSavingNotes(false);
    }
  };

  const release = async () => {
    setIsReleasing(true);
    try {
      const res = await trpc.order.releaseFulfillmentHold.mutate({ orderId });
      if (!res.success) {
        onError(res.error ?? "Couldn't release the hold.");
        return;
      }
      const bosta = res.result.bosta;
      onReleased(
        bosta && bosta.status !== "sent"
          ? `Hold released — stock committed. Bosta: ${bosta.reason}`
          : "Hold released — stock committed, order moved to processing.",
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Couldn't release the hold.");
    } finally {
      setIsReleasing(false);
    }
  };

  return (
    <div
      className='rounded-md border-2 border-red-300 bg-red-50 p-3 text-sm text-red-900 space-y-2'
      data-testid='fulfillment-hold-panel'>
      <div className='flex items-start gap-2'>
        <ShieldAlert className='h-5 w-5 mt-0.5 shrink-0 text-red-700' />
        <div>
          <p className='font-bold tracking-wide'>PAID — STOCK ISSUE</p>
          <p className='font-bold tracking-wide'>DO NOT PREPARE · MANUAL REVIEW REQUIRED</p>
          {note && <p className='mt-1 text-red-800'>{note}</p>}
          <p className='mt-1 text-xs text-red-700'>
            The customer has already paid. Restock and release the hold to ship it, or cancel the
            order and refund the customer through Fawaterak.
          </p>
        </div>
      </div>
      {canRelease && (
        <Button size='sm' variant='destructive' onClick={release} disabled={isReleasing}>
          {isReleasing && <Loader2 className='h-3.5 w-3.5 mr-1.5 animate-spin' />}
          Release hold (stock is available)
        </Button>
      )}
      {canRelease && (
        <div className='space-y-1.5 pt-1'>
          <label htmlFor={`hold-notes-${orderId}`} className='text-xs font-medium text-red-900'>
            Internal notes (the only thing editable while held)
          </label>
          <textarea
            id={`hold-notes-${orderId}`}
            data-testid='hold-notes'
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className='w-full rounded-md border border-red-200 bg-white p-2 text-sm text-stone-900'
            placeholder='e.g. Called customer, waiting for restock on Thursday'
          />
          <Button size='sm' variant='outline' onClick={saveNotes} disabled={isSavingNotes}>
            {isSavingNotes && <Loader2 className='h-3.5 w-3.5 mr-1.5 animate-spin' />}
            Save notes
          </Button>
        </div>
      )}
    </div>
  );
}

/** Banner: verified online payments that don't have their order yet. */
export function PaidWithoutOrderBanner({ enabled }: { enabled: boolean }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    trpc.paymentAttempts.exceptionCount
      .query()
      .then((res) => {
        if (!cancelled && res.success) setCount(res.result.paidWithoutOrder);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled || count === 0) return null;
  return (
    <div className='flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 mb-4'>
      <AlertTriangle className='h-4 w-4 mt-0.5 shrink-0' />
      <p>
        {count} verified online payment{count === 1 ? " has" : "s have"} no order yet.{" "}
        <Link href='/dashboard/payment-attempts?status=exceptions' className='font-semibold underline'>
          Review in Payment Attempts
        </Link>
      </p>
    </div>
  );
}
