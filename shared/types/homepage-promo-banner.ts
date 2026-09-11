import type { HomepagePromoBannerContent } from "./homepage-content";
import { isUnsafeLink } from "./homepage-campaign-banners";
import { isPlaceholderLink } from "./layout-settings";

/**
 * What the promotional banner should put on the page, if anything.
 *
 * The promotional banner is the one-line announcement bar at the very top of
 * the storefront, above the navigation — `content.promoBanner`. It is a
 * different feature from the marquee under the hero (`heroMarquee`) and from
 * the full-bleed campaign banners between product rows (`campaignBanners`);
 * the three were confused for one another once, which is why this file spells
 * out which one it is.
 *
 * The rules are the ones `LandingTemplateModern` has always applied to the
 * same field, stated once so the Mach storefront cannot drift from them, plus
 * the destination check every other CMS link on Mach already gets:
 *
 *  - switched off → nothing
 *  - no text and no usable link → nothing, rather than an empty black bar
 *  - a link needs both a label and a destination, and the destination has to
 *    be somewhere a browser can go — not empty, not `#`, not the project's
 *    `#soon` placeholder, and never a scheme that executes
 */
export interface ResolvedPromoBanner {
  text: string;
  link: { label: string; href: string } | null;
}

export function resolvePromoBanner(
  banner: HomepagePromoBannerContent | undefined | null,
): ResolvedPromoBanner | null {
  if (!banner?.enabled) return null;

  const text = (banner.text ?? "").trim();
  const label = (banner.linkText ?? "").trim();
  const href = (banner.linkUrl ?? "").trim();

  const link =
    label && href && !isPlaceholderLink(href) && !isUnsafeLink(href)
      ? { label, href }
      : null;

  if (!text && !link) return null;
  return { text, link };
}
