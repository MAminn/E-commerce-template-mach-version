import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { HomepagePromoBannerContent } from "#root/shared/types/homepage-content";
import { resolvePromoBanner } from "#root/shared/types/homepage-promo-banner";

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
 */
export function MachPromoBannerBar({
  content,
}: {
  content: HomepagePromoBannerContent | undefined | null;
}) {
  const resolved = resolvePromoBanner(content);
  if (!resolved) return null;

  return (
    <div
      data-mach-promo-banner=""
      role="region"
      aria-label="Promotional announcement"
      className="w-full border-b border-white/10 bg-[var(--mach-ink)] text-white">
      <div className="mx-auto flex max-w-480 flex-wrap items-center justify-center gap-x-4 gap-y-0.5 px-4 py-2 text-center text-[10px] font-bold uppercase leading-[1.5] tracking-[0.22em] sm:px-6 sm:text-[11px]">
        {resolved.text && <span>{resolved.text}</span>}
        {resolved.link && (
          <a
            href={resolved.link.href}
            className="underline decoration-white/50 underline-offset-[5px] transition-colors hover:decoration-white">
            {resolved.link.label}
          </a>
        )}
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

  if (!slot) return null;
  return createPortal(<MachPromoBannerBar content={content} />, slot);
}
