"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "#root/components/utils/Link";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Home,
  Loader2,
  Package,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";
import { Button } from "#root/components/ui/button";
import { useTracking } from "#root/frontend/contexts/TrackingContext";
import { TrackingEventName } from "#root/shared/types/pixel-tracking";
import { STORE_CURRENCY } from "#root/shared/config/branding";
import { useCart } from "#root/lib/context/CartContext";
import { trpc } from "#root/shared/trpc/client";
import { displayOrderNumber } from "#root/shared/orders/order-reference";

/**
 * Return page for the payment-attempt-first online checkout
 * (/order-confirmation?attempt=<id>&payment=…).
 *
 * The redirect is never trusted: the server is asked what the attempt became
 * (it verifies with Fawaterak and creates the order if paid). An order number
 * is shown only once a real order exists; a payment that didn't complete is
 * never called an order, and the cart is kept for a retry.
 */

type AttemptStatus =
  | "created"
  | "session_failed"
  | "pending"
  | "failed"
  | "cancelled"
  | "expired"
  | "paid_pending_materialization"
  | "materialized";

interface AttemptView {
  status: AttemptStatus;
  amount: string;
  order: {
    id: string;
    reference?: string | null;
    total: string;
    customerEmail: string;
    onHold: boolean;
  } | null;
}

type View =
  | { kind: "loading" }
  | { kind: "confirmed"; order: NonNullable<AttemptView["order"]> }
  | { kind: "paid_processing" }
  | { kind: "awaiting"; timedOut: boolean }
  | { kind: "not_completed" }
  | { kind: "error" };

const POLL_MS = 4000;
const POLL_FOR_MS = 60_000;
const UNPAID_FINAL: AttemptStatus[] = ["failed", "cancelled", "expired", "session_failed"];

function toView(data: AttemptView, returnedAs: string | null, timedOut: boolean): View {
  if (data.status === "materialized" && data.order) return { kind: "confirmed", order: data.order };
  if (data.status === "paid_pending_materialization" || data.status === "materialized") {
    return { kind: "paid_processing" };
  }
  // Not paid (yet). The hosted page sent the customer back as failed or
  // cancelled, or the provider already reported a final unpaid outcome.
  if (returnedAs === "failed" || returnedAs === "cancelled" || UNPAID_FINAL.includes(data.status)) {
    return { kind: "not_completed" };
  }
  return { kind: "awaiting", timedOut };
}

export function AttemptConfirmation({
  attemptId,
  returnedAs,
}: {
  attemptId: string;
  returnedAs: string | null;
}) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const { trackEvent } = useTracking();
  const { clearCart } = useCart();
  const trackedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: number | undefined;
    let timedOut = false;

    const stop = () => {
      if (interval) window.clearInterval(interval);
      interval = undefined;
    };

    const check = async () => {
      try {
        const res = await trpc.payment.attemptStatus.query({ attemptId });
        if (cancelled) return;
        if (!res.success) {
          setView({ kind: "error" });
          stop();
          return;
        }
        const next = toView(res.result as AttemptView, returnedAs, timedOut);
        setView(next);
        if (next.kind === "confirmed" || next.kind === "not_completed") stop();
      } catch {
        /* transient — keep polling */
      }
    };

    void check();
    // Keep asking while the outcome is open — each check also retries order
    // creation for a verified payment.
    interval = window.setInterval(check, POLL_MS);
    const timeout = window.setTimeout(() => {
      timedOut = true;
      stop();
      setView((v) => (v.kind === "awaiting" ? { kind: "awaiting", timedOut: true } : v));
    }, POLL_FOR_MS);

    return () => {
      cancelled = true;
      stop();
      window.clearTimeout(timeout);
    };
  }, [attemptId, returnedAs]);

  // Payment verified → this checkout is done; clear the cart this attempt
  // came from (only if this browser started it).
  const paymentVerified = view.kind === "confirmed" || view.kind === "paid_processing";
  useEffect(() => {
    if (!paymentVerified) return;
    try {
      const key = `pending_cart_clear:attempt:${attemptId}`;
      if (sessionStorage.getItem(key)) {
        clearCart();
        sessionStorage.removeItem(key);
      }
    } catch {
      /* best-effort */
    }
  }, [paymentVerified, attemptId, clearCart]);

  // Purchase — only for a real order, once per order.
  const confirmedOrder = view.kind === "confirmed" ? view.order : null;
  useEffect(() => {
    if (!confirmedOrder) return;
    if (trackedRef.current === confirmedOrder.id) return;
    const storageKey = `tracked_checkout_completed:${confirmedOrder.id}`;
    try {
      if (sessionStorage.getItem(storageKey)) return;
    } catch {
      /* fall through to ref guard */
    }
    trackedRef.current = confirmedOrder.id;
    try {
      sessionStorage.setItem(storageKey, "1");
    } catch {
      /* best-effort */
    }

    let purchaseItems:
      | { itemId: string; itemName: string; price?: number; quantity?: number; category?: string }[]
      | undefined;
    try {
      const raw = sessionStorage.getItem(`checkout_items:attempt:${attemptId}`);
      if (raw) {
        purchaseItems = JSON.parse(raw);
        sessionStorage.removeItem(`checkout_items:attempt:${attemptId}`);
      }
    } catch {
      /* best-effort */
    }

    trackEvent(TrackingEventName.CHECKOUT_COMPLETED, {
      ecommerce: {
        currency: STORE_CURRENCY,
        value: Number.parseFloat(confirmedOrder.total),
        transactionId: confirmedOrder.id,
        items: purchaseItems,
      },
    });
  }, [confirmedOrder, attemptId, trackEvent]);

  return (
    <div className='min-h-screen bg-gray-50 mach-dark:bg-[var(--mach-ink)] flex items-center justify-center px-4 py-16'>
      <div
        className='max-w-2xl w-full bg-white mach-dark:bg-[var(--mach-ink-soft)] rounded-2xl shadow-sm border border-gray-100 mach-dark:border-white/10 text-center flex flex-col'
        style={{ padding: "2rem 2rem 3.5rem" }}
        data-testid='attempt-confirmation'
        data-state={view.kind}>
        {view.kind === "loading" && (
          <>
            <Loader2 className='mx-auto w-10 h-10 animate-spin text-gray-400 mb-6' />
            <h1 className='text-2xl font-semibold text-gray-900 mach-dark:text-white mb-2'>
              Checking your payment…
            </h1>
          </>
        )}

        {view.kind === "confirmed" && (
          <>
            <div className='mx-auto w-16 h-16 bg-green-100 mach-dark:bg-green-400/15 rounded-full flex items-center justify-center mb-6'>
              <CheckCircle className='w-8 h-8 text-green-600 mach-dark:text-green-400' />
            </div>
            <h1 className='text-2xl md:text-3xl font-semibold text-gray-900 mach-dark:text-white mb-2'>
              {view.order.onHold ? "Payment Received" : "Order Confirmed!"}
            </h1>
            <p className='text-gray-500 mach-dark:text-white/55 mb-6'>
              {view.order.onHold
                ? "Your payment was received and your order has been created. Our team needs to review it before it can be prepared — we'll contact you about your order."
                : "Thank you for your purchase. Payment received and your order has been placed."}
            </p>
            <div className='bg-gray-50 mach-dark:bg-[var(--mach-ink)] rounded-xl p-6 mb-8 text-left space-y-3 overflow-x-auto'>
              <Row label='Order Number'>
                <span className='font-mono font-medium' data-testid='order-number'>
                  {displayOrderNumber(view.order)}
                </span>
              </Row>
              <Row label='Total'>
                <span className='font-semibold'>{Number.parseFloat(view.order.total).toFixed(2)} EGP</span>
              </Row>
              {!view.order.onHold && (
                <Row label='Confirmation sent to'>
                  <span className='whitespace-nowrap'>{view.order.customerEmail}</span>
                </Row>
              )}
              <Row label='Status'>
                <span className='inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 mach-dark:text-amber-300 bg-amber-50 mach-dark:bg-amber-400/10 px-2.5 py-0.5 rounded-full'>
                  <Package className='w-3.5 h-3.5' />
                  {view.order.onHold ? "Under review" : "Processing"}
                </span>
              </Row>
            </div>
          </>
        )}

        {view.kind === "paid_processing" && (
          <>
            <div className='mx-auto w-16 h-16 bg-green-100 mach-dark:bg-green-400/15 rounded-full flex items-center justify-center mb-6'>
              <CheckCircle className='w-8 h-8 text-green-600 mach-dark:text-green-400' />
            </div>
            <h1 className='text-2xl md:text-3xl font-semibold text-gray-900 mach-dark:text-white mb-2'>
              Payment Received
            </h1>
            <p className='text-gray-500 mach-dark:text-white/55 mb-6'>
              We received your payment and we're confirming your order. You'll get an email
              as soon as your order is confirmed.
            </p>
          </>
        )}

        {view.kind === "awaiting" && (
          <>
            <div className='mx-auto w-16 h-16 bg-amber-100 mach-dark:bg-amber-400/15 rounded-full flex items-center justify-center mb-6'>
              <Clock className='w-8 h-8 text-amber-600 mach-dark:text-amber-400' />
            </div>
            <h1 className='text-2xl md:text-3xl font-semibold text-gray-900 mach-dark:text-white mb-2'>
              Payment Not Confirmed Yet
            </h1>
            <p className='text-gray-500 mach-dark:text-white/55 mb-6'>
              {view.timedOut
                ? "We haven't received confirmation of this payment yet. If you completed the payment, your order will be created automatically once it's confirmed and you'll receive an email."
                : "We're waiting for confirmation from the payment provider. This page updates automatically."}
            </p>
          </>
        )}

        {view.kind === "not_completed" && (
          <>
            <div className='mx-auto w-16 h-16 bg-red-100 mach-dark:bg-red-400/15 rounded-full flex items-center justify-center mb-6'>
              <AlertTriangle className='w-8 h-8 text-red-600 mach-dark:text-red-400' />
            </div>
            <h1 className='text-2xl md:text-3xl font-semibold text-amber-900 mach-dark:text-amber-300 mb-2'>
              Payment Wasn't Completed
            </h1>
            <p className='text-gray-500 mach-dark:text-white/55 mb-6'>
              No order was placed. Your cart is still saved — you can try again whenever you're ready.
            </p>
            <div className='flex justify-center mb-2'>
              <Button asChild className='gap-2 text-white'>
                <Link href='/checkout'>
                  <ShoppingCart className='w-4 h-4' />
                  <span className='text-xs md:text-sm'>Return to Checkout</span>
                </Link>
              </Button>
            </div>
          </>
        )}

        {view.kind === "error" && (
          <>
            <h1 className='text-2xl font-semibold text-gray-900 mach-dark:text-white mb-2'>
              We couldn't find this payment
            </h1>
            <p className='text-gray-500 mach-dark:text-white/55 mb-6'>
              If you completed a payment, you'll receive an email once your order is confirmed.
            </p>
          </>
        )}

        <div className='flex flex-col sm:flex-row gap-3 justify-center mt-6'>
          <Button asChild variant='outline' className='gap-2'>
            <Link href='/'>
              <Home className='w-4 h-4' />
              <span className='text-xs md:text-sm'>Back to Home</span>
            </Link>
          </Button>
          <Button asChild className='gap-2 text-white'>
            <Link href='/shop'>
              <ShoppingBag className='w-4 h-4' />
              <span className='text-xs md:text-sm'>Continue Shopping</span>
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex justify-between items-center flex-wrap gap-2'>
      <span className='text-sm text-gray-500 mach-dark:text-white/55'>{label}</span>
      <span className='text-sm text-gray-900 mach-dark:text-white'>{children}</span>
    </div>
  );
}
