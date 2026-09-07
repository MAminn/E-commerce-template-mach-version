import { memo } from "react";
import { MachMedia, MachScrim } from "../MachMedia";
import { CTA_ON_DARK, GUTTER, HEADING_HERO, SHELL } from "../machTokens";
import {
  isShopHeroHidden,
  type ShopHeroContent,
} from "#root/shared/types/shop-content";

/**
 * Optional shop banner.
 *
 * Renders nothing — not an empty band, not a reserved height — when the client
 * has the hero switched off or has left it blank. The page heading below simply
 * becomes the first thing on the page.
 *
 * Every word and image here comes from ShopContent. There is no fallback copy:
 * an unset headline means no headline, never inherited template prose.
 */
export const MachShopHero = memo(function MachShopHero({
  hero,
}: {
  hero?: ShopHeroContent;
}) {
  if (isShopHeroHidden(hero)) return null;

  const headline = (hero?.headline || "").trim();
  const description = (hero?.description || "").trim();
  const ctaLabel = (hero?.ctaLabel || "").trim();
  const ctaHref = (hero?.ctaHref || "").trim();

  return (
    <section className="relative isolate w-full overflow-hidden bg-[var(--mach-ink)]">
      <div className="relative h-[46vw] max-h-[560px] min-h-[260px] w-full sm:h-[38vw] lg:h-[32vw]">
        <MachMedia slot={hero?.media} priority className="absolute inset-0" />
        <MachScrim opacity={50} theme="light" />

        <div
          className={`relative z-10 flex h-full items-end ${GUTTER} pb-8 sm:pb-12 lg:pb-16`}>
          <div className={`${SHELL} w-full`}>
            <div className="max-w-3xl">
              {headline && (
                <h1 className={`${HEADING_HERO} text-white`}>{headline}</h1>
              )}
              {description && (
                <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/75 sm:text-base">
                  {description}
                </p>
              )}
              {ctaLabel && ctaHref && (
                <a href={ctaHref} className={`${CTA_ON_DARK} mt-7`}>
                  {ctaLabel}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});
