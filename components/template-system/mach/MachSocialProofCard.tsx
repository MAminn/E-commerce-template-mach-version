import { ArrowUpRight, X } from "lucide-react";

/**
 * The Mach social-proof card — presentation only.
 *
 * Split out of `MachSocialProofToast` so the admin preview renders the *same*
 * card rather than a copy of its markup that quietly drifts. It is the
 * smallest thing that achieves that: no data fetching, no timers, no session
 * state, no router. It takes strings and draws them, which is why the CMS can
 * mount it with demo copy without inheriting any storefront behaviour.
 *
 * ── The object ────────────────────────────────────────────────────────────
 *
 * Not a system notification — a small editorial panel from the same kit as
 * the rest of Mach. Paper ground rather than generic white, a hairline box
 * closed by a hard 2px black bottom rule (the same device the storefront's
 * section headings and badges use), square corners, and the packaging sitting
 * on an inset white stage that is the only colour anywhere on it.
 *
 * ── Link vs close ─────────────────────────────────────────────────────────
 *
 * The body navigates and the X must not, which rules out nesting the button
 * inside the anchor (invalid, and it does not survive hydration). Same
 * construction as `MachProductCard`: content is plain elements, a stretched
 * anchor covers the card at z-10, and the close button is a sibling painting
 * above it at z-20 — so a click on the X can never reach the link beneath.
 */

export interface MachSocialProofCardProps {
  /** Already sanitised server-side — "Ahmed M.", never a full name. */
  displayName: string;
  /** Broad city/governorate, or null when the admin has location off. */
  location: string | null;
  productName: string;
  productImageUrl: string | null;
  /** Pre-formatted, e.g. "4 min ago". Empty string hides the row. */
  relativeTime: string;
  /**
   * Product destination. Omitted in the admin preview, which renders the same
   * card with no stretched link and a decorative close control.
   */
  href?: string;
  onDismiss?: () => void;
  /** Transition/positioning classes supplied by the caller. */
  className?: string;
}

export function MachSocialProofCard({
  displayName,
  location,
  productName,
  productImageUrl,
  relativeTime,
  href,
  onDismiss,
  className = "",
}: MachSocialProofCardProps) {
  const interactive = Boolean(href);

  // Plain-text equivalent for the screen-reader label and the image alt.
  const context = location
    ? `${displayName} in ${location} just ordered`
    : `${displayName} just ordered`;

  return (
    <div
      // Widths are declared per-edge (`border-x`/`border-t`/`border-b-2`)
      // rather than as `border border-b-2`, so the 2px bottom rule can't be
      // flattened back to 1px by utility ordering. The hover darkening is
      // likewise scoped to the hairline edges — it must not lighten the black
      // rule that grounds the card.
      className={`group relative w-full border-x border-t border-b-2 border-[var(--mach-ink)]/15 border-b-[var(--mach-ink)] bg-[var(--mach-paper)] shadow-[0_18px_48px_rgba(0,0,0,0.18)] transition-colors duration-300 hover:border-x-[var(--mach-ink)]/35 hover:border-t-[var(--mach-ink)]/35 motion-reduce:transition-none sm:w-[390px] ${className}`}>
      {interactive && (
        <a
          href={href}
          className='absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--mach-ink)]'>
          <span className='sr-only'>{`${context} ${productName}. View product.`}</span>
        </a>
      )}

      {/* 30px hit target, no circular chrome — just the mark, darkening on
          hover. z-20 keeps it above the stretched link. */}
      {onDismiss ? (
        <button
          type='button'
          onClick={onDismiss}
          aria-label='Dismiss recent order notifications'
          className='absolute right-1 top-1 z-20 flex h-[30px] w-[30px] items-center justify-center text-[var(--mach-mute)] transition-colors hover:text-[var(--mach-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--mach-ink)]'>
          <X className='h-4 w-4' strokeWidth={2.25} />
        </button>
      ) : (
        <span
          aria-hidden='true'
          className='absolute right-1 top-1 z-20 flex h-[30px] w-[30px] items-center justify-center text-[var(--mach-mute)]'>
          <X className='h-4 w-4' strokeWidth={2.25} />
        </span>
      )}

      <div className='flex items-stretch gap-3.5 p-3 sm:p-3.5'>
        {/* Inset white stage against the paper ground. Generous padding so a
            tall tub is never cropped, and `object-contain` so the packaging
            keeps its own proportions and its real colour. */}
        <div className='flex h-[76px] w-[76px] shrink-0 items-center justify-center bg-white ring-1 ring-inset ring-[var(--mach-ink)]/12 sm:h-[86px] sm:w-[86px]'>
          {productImageUrl && (
            <img
              src={productImageUrl}
              alt={productName}
              loading='lazy'
              decoding='async'
              className='h-full w-full object-contain p-2'
            />
          )}
        </div>

        {/* pr clears the close control so the hairline and the copy can never
            run underneath it. */}
        <div className='flex min-w-0 flex-1 flex-col justify-center pr-7'>
          <div className='flex items-center gap-2.5'>
            <span className='shrink-0 text-[9px] font-bold uppercase leading-none tracking-[0.26em] text-[var(--mach-mute)] sm:text-[10px]'>
              Recent order
            </span>
            {/* Editorial rule closing the eyebrow, as on the section headings. */}
            <span
              aria-hidden='true'
              className='h-px min-w-0 flex-1 bg-[var(--mach-ink)]/15'
            />
          </div>

          {/*
            `capitalize` is presentation only. Orders are stored exactly as the
            customer typed them, and plenty arrive lowercase ("muhammed h.",
            "cairo"), which reads as unfinished on a premium storefront. It is
            applied to the name and the place alone — never to the whole
            sentence, which would produce "In Cairo Just Ordered".

            Safe for Arabic: `text-transform` only acts on characters that have
            a case mapping, and Arabic script has none, so an Arabic name
            renders byte-for-byte as stored. Nothing here changes what the
            server sanitises or what the database holds.
          */}
          <p className='mt-2 truncate text-[12px] font-medium leading-tight text-[var(--mach-ink)]/70'>
            <span className='capitalize'>{displayName}</span>
            {location ? (
              <>
                {" in "}
                <span className='capitalize'>{location}</span>
              </>
            ) : null}
            {" just ordered"}
          </p>

          {/* The loudest element on the card. Two lines, then ellipsis. */}
          <p className='mt-1 line-clamp-2 text-[13px] font-bold uppercase leading-[1.3] tracking-[0.03em] text-[var(--mach-ink)] sm:text-[14px]'>
            {productName}
          </p>

          {relativeTime && (
            <p className='mt-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase leading-none tracking-[0.18em] text-[var(--mach-mute)]'>
              {relativeTime}
              <ArrowUpRight
                className='h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:translate-y-0'
                strokeWidth={2.5}
              />
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
