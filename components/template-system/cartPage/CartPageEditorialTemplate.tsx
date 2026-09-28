import React, { useRef, useState } from "react";
import { Button } from "#root/components/ui/button";
import { Input } from "#root/components/ui/input";
import { Skeleton } from "#root/components/ui/skeleton";
import {
  Trash2,
  Plus,
  Minus,
  ShoppingBag,
  ArrowRight,
  Tag,
  Gift,
} from "lucide-react";
import type {
  CartPageCartItem,
  CartPageModernTemplateProps,
  CartPageTotals,
} from "./CartPageModernTemplate";
import { EditorialChrome } from "../editorial/EditorialChrome";
import { Reveal } from "../motion/Reveal";
import { StaggerContainer, StaggerItem } from "../motion/Stagger";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

// The promo-code props are shared with the Modern template so pages/cart
// feeds every cart template the same apply result, applied code and notice.
export interface CartPageEditorialTemplateProps
  extends Pick<
    CartPageModernTemplateProps,
    | "onApplyCoupon"
    | "appliedCoupon"
    | "onRemoveCoupon"
    | "couponNotice"
    | "onDismissCouponNotice"
  > {
  items: CartPageCartItem[];
  totals: CartPageTotals;
  isLoading?: boolean;
  isUpdating?: boolean;
  currency?: string;
  onQuantityChange?: (id: string, quantity: number) => void;
  onRemoveItem?: (id: string) => void;
  onProceedToCheckout?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatPrice(v: number, currency = "EGP"): string {
  return `${currency} ${v.toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */

export function CartPageEditorialTemplate({
  items = [],
  totals,
  isLoading = false,
  isUpdating = false,
  currency = "EGP",
  onQuantityChange,
  onRemoveItem,
  onApplyCoupon,
  onProceedToCheckout,
  appliedCoupon,
  onRemoveCoupon,
  couponNotice,
  onDismissCouponNotice,
}: CartPageEditorialTemplateProps) {
  const [couponCode, setCouponCode] = useState("");
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [couponFeedback, setCouponFeedback] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  // State alone can't stop an Enter + click landing in the same tick, before
  // the disabled button has re-rendered.
  const applyInFlight = useRef(false);

  const handleApplyCoupon = async () => {
    const code = couponCode.trim();
    if (!code || !onApplyCoupon || applyInFlight.current) return;

    applyInFlight.current = true;
    setCouponFeedback(null);
    onDismissCouponNotice?.();
    setIsApplyingCoupon(true);
    try {
      const result = await onApplyCoupon(code);
      if (result) {
        setCouponFeedback(result);
        // Only clear the field on success, so a typo stays editable.
        if (result.success) setCouponCode("");
      } else {
        setCouponCode("");
      }
    } catch {
      setCouponFeedback({
        success: false,
        message: "We couldn't apply that promo code. Please try again.",
      });
    } finally {
      applyInFlight.current = false;
      setIsApplyingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setCouponFeedback(null);
    onDismissCouponNotice?.();
    onRemoveCoupon?.();
  };

  /* ---- Loading State ---- */
  if (isLoading) {
    return (
      <div className="min-h-screen bg-stone-50 mach-dark:bg-[var(--mach-ink)]">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-10">
          <Skeleton className="h-8 w-40 rounded mb-10 mach-dark:bg-white/[0.08]" />
          <div className="space-y-6">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="h-28 w-24 shrink-0 rounded-xl mach-dark:bg-white/[0.08]" />
                <div className="flex-1 space-y-3">
                  <Skeleton className="h-4 w-40 rounded mach-dark:bg-white/[0.08]" />
                  <Skeleton className="h-4 w-24 rounded mach-dark:bg-white/[0.08]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ---- Empty State ---- */
  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-stone-50 mach-dark:bg-[var(--mach-ink)]">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-10">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-stone-200 mach-dark:border-white/15 bg-white mach-dark:bg-[var(--mach-ink-soft)] mb-6">
              <ShoppingBag className="h-6 w-6 text-stone-400 mach-dark:text-white/40" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900 mach-dark:text-white">
              Your bag is empty
            </h2>
            <p className="mt-2 text-sm text-stone-500 mach-dark:text-white/55">
              Looks like you haven't added anything yet.
            </p>
            <Button
              className="mt-8 rounded-full px-7 py-5 text-sm tracking-wide"
              onClick={() => {
                window.location.href = "/shop";
              }}
            >
              Continue Shopping
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ---- Cart Content ---- */
  return (
    <EditorialChrome>
    <div className="min-h-screen bg-stone-50 mach-dark:bg-[var(--mach-ink)]">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
        {/* Header */}
        <Reveal variant="fadeUp">
        <div className="mb-10">
          <p className="text-xs tracking-[0.32em] uppercase text-stone-500 mach-dark:text-white/55">
            Shopping
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900 mach-dark:text-white sm:text-4xl">
            Your Bag
          </h1>
          <p className="mt-1 text-sm text-stone-500 mach-dark:text-white/55">
            {items.length} {items.length === 1 ? "item" : "items"}
          </p>
        </div>
        </Reveal>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          {/* -------------------------------------------------------- */}
          {/*  Items List                                               */}
          {/* -------------------------------------------------------- */}
          <StaggerContainer className="lg:col-span-8 space-y-0 divide-y divide-stone-200 mach-dark:divide-white/12">
            {items.map((item) => (
              <StaggerItem key={item.id}>
              <div
                className={`flex gap-4 py-6 first:pt-0 ${isUpdating ? "opacity-60 pointer-events-none" : ""}`}
              >
                {/* Image */}
                <div className="relative h-28 w-24 shrink-0 overflow-hidden rounded-xl bg-stone-200 sm:h-36 sm:w-28">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[9px] tracking-[0.28em] uppercase text-stone-400 mach-dark:text-white/40">
                        No img
                      </span>
                    </div>
                  )}
                </div>

                {/* Details */}
                <div className="flex flex-1 flex-col justify-between min-w-0">
                  <div>
                    <p className="text-sm font-medium text-stone-900 mach-dark:text-white line-clamp-2">
                      {item.name}
                    </p>
                    {item.variant && (
                      <p className="mt-1 text-xs text-stone-500 mach-dark:text-white/55">
                        {item.variant}
                      </p>
                    )}
                    {item.freeQuantity && item.freeQuantity >= item.quantity ? (
                      <p className="mt-1 text-sm font-semibold text-emerald-600 mach-dark:text-emerald-400 uppercase tracking-wide">
                        Free
                      </p>
                    ) : (
                      <p className="mt-1 text-sm font-medium text-stone-900 mach-dark:text-white">
                        {formatPrice(item.price, currency)}
                        {item.freeQuantity != null && item.freeQuantity > 0 && (
                          <span className="ms-2 text-xs font-semibold text-emerald-600 mach-dark:text-emerald-400">
                            ({item.freeQuantity} free)
                          </span>
                        )}
                      </p>
                    )}
                  </div>

                  {/* Controls row */}
                  <div className="mt-3 flex items-center justify-between">
                    {/* Quantity */}
                    <div className="inline-flex items-center rounded-full border border-stone-200 mach-dark:border-white/15 bg-white mach-dark:bg-[var(--mach-ink-soft)]">
                      <button
                        type="button"
                        onClick={() =>
                          onQuantityChange?.(
                            item.id,
                            Math.max(1, item.quantity - 1),
                          )
                        }
                        className="flex h-8 w-8 items-center justify-center text-stone-500 mach-dark:text-white/55 hover:text-stone-900 mach-dark:hover:text-white transition-colors"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-8 text-center text-xs font-medium text-stone-900 mach-dark:text-white">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onQuantityChange?.(item.id, item.quantity + 1)
                        }
                        className="flex h-8 w-8 items-center justify-center text-stone-500 mach-dark:text-white/55 hover:text-stone-900 mach-dark:hover:text-white transition-colors"
                        aria-label="Increase quantity"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => onRemoveItem?.(item.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-stone-400 mach-dark:text-white/40 hover:text-stone-900 mach-dark:hover:text-white hover:bg-stone-100 mach-dark:hover:bg-white/10 transition-colors"
                      aria-label={`Remove ${item.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
              </StaggerItem>
            ))}
          </StaggerContainer>

          {/* -------------------------------------------------------- */}
          {/*  Summary — sticky                                        */}
          {/* -------------------------------------------------------- */}
          <Reveal variant="fadeUp" delay={0.15} className="lg:col-span-4">
            <div className="lg:sticky lg:top-24 rounded-2xl border border-stone-200 mach-dark:border-white/15 bg-white mach-dark:bg-[var(--mach-ink-soft)] p-6">
              <h2 className="text-sm font-medium tracking-[0.2em] uppercase text-stone-500 mach-dark:text-white/55 mb-5">
                Order Summary
              </h2>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between text-stone-600 mach-dark:text-white/65">
                  <span>Subtotal</span>
                  <span>{formatPrice(totals.subtotal, currency)}</span>
                </div>
                {totals.discount != null && totals.discount > 0 && (
                  <div className="flex justify-between text-stone-600 mach-dark:text-white/65">
                    <span>
                      Discount{appliedCoupon ? ` (${appliedCoupon.code})` : ""}
                    </span>
                    <span className="text-green-700 mach-dark:text-emerald-400">
                      −{formatPrice(totals.discount, currency)}
                    </span>
                  </div>
                )}
                {totals.appliedOffers && totals.appliedOffers.map((offer) => (
                  <div key={offer.name} className="flex items-start justify-between gap-2 text-red-600 mach-dark:text-red-400">
                    <span className="flex items-center gap-1.5 font-medium min-w-0">
                      <Gift className="w-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{offer.name}</span>
                    </span>
                    <span className="font-semibold shrink-0">
                      {offer.freeShipping && offer.discountAmount === 0
                        ? "Free shipping"
                        : `−${formatPrice(offer.discountAmount, currency)}`}
                    </span>
                  </div>
                ))}
                {totals.shipping != null && (
                  <div className="flex justify-between text-stone-600 mach-dark:text-white/65">
                    <span>Shipping</span>
                    <span>
                      {totals.shipping === 0
                        ? "Free"
                        : formatPrice(totals.shipping, currency)}
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-4 h-px w-full bg-stone-200 mach-dark:bg-white/12" />

              <div className="mt-4 flex justify-between text-base font-semibold text-stone-900 mach-dark:text-white">
                <span>Total</span>
                <span>{formatPrice(totals.grandTotal, currency)}</span>
              </div>

              {/* Coupon */}
              {onApplyCoupon && (
                <div className="mt-5">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Tag className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400 mach-dark:text-white/40" />
                      <Input
                        type="text"
                        placeholder="Promo code"
                        aria-label="Promo code"
                        value={couponCode}
                        onChange={(e) => {
                          setCouponCode(e.target.value);
                          if (couponFeedback) setCouponFeedback(null);
                        }}
                        className={`h-9 rounded-full ps-9 text-sm ${
                          couponFeedback && !couponFeedback.success
                            ? "border-red-300 mach-dark:border-red-400/60"
                            : "border-stone-200 mach-dark:border-white/25 mach-dark:text-white mach-dark:hover:border-white mach-dark:hover:bg-white/10"
                        }`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleApplyCoupon();
                        }}
                        disabled={isApplyingCoupon}
                        aria-invalid={couponFeedback?.success === false}
                        aria-describedby="promo-code-feedback"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-full px-4 text-xs tracking-wide border-stone-200 mach-dark:border-white/25 mach-dark:text-white mach-dark:hover:border-white mach-dark:hover:bg-white/10"
                      onClick={handleApplyCoupon}
                      disabled={!couponCode.trim() || isApplyingCoupon}
                    >
                      {isApplyingCoupon ? "Checking…" : "Apply"}
                    </Button>
                  </div>

                  <div id="promo-code-feedback" aria-live="polite">
                    {/* A code that stopped being valid on its own (cart
                        edited, code expired between visits, etc.) */}
                    {couponNotice && (
                      <p className="mt-2 rounded-xl border border-amber-100 mach-dark:border-amber-400/25 bg-amber-50 mach-dark:bg-amber-400/10 px-3 py-2 text-xs text-amber-700 mach-dark:text-amber-300">
                        {couponNotice}
                      </p>
                    )}

                    {couponFeedback && (
                      <p
                        className={`mt-2 px-1 text-xs ${
                          couponFeedback.success
                            ? "text-green-700 mach-dark:text-emerald-400"
                            : "text-red-600 mach-dark:text-red-400"
                        }`}
                      >
                        {couponFeedback.message}
                      </p>
                    )}
                  </div>

                  {/* Currently applied code, with a way to take it off */}
                  {appliedCoupon && (
                    <div
                      data-testid="applied-promo-code"
                      className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-green-100 mach-dark:border-emerald-400/25 bg-green-50 mach-dark:bg-emerald-400/10 px-3 py-2"
                    >
                      <p className="min-w-0 text-xs text-green-700 mach-dark:text-emerald-400">
                        <span className="font-semibold tracking-wide">
                          {appliedCoupon.code}
                        </span>
                        {appliedCoupon.discountLabel
                          ? ` — ${appliedCoupon.discountLabel}`
                          : ""}
                      </p>
                      {onRemoveCoupon && (
                        <button
                          type="button"
                          onClick={handleRemoveCoupon}
                          className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-green-700 mach-dark:text-emerald-400 underline underline-offset-2 hover:text-green-900 mach-dark:hover:text-emerald-300"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <Button
                size="lg"
                className="mt-6 w-full rounded-full py-6 text-sm tracking-wide"
                onClick={onProceedToCheckout}
                disabled={isUpdating}
              >
                Proceed to Checkout
                <ArrowRight className="ms-2 h-4 w-4" />
              </Button>

              <button
                type="button"
                onClick={() => {
                  window.location.href = "/shop";
                }}
                className="mt-3 block w-full text-center text-sm text-stone-500 mach-dark:text-white/55 underline underline-offset-4 decoration-stone-500/25 mach-dark:decoration-white/25 hover:decoration-stone-500/50 mach-dark:hover:decoration-white/50 transition-colors"
              >
                Continue Shopping
              </button>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
    </EditorialChrome>
  );
}

CartPageEditorialTemplate.displayName = "CartPageEditorialTemplate";
