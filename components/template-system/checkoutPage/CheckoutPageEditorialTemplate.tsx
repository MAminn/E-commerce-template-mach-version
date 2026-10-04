import React, { useRef, useState } from "react";
import { Button } from "#root/components/ui/button";
import { Input } from "#root/components/ui/input";
import { CityCombobox } from "#root/components/checkout/CityCombobox";
import {
  BostaShippingFields,
  type BostaShippingSelection,
} from "#root/components/checkout/BostaShippingFields";
import { Skeleton } from "#root/components/ui/skeleton";
import { Alert, AlertDescription } from "#root/components/ui/alert";
import { AlertCircle, Loader2, Shield, ChevronLeft, ChevronDown, ShoppingBag, Tag } from "lucide-react";
import { cn } from "#root/lib/utils";
import type {
  CheckoutCustomerInfo,
  CheckoutAddress,
  CheckoutOrderSummaryItem,
  CheckoutTotals,
  PaymentMethodOption,
  CheckoutPageModernTemplateProps,
} from "./CheckoutPageModernTemplate";
import { EditorialChrome } from "../editorial/EditorialChrome";
import { Reveal } from "../motion/Reveal";
import { StaggerContainer, StaggerItem } from "../motion/Stagger";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

// The promo-code props are shared with the cart templates (via the Modern
// checkout props) so pages/checkout feeds them from the same CartContext
// promo state as pages/cart — one applied code, two places to enter it.
export interface CheckoutPageEditorialTemplateProps
  extends Pick<
    CheckoutPageModernTemplateProps,
    | "onApplyCoupon"
    | "appliedCoupon"
    | "onRemoveCoupon"
    | "couponNotice"
    | "onDismissCouponNotice"
  > {
  customer?: CheckoutCustomerInfo;
  shippingAddress?: CheckoutAddress;
  billingAddress?: CheckoutAddress;
  items: CheckoutOrderSummaryItem[];
  totals: CheckoutTotals;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onSubmit?: (formValues: Record<string, string>) => void | Promise<void>;
  onEditCart?: () => void;
  currency?: string;
  paymentMethods?: PaymentMethodOption[];
  paymentMethodsLoading?: boolean;
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

export function CheckoutPageEditorialTemplate({
  customer,
  shippingAddress,
  items = [],
  totals,
  isSubmitting = false,
  errorMessage,
  onSubmit,
  onEditCart,
  currency = "EGP",
  paymentMethods,
  paymentMethodsLoading = false,
  onApplyCoupon,
  appliedCoupon,
  onRemoveCoupon,
  couponNotice,
  onDismissCouponNotice,
}: CheckoutPageEditorialTemplateProps) {
  /* Internal form state — field names match the Modern template so
     pages/checkout/+Page.tsx's submit handler works for either template. */
  const [formValues, setFormValues] = useState<Record<string, string>>({
    fullName: customer?.name ?? "",
    email: customer?.email ?? "",
    phoneNumber: customer?.phone ?? "",
    address: shippingAddress?.line1 ?? "",
    buildingNumber: "",
    apartment: "",
    city: shippingAddress?.city ?? "",
    state: shippingAddress?.state ?? "",
    // Egypt-only store — no country field shown, always submitted as-is.
    country: "Egypt",
    paymentMethod: paymentMethods?.[0]?.id ?? "cod",
    notes: "",
    // Exact Bosta district (only when the Bosta picker is active).
    bostaDistrictId: "",
    // "1" while the Bosta picker is shown — a district is then mandatory.
    bostaRequired: "",
  });
  const [bostaSelection, setBostaSelection] =
    useState<BostaShippingSelection | null>(null);
  const [bostaError, setBostaError] = useState<string | undefined>(undefined);

  const updateField = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formValues.bostaRequired === "1" && !formValues.bostaDistrictId) {
      setBostaError("Please select your governorate, area and district");
      document
        .getElementById("bostaCity")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    onSubmit?.(formValues);
  };

  /* Promo code — only what's typed and the last apply result live here. The
     applied code, its validation and the discount are CartContext's, the
     same state the cart's promo box drives. Shared by the desktop and
     mobile summaries so both always show the same thing. */
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

  /* Pill-style input classes */
  const inputCls =
    "h-11 rounded-full border-stone-200 mach-dark:border-white/15 bg-white mach-dark:bg-[var(--mach-ink-soft)] text-sm px-5 focus-visible:ring-2 focus-visible:ring-stone-900/15 mach-dark:focus-visible:ring-white/25 focus-visible:ring-offset-0";

  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const cartQuantity = items.reduce((s, i) => s + i.quantity, 0);
  const originalCartTotal = items.reduce(
    (s, i) => s + (i.originalPrice ?? i.price) * i.quantity,
    0,
  );
  const originalTotal = originalCartTotal + (totals.shipping ?? 0);
  const hasDiscount = originalTotal > totals.grandTotal + 0.001;

  // Shared item rows — used by both the desktop card and the mobile expanded panel
  const renderItemsList = () => (
    <div className='space-y-4 max-h-60 overflow-y-auto'>
      {items.map((item) => (
        <div key={item.id} className='flex justify-between gap-3'>
          <div className='flex-1 min-w-0'>
            <p className='text-sm text-stone-900 mach-dark:text-white line-clamp-1'>
              {item.name}
            </p>
            {item.variant && (
              <p className='text-xs text-stone-400 mach-dark:text-white/40'>{item.variant}</p>
            )}
            <p className='text-xs text-stone-500 mach-dark:text-white/55'>Qty: {item.quantity}</p>
          </div>
          <div className='text-right shrink-0'>
            {item.originalPrice != null &&
              item.originalPrice > item.price && (
                <p className='text-xs text-stone-400 mach-dark:text-white/40 line-through'>
                  {formatPrice(item.originalPrice * item.quantity, currency)}
                </p>
              )}
            <p className='text-sm font-medium text-stone-900 mach-dark:text-white'>
              {formatPrice(item.price * item.quantity, currency)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );

  // Shared totals breakdown — used by both the desktop card and the mobile expanded panel
  const renderTotalsBreakdown = () => (
    <div className='mt-4 space-y-3 text-sm'>
      <div className='flex justify-between text-stone-600 mach-dark:text-white/65'>
        <span>Subtotal</span>
        <span>{formatPrice(totals.subtotal, currency)}</span>
      </div>
      {totals.discount != null && totals.discount > 0 && (
        <div className='flex justify-between text-stone-600 mach-dark:text-white/65'>
          <span>
            Discount{appliedCoupon ? ` (${appliedCoupon.code})` : ""}
          </span>
          <span className='text-green-700 mach-dark:text-emerald-400'>
            −{formatPrice(totals.discount, currency)}
          </span>
        </div>
      )}
      {totals.appliedOffers &&
        totals.appliedOffers.map((offer) => (
          <div
            key={offer.name}
            className='flex items-start justify-between gap-2 text-red-600 mach-dark:text-red-400'>
            <span className='flex items-center gap-1 font-medium min-w-0'>
              🎁 <span className='truncate'>{offer.name}</span>
            </span>
            <span className='font-semibold shrink-0'>
              {offer.freeShipping && offer.discountAmount === 0
                ? "Free shipping"
                : `−${formatPrice(offer.discountAmount, currency)}`}
            </span>
          </div>
        ))}
      {totals.shipping != null && (
        <div className='flex justify-between text-stone-600 mach-dark:text-white/65'>
          <span>Shipping</span>
          <span>
            {totals.shipping === 0
              ? "Free"
              : formatPrice(totals.shipping, currency)}
          </span>
        </div>
      )}
    </div>
  );

  // Promo code box — rendered in both the desktop card and the mobile summary
  // (only one is visible at a time), so ids are prefixed per placement.
  const renderPromoCode = (placement: "desktop" | "mobile") => {
    const feedbackId = `${placement}-promo-code-feedback`;
    return (
      <div data-testid={`${placement}-promo-code`}>
        <p className='text-xs font-medium tracking-[0.2em] uppercase text-stone-500 mach-dark:text-white/55'>
          Promo Code
        </p>

        {appliedCoupon ? (
          // One code at a time: while one is on, the box shows it instead of
          // an input — removing it brings the input back.
          <div
            data-testid='applied-promo-code'
            className='mt-2 flex items-center justify-between gap-3 rounded-xl border border-green-100 mach-dark:border-emerald-400/25 bg-green-50 mach-dark:bg-emerald-400/10 px-3 py-2'>
            <p className='min-w-0 text-xs text-green-700 mach-dark:text-emerald-400'>
              <span className='font-semibold tracking-wide'>
                {appliedCoupon.code}
              </span>
              {appliedCoupon.discountLabel
                ? ` — ${appliedCoupon.discountLabel}`
                : ""}
              {totals.discount != null && totals.discount > 0 && (
                <span className='block'>
                  You save {formatPrice(totals.discount, currency)}
                </span>
              )}
            </p>
            {onRemoveCoupon && (
              <button
                type='button'
                onClick={handleRemoveCoupon}
                aria-label={`Remove promo code ${appliedCoupon.code}`}
                className='shrink-0 text-[11px] font-medium uppercase tracking-wide text-green-700 mach-dark:text-emerald-400 underline underline-offset-2 hover:text-green-900 mach-dark:hover:text-emerald-300'>
                Remove
              </button>
            )}
          </div>
        ) : (
          <div className='mt-2 flex gap-2'>
            <div className='relative min-w-0 flex-1'>
              <Tag className='absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400 mach-dark:text-white/40' />
              <Input
                type='text'
                placeholder='Enter promo code'
                aria-label='Promo code'
                autoComplete='off'
                autoCapitalize='characters'
                spellCheck={false}
                enterKeyHint='done'
                value={couponCode}
                onChange={(e) => {
                  setCouponCode(e.target.value);
                  if (couponFeedback) setCouponFeedback(null);
                }}
                onKeyDown={(e) => {
                  // The promo box sits inside the order form: Enter must
                  // apply the code, never place the order.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleApplyCoupon();
                  }
                }}
                disabled={isApplyingCoupon}
                aria-invalid={couponFeedback?.success === false}
                aria-describedby={feedbackId}
                className={cn(
                  "h-10 rounded-full ps-9 text-sm mach-dark:text-white",
                  couponFeedback && !couponFeedback.success
                    ? "border-red-300 mach-dark:border-red-400/60"
                    : "border-stone-200 mach-dark:border-white/25",
                )}
              />
            </div>
            <Button
              type='button'
              variant='outline'
              className='h-10 shrink-0 rounded-full px-5 text-xs tracking-wide border-stone-200 mach-dark:border-white/25 mach-dark:text-white mach-dark:hover:border-white mach-dark:hover:bg-white/10'
              onClick={handleApplyCoupon}
              disabled={!couponCode.trim() || isApplyingCoupon}>
              {isApplyingCoupon ? "Checking…" : "Apply"}
            </Button>
          </div>
        )}

        <div id={feedbackId} aria-live='polite'>
          {/* A code that stopped being valid on its own (cart edited, code
              expired between visits, etc.) */}
          {couponNotice && (
            <p className='mt-2 rounded-xl border border-amber-100 mach-dark:border-amber-400/25 bg-amber-50 mach-dark:bg-amber-400/10 px-3 py-2 text-xs text-amber-700 mach-dark:text-amber-300'>
              {couponNotice}
            </p>
          )}
          {couponFeedback && (
            <p
              className={cn(
                "mt-2 px-1 text-xs",
                couponFeedback.success
                  ? "text-green-700 mach-dark:text-emerald-400"
                  : "text-red-600 mach-dark:text-red-400",
              )}>
              {couponFeedback.message}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <EditorialChrome>
      <div className='min-h-screen bg-stone-50 mach-dark:bg-[var(--mach-ink)]'>
        <div className='mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-10'>
          {/* Header */}
          <Reveal variant='fadeUp'>
            <div className='mb-10 flex items-center justify-between'>
              <div>
                <p className='text-xs tracking-[0.32em] uppercase text-stone-500 mach-dark:text-white/55'>
                  Checkout
                </p>
                <h1 className='mt-2 text-3xl font-semibold tracking-tight text-stone-900 mach-dark:text-white sm:text-4xl'>
                  Complete Your Order
                </h1>
              </div>
              {onEditCart && (
                <button
                  type='button'
                  onClick={onEditCart}
                  className='inline-flex items-center gap-1 text-sm text-stone-500 mach-dark:text-white/55 hover:text-stone-900 mach-dark:hover:text-white transition-colors'>
                  <ChevronLeft className='h-3.5 w-3.5' />
                  Edit Bag
                </button>
              )}
            </div>
          </Reveal>

          {/* Error */}
          {errorMessage && (
            <Alert variant='destructive' className='mb-8 rounded-xl'>
              <AlertCircle className='h-4 w-4' />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <div className='grid grid-cols-1 gap-10 lg:grid-cols-12'>
              {/* ====================================================== */}
              {/*  LEFT — Form                                            */}
              {/* ====================================================== */}
              <StaggerContainer className='lg:col-span-7 space-y-8'>
                {/* Customer Info */}
                <StaggerItem>
                  <section className='rounded-2xl border border-stone-200 mach-dark:border-white/15 bg-white mach-dark:bg-[var(--mach-ink-soft)] p-6'>
                    <h2 className='text-sm font-medium tracking-[0.2em] uppercase text-stone-500 mach-dark:text-white/55 mb-5'>
                      Contact Information
                    </h2>
                    <div className='space-y-4'>
                      <div>
                        <Input
                          id='checkout-name'
                          name='name'
                          autoComplete='name'
                          required
                          value={formValues.fullName}
                          onChange={(e) => updateField("fullName", e.target.value)}
                          className={inputCls}
                          placeholder='Full Name'
                        />
                      </div>
                      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                        <div>
                          <Input
                            id='checkout-email'
                            name='email'
                            type='email'
                            autoComplete='email'
                            required
                            value={formValues.email}
                            onChange={(e) =>
                              updateField("email", e.target.value)
                            }
                            className={inputCls}
                            placeholder='Email'
                          />
                        </div>
                        <div>
                          <Input
                            id='checkout-phone'
                            name='tel'
                            type='tel'
                            autoComplete='tel'
                            value={formValues.phoneNumber}
                            onChange={(e) =>
                              updateField("phoneNumber", e.target.value)
                            }
                            className={inputCls}
                            placeholder='Phone Number'
                          />
                        </div>
                      </div>
                    </div>
                  </section>
                </StaggerItem>

                {/* Shipping Address */}
                <StaggerItem>
                  <section className='rounded-2xl border border-stone-200 mach-dark:border-white/15 bg-white mach-dark:bg-[var(--mach-ink-soft)] p-6'>
                    <h2 className='text-sm font-medium tracking-[0.2em] uppercase text-stone-500 mach-dark:text-white/55 mb-5'>
                      Shipping Address
                    </h2>
                    <div className='space-y-4'>
                      <div>
                        <Input
                          id='checkout-address1'
                          name='address-line1'
                          autoComplete='address-line1'
                          required
                          value={formValues.address}
                          onChange={(e) =>
                            updateField("address", e.target.value)
                          }
                          className={inputCls}
                          placeholder='Street Address'
                        />
                      </div>
                      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                        <div>
                          <Input
                            id='checkout-building'
                            name='address-line2'
                            autoComplete='address-line2'
                            value={formValues.buildingNumber}
                            onChange={(e) =>
                              updateField("buildingNumber", e.target.value)
                            }
                            className={inputCls}
                            placeholder='Building Number'
                          />
                        </div>
                        <div>
                          <Input
                            id='checkout-apartment'
                            value={formValues.apartment}
                            onChange={(e) =>
                              updateField("apartment", e.target.value)
                            }
                            className={inputCls}
                            placeholder='Apartment / Unit'
                          />
                        </div>
                      </div>
                      <BostaShippingFields
                        value={bostaSelection}
                        error={bostaError}
                        onAvailabilityChange={(available) =>
                          updateField("bostaRequired", available ? "1" : "")
                        }
                        onChange={(selection) => {
                          setBostaSelection(selection);
                          if (selection) {
                            setBostaError(undefined);
                            updateField("bostaDistrictId", selection.districtId);
                            updateField("state", selection.city);
                            updateField(
                              "city",
                              selection.zone === selection.districtName
                                ? selection.districtName
                                : `${selection.zone} / ${selection.districtName}`,
                            );
                          } else {
                            updateField("bostaDistrictId", "");
                          }
                        }}
                        fallback={
                          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                            <div>
                              <Input
                                id='checkout-city'
                                name='address-level2'
                                autoComplete='address-level2'
                                required
                                value={formValues.city}
                                onChange={(e) =>
                                  updateField("city", e.target.value)
                                }
                                className={inputCls}
                                placeholder='City'
                              />
                            </div>
                            <div>
                              <CityCombobox
                                id='checkout-state'
                                name='address-level1'
                                autoComplete='address-level1'
                                value={formValues.state}
                                onChange={(v) => updateField("state", v)}
                                className={inputCls}
                                placeholder='Governorate'
                              />
                            </div>
                          </div>
                        }
                      />
                    </div>
                  </section>
                </StaggerItem>

                {/* Payment Method */}
                <StaggerItem>
                  <section className='rounded-2xl border border-stone-200 mach-dark:border-white/15 bg-white mach-dark:bg-[var(--mach-ink-soft)] p-6'>
                    <h2 className='text-sm font-medium tracking-[0.2em] uppercase text-stone-500 mach-dark:text-white/55 mb-5'>
                      Payment Method
                    </h2>
                    {paymentMethodsLoading ? (
                      <div className='space-y-3'>
                        <Skeleton className='h-12 w-full rounded-xl mach-dark:bg-white/[0.08]' />
                        <Skeleton className='h-12 w-full rounded-xl mach-dark:bg-white/[0.08]' />
                      </div>
                    ) : paymentMethods && paymentMethods.length > 0 ? (
                      <div className='space-y-2'>
                        {paymentMethods.map((pm) => (
                          <label
                            key={pm.id}
                            className={`flex cursor-pointer items-center gap-4 rounded-xl border px-5 py-4 transition-colors ${
                              formValues.paymentMethod === pm.id
                                ? "border-stone-900 mach-dark:border-white bg-stone-50 mach-dark:bg-[var(--mach-ink)]"
                                : "border-stone-200 mach-dark:border-white/15 bg-white mach-dark:bg-[var(--mach-ink-soft)] hover:border-stone-300 mach-dark:hover:border-white/40"
                            }`}>
                            <input
                              type='radio'
                              name='paymentMethod'
                              value={pm.id}
                              checked={formValues.paymentMethod === pm.id}
                              onChange={(e) =>
                                updateField("paymentMethod", e.target.value)
                              }
                              className='h-4 w-4 border-stone-300 mach-dark:border-white/30 text-stone-900 mach-dark:text-white mach-dark:accent-white focus:ring-stone-900/20 mach-dark:focus:ring-white/30'
                            />
                            <div className='flex-1'>
                              <p className='text-sm font-medium text-stone-900 mach-dark:text-white'>
                                {pm.label}
                              </p>
                              {pm.description && (
                                <p className='text-xs text-stone-500 mach-dark:text-white/55'>
                                  {pm.description}
                                </p>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <label className='flex cursor-pointer items-center gap-4 rounded-xl border border-stone-900 mach-dark:border-white bg-stone-50 mach-dark:bg-[var(--mach-ink)] px-5 py-4'>
                        <input
                          type='radio'
                          name='paymentMethod'
                          value='cod'
                          checked
                          readOnly
                          className='h-4 w-4 border-stone-300 mach-dark:border-white/30 text-stone-900 mach-dark:text-white mach-dark:accent-white'
                        />
                        <div>
                          <p className='text-sm font-medium text-stone-900 mach-dark:text-white'>
                            Cash on Delivery
                          </p>
                          <p className='text-xs text-stone-500 mach-dark:text-white/55'>
                            Pay when you receive your order
                          </p>
                        </div>
                      </label>
                    )}
                  </section>
                </StaggerItem>

                {/* Order Notes */}
                <StaggerItem>
                  <section className='rounded-2xl border border-stone-200 mach-dark:border-white/15 bg-white mach-dark:bg-[var(--mach-ink-soft)] p-6'>
                    <h2 className='text-sm font-medium tracking-[0.2em] uppercase text-stone-500 mach-dark:text-white/55 mb-5'>
                      Order Notes (Optional)
                    </h2>
                    <textarea
                      value={formValues.notes}
                      onChange={(e) => updateField("notes", e.target.value)}
                      placeholder='Any special instructions…'
                      rows={3}
                      className='w-full rounded-xl border border-stone-200 mach-dark:border-white/15 bg-white mach-dark:bg-[var(--mach-ink-soft)] p-4 text-sm text-stone-900 mach-dark:text-white placeholder:text-stone-400 mach-dark:placeholder:text-white/40 resize-none focus:outline-none focus:ring-2 focus:ring-stone-900/15 mach-dark:focus:ring-white/25'
                    />
                  </section>
                </StaggerItem>
              </StaggerContainer>

              {/* ====================================================== */}
              {/*  RIGHT — Order Summary                                  */}
              {/* ====================================================== */}
              <Reveal
                variant='fadeUp'
                delay={0.2}
                className='lg:col-span-5 space-y-3'>
                {/* Desktop: full itemized card */}
                <div className='hidden lg:block lg:sticky lg:top-24 rounded-2xl border border-stone-200 mach-dark:border-white/15 bg-white mach-dark:bg-[var(--mach-ink-soft)] p-6'>
                  <h2 className='text-sm font-medium tracking-[0.2em] uppercase text-stone-500 mach-dark:text-white/55 mb-5'>
                    Order Summary
                  </h2>

                  {renderItemsList()}

                  <div className='mt-5 h-px w-full bg-stone-200 mach-dark:bg-white/12' />

                  {onApplyCoupon && (
                    <>
                      <div className='mt-5'>{renderPromoCode("desktop")}</div>
                      <div className='mt-5 h-px w-full bg-stone-200 mach-dark:bg-white/12' />
                    </>
                  )}

                  {renderTotalsBreakdown()}

                  <div className='mt-4 h-px w-full bg-stone-200 mach-dark:bg-white/12' />

                  <div className='mt-4 flex justify-between text-base font-semibold text-stone-900 mach-dark:text-white'>
                    <span>Total</span>
                    <span>{formatPrice(totals.grandTotal, currency)}</span>
                  </div>

                  {/* Submit */}
                  <Button
                    type='submit'
                    size='lg'
                    className='mt-6 w-full rounded-full py-6 text-sm tracking-wide'
                    disabled={isSubmitting || isApplyingCoupon}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className='me-2 h-4 w-4 animate-spin' />
                        Processing…
                      </>
                    ) : (
                      "Place Order"
                    )}
                  </Button>

                  {/* Security note */}
                  <div className='mt-4 flex items-center justify-center gap-1.5 text-xs text-stone-400 mach-dark:text-white/40'>
                    <Shield className='h-3 w-3' />
                    <span>Secure checkout</span>
                  </div>
                </div>

                {/* Mobile: compact collapsed summary bar */}
                <div className='lg:hidden rounded-2xl border border-stone-200 mach-dark:border-white/15 bg-white mach-dark:bg-[var(--mach-ink-soft)] p-4'>
                  <button
                    type='button'
                    onClick={() => setSummaryExpanded((v) => !v)}
                    className='w-full flex items-center gap-3'
                    aria-expanded={summaryExpanded}>
                    <div className='w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-stone-100 border border-stone-200 flex items-center justify-center'>
                      <ShoppingBag className='w-4 h-4 text-stone-300 mach-dark:text-white/30' />
                    </div>
                    <div className='flex-1 min-w-0 text-left'>
                      <p className='text-sm font-semibold text-stone-900 mach-dark:text-white'>
                        Total
                      </p>
                      <p className='text-xs text-stone-500 mach-dark:text-white/55'>
                        {cartQuantity} {cartQuantity === 1 ? "item" : "items"}
                      </p>
                    </div>
                    <div className='text-right shrink-0'>
                      {hasDiscount && (
                        <p className='text-xs text-stone-400 mach-dark:text-white/40 line-through'>
                          {formatPrice(originalTotal, currency)}
                        </p>
                      )}
                      <p className='text-base font-semibold text-stone-900 mach-dark:text-white'>
                        {formatPrice(totals.grandTotal, currency)}
                      </p>
                    </div>
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 text-stone-400 mach-dark:text-white/40 shrink-0 transition-transform",
                        summaryExpanded && "rotate-180",
                      )}
                    />
                  </button>

                  {summaryExpanded && (
                    <div className='mt-4 pt-4 border-t border-stone-200 mach-dark:border-white/15'>
                      {renderItemsList()}
                      <div className='mt-4 h-px w-full bg-stone-200 mach-dark:bg-white/12' />
                      {renderTotalsBreakdown()}
                    </div>
                  )}

                  {/* Outside the collapsible panel so shoppers see it
                      without expanding the summary. */}
                  {onApplyCoupon && (
                    <div className='mt-4 pt-4 border-t border-stone-200 mach-dark:border-white/15'>
                      {renderPromoCode("mobile")}
                    </div>
                  )}
                </div>

                <div className='lg:hidden'>
                  <Button
                    type='submit'
                    size='lg'
                    className='w-full rounded-full py-6 text-sm tracking-wide'
                    disabled={isSubmitting || isApplyingCoupon}>
                    {isSubmitting ? (
                      <>
                        <Loader2 className='me-2 h-4 w-4 animate-spin' />
                        Processing…
                      </>
                    ) : (
                      "Place Order"
                    )}
                  </Button>
                  <div className='mt-4 flex items-center justify-center gap-1.5 text-xs text-stone-400 mach-dark:text-white/40'>
                    <Shield className='h-3 w-3' />
                    <span>Secure checkout</span>
                  </div>
                </div>
              </Reveal>
            </div>
          </form>
        </div>
      </div>
    </EditorialChrome>
  );
}

CheckoutPageEditorialTemplate.displayName = "CheckoutPageEditorialTemplate";
