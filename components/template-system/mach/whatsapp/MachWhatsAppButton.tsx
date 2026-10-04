import { type RefObject, useEffect, useRef, useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { trpc } from "#root/shared/trpc/client";
import { useConsent } from "#root/frontend/contexts/ConsentContext";
import { isProductDetailRoute } from "#root/lib/social-proof-routes";
import type {
  PublicWhatsAppButton,
  WhatsAppVisibility,
} from "#root/shared/whatsapp/config";
import { isWhatsAppExcludedRoute } from "./whatsappRoutes";

/**
 * Floating click-to-chat button, bottom-right, CMS-controlled
 * (Settings → WhatsApp). It is a plain link to wa.me — it never sends
 * anything itself.
 *
 * Placement, checked against the other bottom-anchored storefront UI:
 *
 *  - Product page, below `lg`: the Mach sticky purchase bar is
 *    `fixed bottom-0` with its Add to Bag button on the right — exactly where
 *    this sits. That bar is ~73px tall (`p-3` around a 48px control), so the
 *    button is lifted to 88px, the same clearance the social-proof toast uses.
 *  - First-visit consent banner: full width at the bottom with its buttons on
 *    the right. The button stays hidden until the visitor has decided; the
 *    small "Cookie preferences" pill that remains is bottom-left.
 *  - Social-proof toast: bottom-left and full width on phones, z-[9998] — it
 *    briefly covers this button, never the other way round.
 *  - In-flow controls: any page control can scroll under a floating button —
 *    on a phone the cart's Proceed to Checkout and the product page's own Add
 *    to Bag do. While a form control is under its footprint the button fades
 *    out and stops taking taps (`useCoversControl`), so it never sits on one.
 *  - `z-40` keeps it under the sticky bar and consent banner (z-50), dialogs
 *    (z-50), sheets (z-[10001]), the navbar and its menus (z-[10000]+) and the
 *    upsell sheet (z-[10002]).
 *  - `env(safe-area-inset-*)` clears the iOS home indicator and landscape
 *    notch (the viewport meta sets `viewport-fit=cover`).
 */

/** Below `lg` — the breakpoint the Mach product page's sticky bar uses. */
const VISIBILITY_CLASS: Record<WhatsAppVisibility, string> = {
  both: "flex",
  mobile: "flex lg:hidden",
  desktop: "hidden lg:flex",
};

export function whatsappVisibilityClass(visibility: WhatsAppVisibility) {
  return VISIBILITY_CLASS[visibility] ?? VISIBILITY_CLASS.both;
}

/**
 * Simple Icons' WhatsApp glyph (CC0) — the same path the link-tree page draws.
 * White on WhatsApp green (#25D366): the brand's own treatment, so the
 * button reads as WhatsApp at a glance.
 */
function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 24 24'
      fill='currentColor'
      aria-hidden='true'
      focusable='false'
      className={className}>
      <path d='M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z' />
    </svg>
  );
}

/**
 * What counts as a control the button must not sit on: form controls and
 * widgets. Plain links are left out on purpose — product cards are links, and
 * counting them would hide the button over every catalogue grid.
 */
const CONTROL_SELECTOR =
  "button, input, select, textarea, [role='button'], [role='checkbox'], [role='radio'], [role='switch'], [role='combobox'], [role='slider'], [role='spinbutton']";

/** Margin around the button's footprint that must also be clear. */
const CONTROL_CLEARANCE_PX = 6;

type HitTester = Pick<Document, "elementsFromPoint">;

/**
 * True when a control is what the shopper sees under the button's footprint
 * (padded by `CONTROL_CLEARANCE_PX`), sampled at the corners, edge midpoints
 * and centre. `elementsFromPoint` answers in paint order and honours
 * clipping, visibility and `pointer-events: none`, so only what is actually
 * on screen under the button counts. The button itself is skipped.
 */
export function isOverControl(
  rect: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width">,
  self: Element,
  viewport: { width: number; height: number },
  doc: HitTester = document,
): boolean {
  if (rect.width === 0) return false; // display:none at this breakpoint
  const pad = CONTROL_CLEARANCE_PX;
  const xs = [rect.left - pad, (rect.left + rect.right) / 2, rect.right + pad];
  const ys = [rect.top - pad, (rect.top + rect.bottom) / 2, rect.bottom + pad];
  for (const x of xs) {
    for (const y of ys) {
      const cx = Math.min(Math.max(x, 0), viewport.width - 1);
      const cy = Math.min(Math.max(y, 0), viewport.height - 1);
      const under = doc
        .elementsFromPoint(cx, cy)
        .find((el) => el !== self && !self.contains(el));
      if (under?.closest(CONTROL_SELECTOR)) return true;
    }
  }
  return false;
}

/**
 * Re-checks `isOverControl` once per frame at most, on scroll, resize and
 * any change to the page's size (items added/removed, accordions opening).
 */
function useCoversControl(
  ref: RefObject<HTMLAnchorElement | null>,
  active: boolean,
  pathname: string,
) {
  const [covering, setCovering] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies(pathname): client navigation swaps the page under the button without necessarily scrolling or resizing
  useEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof document.elementsFromPoint !== "function") {
      setCovering(false);
      return;
    }
    let frame = 0;
    const check = () => {
      frame = 0;
      const root = document.documentElement;
      setCovering(
        isOverControl(el.getBoundingClientRect(), el, {
          width: root.clientWidth,
          height: window.innerHeight,
        }),
      );
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(check);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(document.body);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
    };
  }, [ref, active, pathname]);

  return covering;
}

export function MachWhatsAppButtonView({
  href,
  visibility,
  raised = false,
  hidden = false,
  anchorRef,
}: {
  href: string;
  visibility: WhatsAppVisibility;
  /** Lift clear of the product page's mobile sticky purchase bar. */
  raised?: boolean;
  /** A control is underneath: fade out and go inert (no taps, no focus). */
  hidden?: boolean;
  anchorRef?: RefObject<HTMLAnchorElement | null>;
}) {
  return (
    <a
      ref={anchorRef}
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      aria-label='Chat with us on WhatsApp'
      data-testid='whatsapp-floating-button'
      data-covering-control={hidden ? "true" : undefined}
      // Invisible while covering: out of the tab order, the accessibility
      // tree and hit-testing, so focus can never land on a link you can't see.
      inert={hidden}
      className={`${whatsappVisibilityClass(visibility)} fixed z-40 h-[52px] w-[52px] items-center justify-center rounded-full border border-black/10 bg-[#25D366] text-white shadow-[0_10px_30px_rgba(0,0,0,0.35)] hover:bg-[#1EBE5A] transition-[opacity,transform] duration-200 ease-out hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black motion-reduce:transition-none motion-reduce:hover:scale-100 right-[calc(env(safe-area-inset-right,0px)_+_16px)] lg:right-[calc(env(safe-area-inset-right,0px)_+_24px)] lg:bottom-[calc(env(safe-area-inset-bottom,0px)_+_24px)] lg:h-14 lg:w-14 ${
        raised
          ? "bottom-[calc(env(safe-area-inset-bottom,0px)_+_88px)]"
          : "bottom-[calc(env(safe-area-inset-bottom,0px)_+_16px)]"
      }${hidden ? " opacity-0" : " opacity-100"}`}>
      <WhatsAppGlyph className='h-[26px] w-[26px] lg:h-7 lg:w-7' />
    </a>
  );
}

export function MachWhatsAppButton() {
  const { urlPathname } = usePageContext();
  const { showBanner } = useConsent();
  const excluded = isWhatsAppExcludedRoute(urlPathname);

  const [button, setButton] = useState<PublicWhatsAppButton | null>(null);
  const mountedRef = useRef(true);
  const fetchedRef = useRef(false);
  const anchorRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Client-side, once per visit (the layout persists across client
  // navigation). Not SSR data: a fixed overlay cannot shift layout, and
  // rendering nothing on the server means no hydration mismatch.
  useEffect(() => {
    if (excluded || fetchedRef.current) return;
    fetchedRef.current = true;
    trpc.whatsapp.getPublicButton
      .query()
      .then((result) => {
        if (mountedRef.current && result.success) setButton(result.result);
      })
      .catch(() => {
        // A button that fails to load simply never shows.
      });
  }, [excluded]);

  const shown = !excluded && !showBanner && button !== null;
  const covering = useCoversControl(anchorRef, shown, urlPathname);

  if (!shown) return null;

  return (
    <MachWhatsAppButtonView
      anchorRef={anchorRef}
      href={button.href}
      visibility={button.visibility}
      raised={isProductDetailRoute(urlPathname)}
      hidden={covering}
    />
  );
}
