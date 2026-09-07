import type { CampaignBannerContent } from "#root/shared/types/homepage-content";
import { isMediaSlotEmpty } from "#root/shared/types/homepage-content";
import { isPlaceholderLink } from "#root/shared/types/layout-settings";
import { Reveal } from "../../motion/Reveal";
import { MachMedia, MachScrim } from "../MachMedia";
import {
  EYEBROW,
  HEADING,
  alignClasses,
  ctaPairForTheme,
  textClassesForTheme,
  verticalAlignClasses,
} from "../machTokens";

/**
 * Full-bleed campaign banner placed between merchandising rows.
 *
 * This is the GHOST rhythm — merchandise, then a large lifestyle break, then
 * merchandise again — which is what keeps a long commercial homepage from
 * reading as an endless product grid.
 *
 * Banners are CMS records in an array, positioned by `sectionOrder`, so the
 * client can add, remove, reorder or disable them without a code change.
 * Every visible element is theirs: media (desktop, mobile, video), eyebrow,
 * headline, body, CTA label and destination, text placement, scrim strength,
 * light/dark treatment and height.
 *
 * Renders nothing without media — a banner is the photograph. A headline over
 * an empty rectangle is not a campaign.
 */
export function MachCampaignBanner({
  banner,
}: {
  banner: CampaignBannerContent;
}) {
  if (!banner.enabled) return null;
  if (isMediaSlotEmpty(banner.media)) return null;

  const theme = banner.textTheme ?? "light";
  const text = textClassesForTheme(theme);
  const cta = ctaPairForTheme(theme);
  const align = banner.align ?? "left";
  const vAlign = banner.verticalAlign ?? "bottom";

  const showCta =
    Boolean(banner.ctaText?.trim()) && !isPlaceholderLink(banner.ctaLink);

  // Tall banners get near-full-viewport treatment; standard ones stay in the
  // 16:9-ish band so two of them in a page don't each demand a full screen.
  const heightCls =
    banner.height === "tall"
      ? "min-h-[80svh] lg:min-h-[88svh]"
      : "min-h-[62svh] lg:min-h-[70svh]";

  return (
    <section className="relative isolate w-full overflow-hidden bg-[var(--mach-ink)]">
      <div className="absolute inset-0">
        {/* Greyscale keeps campaign photography inside the monochrome
            identity whatever the client uploads. */}
        <MachMedia slot={banner.media} className="grayscale" />
      </div>
      <MachScrim
        opacity={banner.overlayOpacity ?? 45}
        theme={theme === "dark" ? "dark" : "light"}
      />

      <div
        className={`relative z-10 flex w-full ${heightCls} ${verticalAlignClasses(
          vAlign,
        )}`}>
        <div className="w-full px-5 py-14 sm:px-8 sm:py-16 lg:px-12 lg:py-20 xl:px-16">
          <div
            className={`flex w-full max-w-2xl flex-col lg:max-w-3xl ${alignClasses(
              align,
            )}`}>
            {banner.eyebrow && (
              <Reveal variant="fadeIn">
                <p className={`${EYEBROW} ${text.eyebrow}`}>
                  <span
                    aria-hidden="true"
                    className={`inline-block h-[2px] w-6 shrink-0 ${text.tick}`}
                  />
                  {banner.eyebrow}
                </p>
              </Reveal>
            )}

            {banner.title && (
              <Reveal variant="fadeUp" delay={0.12}>
                <h2 className={`mt-5 ${HEADING} ${text.heading}`}>
                  {banner.title}
                </h2>
              </Reveal>
            )}

            {banner.body && (
              <Reveal variant="fadeUp" delay={0.22}>
                <p
                  className={`mt-5 max-w-md text-[15px] leading-relaxed sm:text-base ${text.body}`}>
                  {banner.body}
                </p>
              </Reveal>
            )}

            {showCta && (
              <Reveal variant="fadeUp" delay={0.32}>
                <div className="mt-9">
                  <a href={banner.ctaLink as string} className={cta.primary}>
                    {banner.ctaText}
                  </a>
                </div>
              </Reveal>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
