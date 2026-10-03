import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, X } from "lucide-react";
import { STORE_CURRENCY } from "#root/shared/config/branding";
import type { FeaturedProduct } from "../../home/HomeFeaturedProducts";
import { MACH_THEME_CLASS } from "../machTheme";
import { MachUpsellList } from "./MachUpsellList";
import type { PostAddMainItem } from "./types";

/**
 * Post-add upsell — a bottom sheet on phones, a centred modal from `sm` up.
 *
 * One component with responsive placement rather than two, so the content,
 * focus handling and dismissal are identical at every width. It is opened
 * only by the product page after the cart has accepted the main product, so
 * by the time this is on screen the shopper's add has already happened —
 * closing it, ignoring it or navigating away changes nothing about that.
 *
 * Portalled to <body>, outside the storefront's dark scope, so it carries the
 * Mach theme class itself.
 */

function formatPrice(v: number): string {
  return `${STORE_CURRENCY} ${v.toFixed(2)}`;
}

const LINK =
  "inline-flex h-12 flex-1 items-center justify-center text-[11px] font-bold uppercase tracking-[0.2em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mach-ink-raised)]";

export function PostAddUpsellSheet({
  open,
  main,
  products,
  onClose,
}: {
  open: boolean;
  main: PostAddMainItem | null;
  products: FeaturedProduct[];
  onClose: () => void;
}) {
  // Never an empty sheet: without recommendations the caller confirms the add
  // with the usual toast instead of opening this.
  if (!main || products.length === 0) return null;

  const options = Object.entries(main.selectedOptions ?? {}).filter(
    ([, v]) => Boolean(v),
  );

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className='fixed inset-0 z-[10002] bg-black/75 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0' />
        <DialogPrimitive.Content
          data-testid='post-add-upsell'
          className={`${MACH_THEME_CLASS} fixed inset-x-0 bottom-0 z-[10002] flex max-h-[88dvh] flex-col border-t border-white/15 bg-[var(--mach-ink-raised)] text-white shadow-[0_-18px_44px_rgba(0,0,0,0.5)] duration-300 focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85vh] sm:w-[calc(100%-2rem)] sm:max-w-[460px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:border sm:shadow-[0_18px_44px_rgba(0,0,0,0.5)] sm:data-[state=open]:fade-in-0 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:fade-out-0 sm:data-[state=closed]:zoom-out-95`}>
          {/* Confirmation strip — inverted, like the Mach toast. */}
          <div className='flex shrink-0 items-center justify-between gap-3 bg-[var(--mach-ink)] px-5 py-3'>
            <DialogPrimitive.Title className='flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-white'>
              <Check className='h-4 w-4' strokeWidth={3} aria-hidden='true' />
              Added to your bag
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className='-mr-2 flex h-11 w-11 items-center justify-center text-white/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white'
              aria-label='Close'>
              <X className='h-4 w-4' strokeWidth={2.5} />
            </DialogPrimitive.Close>
          </div>

          <div className='min-h-0 flex-1 overflow-y-auto px-5'>
            {/* The product that was just added. */}
            <div className='flex items-center gap-3 py-4'>
              {main.imageUrl && (
                <div className='h-14 w-14 shrink-0 bg-white ring-1 ring-inset ring-[var(--mach-ink)]/12'>
                  <img
                    src={main.imageUrl}
                    alt=''
                    aria-hidden='true'
                    className='h-full w-full object-contain p-1'
                  />
                </div>
              )}
              <div className='min-w-0 flex-1'>
                <p className='line-clamp-2 text-[12px] font-bold uppercase leading-tight tracking-[0.04em] text-white'>
                  {main.name}
                </p>
                {options.length > 0 && (
                  <p className='mt-1 truncate text-[11px] text-[var(--mach-mute-invert)]'>
                    {options.map(([k, v]) => `${k}: ${v}`).join(" · ")}
                  </p>
                )}
                <p className='mt-1 text-[11px] font-semibold text-[var(--mach-mute-invert)]'>
                  {main.quantity > 1 ? `${main.quantity} × ` : ""}
                  {formatPrice(main.price)}
                </p>
              </div>
            </div>

            <DialogPrimitive.Description className='sr-only'>
              {main.name} is in your bag. Recommended products follow.
            </DialogPrimitive.Description>

            <p className='border-t border-white/12 pt-4 text-[11px] font-bold uppercase tracking-[0.2em] text-white'>
              You may also like
            </p>
            <MachUpsellList
              products={products}
              toast={false}
              onNavigate={onClose}
              className='mt-3'
            />
          </div>

          <div className='shrink-0 space-y-3 border-t border-white/12 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4'>
            <div className='flex gap-3'>
              <a
                href='/cart'
                onClick={onClose}
                className={`${LINK} border border-white/30 text-white hover:border-white`}>
                View bag
              </a>
              <a
                href='/checkout'
                onClick={onClose}
                className={`${LINK} bg-white text-[var(--mach-ink)] hover:bg-white/85`}>
                Checkout
              </a>
            </div>
            <DialogPrimitive.Close className='block w-full py-2 text-center text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--mach-mute-invert)] transition-colors hover:text-white'>
              Continue shopping
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
