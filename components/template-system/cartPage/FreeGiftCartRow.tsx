import { Gift } from "lucide-react";
import type { CartPageCartItem } from "./CartPageModernTemplate";

/** The part of an applied offer the summaries need to describe its saving. */
export interface OfferAmountSummary {
  discountAmount: number;
  freeShipping?: boolean;
  /** Free units a Buy X Get Y offer added (see AppliedOffer.gifts). */
  gifts?: ReadonlyArray<{ quantity: number }>;
}

/**
 * What an applied offer is worth, as the order summaries show it. A free-gift
 * offer adds units instead of discounting, so its amount is a unit count —
 * never "−0.00".
 */
export function offerAmountText(
  offer: OfferAmountSummary,
  formatMoney: (amount: number) => string,
): string {
  const giftUnits = offer.gifts?.reduce((s, g) => s + g.quantity, 0) ?? 0;
  if (giftUnits > 0) return `${giftUnits} free`;
  if (offer.freeShipping && offer.discountAmount === 0) return "Free shipping";
  return `−${formatMoney(offer.discountAmount)}`;
}

/**
 * A free unit an offer added to the cart. Read-only on purpose: it has no
 * quantity stepper or remove button — it follows the paid line it belongs to.
 */
export function FreeGiftCartRow({
  item,
  currency = "EGP",
}: {
  item: CartPageCartItem;
  currency?: string;
}) {
  const worth = (item.giftUnitValue ?? 0) * item.quantity;
  return (
    <div className="flex gap-4 py-4" data-testid="free-gift-line">
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-stone-100 mach-dark:bg-white/[0.06]">
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            alt={item.name}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white">
          <Gift className="h-3 w-3" />
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-stone-900 mach-dark:text-white line-clamp-2">
          {item.name}
        </p>
        {item.variant && (
          <p className="mt-0.5 text-xs text-stone-500 mach-dark:text-white/55">{item.variant}</p>
        )}
        <p className="mt-0.5 text-xs font-medium text-emerald-700 mach-dark:text-emerald-400">
          Free gift{item.giftOfferName ? ` · ${item.giftOfferName}` : ""}
        </p>
        {item.stockWarning && (
          <p role="alert" className="mt-1 text-xs font-medium text-red-600 mach-dark:text-red-400">
            {item.stockWarning}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600 mach-dark:text-emerald-400">
          Free
        </p>
        {worth > 0 && (
          <p className="text-xs text-stone-400 mach-dark:text-white/40 line-through">
            {currency} {worth.toFixed(2)}
          </p>
        )}
        <p className="text-xs text-stone-500 mach-dark:text-white/55">Qty {item.quantity}</p>
      </div>
    </div>
  );
}
