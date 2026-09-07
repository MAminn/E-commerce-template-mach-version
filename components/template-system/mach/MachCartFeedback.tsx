import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { STORE_CURRENCY } from "#root/shared/config/branding";

/**
 * Mach add-to-cart confirmation.
 *
 * The storefront previously answered every Add to Cart with the inherited
 * `StickyCartBar` — an amber/emerald gradient pill anchored to the bottom of
 * the viewport. That component belongs to the templates it was built for; on
 * Mach it introduced the one accent hue the whole interface is defined by not
 * having, and on a phone it stacked on top of the product page's own sticky
 * purchase bar.
 *
 * This is the replacement, and it is deliberately small. The navbar bag count
 * is already live off `CartContext`, and the button that was pressed confirms
 * itself in place, so the toast only has to answer "which product, and where
 * do I go next" — two lines, a hairline, and a link. Monochrome, hard-edged,
 * top-right, and gone in four seconds.
 *
 * Mounted once by the layout for the Mach storefront. Anything that adds to
 * the cart calls `showMachCartToast`; nothing has to hold a ref to it.
 */

export interface MachCartToastItem {
  name: string;
  /** Unit price actually charged — discounted where one applies. */
  price: number;
  quantity: number;
  imageUrl?: string | null;
}

type Listener = (item: MachCartToastItem) => void;

let listener: Listener | null = null;

/** Confirm an add-to-cart from anywhere in the Mach storefront. */
export function showMachCartToast(item: MachCartToastItem) {
  listener?.(item);
}

const VISIBLE_MS = 4000;
/** Used only until the real navbar chrome can be measured. */
const NAVBAR_FALLBACK_PX = 88;

export function MachCartToastContainer() {
  const [item, setItem] = useState<MachCartToastItem | null>(null);
  const [visible, setVisible] = useState(false);
  // Bumped on every add so a second add while one is on screen restarts the
  // timer instead of inheriting the tail of the previous one.
  const [nonce, setNonce] = useState(0);
  const timer = useRef<number | null>(null);

  // Sits under the fixed navbar chrome rather than over it: the bag count in
  // the header is half the confirmation, and a toast that covers it hides the
  // thing it is confirming. The chrome's height is not fixed — an
  // announcement banner can wrap onto extra lines — so it is measured, with a
  // fallback for the (SSR-less) case where the element isn't there yet.
  const [topOffset, setTopOffset] = useState(NAVBAR_FALLBACK_PX);

  const show = useCallback((next: MachCartToastItem) => {
    const chrome = document.getElementById("global-navbar");
    const h = chrome?.getBoundingClientRect().height ?? 0;
    setTopOffset((h > 0 ? h : NAVBAR_FALLBACK_PX) + 12);
    setItem(next);
    setVisible(true);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    listener = show;
    return () => {
      listener = null;
    };
  }, [show]);

  useEffect(() => {
    if (!visible) return;
    timer.current = window.setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [visible, nonce]);

  if (!visible || !item) return null;

  const lineTotal = item.price * item.quantity;

  return (
    <div
      // Top-right, clear of the Mach product page's own sticky mobile purchase
      // bar and of the bottom of the viewport generally.
      className="pointer-events-none fixed inset-x-3 z-[10001] flex justify-end sm:inset-x-auto sm:right-5"
      style={{ top: topOffset }}
      role="status"
      aria-live="polite">
      <div className="pointer-events-auto w-full max-w-[340px] animate-mach-toast-enter border border-[var(--mach-ink)] bg-white shadow-[0_18px_44px_rgba(0,0,0,0.16)]">
        {/* Confirmation strip — inverted, so the state reads before the copy */}
        <div className="flex items-center justify-between gap-3 bg-[var(--mach-ink)] px-4 py-2.5">
          <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
            Added to bag
          </span>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="-mr-1 p-1 text-white/60 transition-colors hover:text-white"
            aria-label="Dismiss">
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex items-center gap-3 px-4 py-3.5">
          {item.imageUrl && (
            <div className="h-12 w-12 shrink-0 bg-white ring-1 ring-inset ring-[var(--mach-ink)]/12">
              <img
                src={item.imageUrl}
                alt=""
                aria-hidden="true"
                className="h-full w-full object-contain p-1"
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-bold uppercase leading-tight tracking-[0.04em] text-[var(--mach-ink)]">
              {item.name}
            </p>
            <p className="mt-1 text-[11px] font-semibold text-[var(--mach-mute)]">
              {item.quantity > 1 ? `${item.quantity} × ` : ""}
              {STORE_CURRENCY} {lineTotal.toFixed(2)}
            </p>
          </div>
        </div>

        <a
          href="/cart"
          className="block border-t border-[var(--mach-ink)]/15 px-4 py-3 text-center text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--mach-ink)] transition-colors hover:bg-[var(--mach-ink)] hover:text-white">
          View bag
        </a>
      </div>
    </div>
  );
}
