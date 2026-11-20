import { Fragment, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { HomepagePromoBannerContent } from "#root/shared/types/homepage-content";
import { resolvePromoBanner } from "#root/shared/types/homepage-promo-banner";
import { formatCountdown } from "#root/shared/sale-countdown/countdown";
import { useSaleCountdown, type SaleCountdownView } from "./useSaleCountdown";

/**
 * The element `LayoutDefault` reserves inside the fixed global chrome, above
 * the navbar, for a page-level announcement bar. Anything rendered into it is
 * measured by the chrome's ResizeObserver, so the navbar moves down under it
 * and nothing overlaps — no offset arithmetic here.
 */
export const CHROME_BANNER_SLOT_ID = "chrome-banner-slot";

/**
 * The bar itself, with no knowledge of where it is mounted.
 *
 * One line, black on white inverted to white on black, in the same compact
 * uppercase voice as the Mach navbar's own announcement strip so the two read
 * as one piece of chrome if both are switched on. Text and link sit inline
 * and wrap onto a second line on a narrow phone rather than overflowing.
 *
 * `countdown` (the running sale countdown, if any) sits between the text and
 * the link: "TEXT | SALE ENDS IN 00:59:59 | LINK". The clock never breaks
 * across lines and uses tabular digits so the bar doesn't jitter each second;
 * the "|" separators only show where everything fits on one line.
 */
export function MachPromoBannerBar({
  content,
  countdown = null,
}: {
  content: HomepagePromoBannerContent | undefined | null;
  countdown?: SaleCountdownView | null;
}) {
  const resolved = resolvePromoBanner(content);
  if (!resolved) return null;

  const segments: Array<{ key: string; node: ReactNode }> = [];
  if (resolved.text) segments.push({ key: "text", node: <span>{resolved.text}</span> });
  if (countdown) {
    segments.push({
      key: "countdown",
      node: (
        <span data-mach-sale-countdown='' role='timer' className='whitespace-nowrap'>
          {countdown.label}{" "}
          <span className='tabular-nums'>{formatCountdown(countdown.remainingMs)}</span>
        </span>
      ),
    });
  }
  if (resolved.link) {
    segments.push({
      key: "link",
      node: (
        <a
          href={resolved.link.href}
          className="underline decoration-white/50 underline-offset-[5px] transition-colors hover:decoration-white">
          {resolved.link.label}
        </a>
      ),
    });
  }

  return (
    <div
      data-mach-promo-banner=""
      role="region"
      aria-label="Promotional announcement"
      className="w-full border-b border-white/10 bg-[var(--mach-ink)] text-white">
      <div className="mx-auto flex max-w-480 flex-wrap items-center justify-center gap-x-4 gap-y-0.5 px-4 py-2 text-center text-[10px] font-bold uppercase leading-[1.5] tracking-[0.22em] sm:px-6 sm:text-[11px]">
        {segments.map((segment, index) => (
          <Fragment key={segment.key}>
            {index > 0 && countdown && (
              <span aria-hidden='true' className='hidden text-white/40 sm:inline'>
                |
              </span>
            )}
            {segment.node}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * Mounts the promotional banner into the global chrome above the navbar.
 *
 * The same portal pattern `LandingTemplateModern` uses for the same CMS
 * field: the slot lives in `LayoutDefault`, which is an ancestor of this page
 * in the DOM but not a parent in the React tree, so a portal is the only way
 * to render into it without the page owning navbar positioning. The slot is
 * looked up after mount and re-checked if the document changes, because the
 * layout can settle a frame after this effect runs.
 *
 * Renders nothing during SSR — a portal needs a DOM — and nothing inline as a
 * fallback, because inline would put the bar below the hero, which is the one
 * place it must not be.
 */
export function MachPromoBanner({
  content,
}: {
  content: HomepagePromoBannerContent | undefined | null;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const find = () => setSlot(document.getElementById(CHROME_BANNER_SLOT_ID));
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const countdown = useSaleCountdown();

  if (!slot) return null;
  return createPortal(<MachPromoBannerBar content={content} countdown={countdown} />, slot);
}
