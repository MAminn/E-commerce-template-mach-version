import type { CampaignBannerContent } from "#root/shared/types/homepage-content";
import { isMediaSlotEmpty } from "#root/shared/types/homepage-content";
import { campaignBannerCtaHref } from "#root/shared/types/homepage-campaign-banners";
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

  // One decision, resolved once: a label with no destination, a destination
  // that is still a placeholder, and a destination that would execute rather
  // than navigate all come back as `null`, so there is no way to render the
  // button having checked something other than the href it points at.
  const ctaHref = campaignBannerCtaHref(banner);

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
                {/* `break-words` only — the type scale is unchanged. At the
                    bottom of `HEADING`'s clamp a single long word is wider
                    than a phone, and the section's `overflow-hidden` would
                    silently cut the end off it. */}
                <h2 className={`mt-5 break-words ${HEADING} ${text.heading}`}>
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

            {ctaHref && (
              <Reveal variant="fadeUp" delay={0.32}>
                <div className="mt-9 max-w-full">
                  {/* `max-w-full` + centred wrapping keeps a long CMS button
                      label inside the phone viewport instead of pushing the
                      banner wider than the screen. */}
                  <a
                    href={ctaHref}
                    className={`${cta.primary} max-w-full text-center`}>
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
