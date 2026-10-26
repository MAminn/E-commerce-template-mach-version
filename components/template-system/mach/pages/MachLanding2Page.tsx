import type { HomepageHeroContent } from "#root/shared/types/homepage-content";
import {
  LANDING_PRODUCTS_ANCHOR,
  type LandingPageHero,
} from "#root/shared/landing-page/config";
import { MachProductCard, type MachProduct } from "../MachProductCard";
import { MachHero } from "../sections/MachHero";
import { MachSectionHead } from "../sections/MachSectionHead";
import { GUTTER, SHELL } from "../machTokens";

/**
 * /landing-2 — the fixed marketing landing page, built for ad traffic.
 *
 * Two sections and nothing else: the campaign hero and the products. Neither
 * is new design. The hero is the homepage's `MachHero` in its full-bleed
 * layout (one image or video across the frame, copy overlaid), and the
 * products are `MachProductCard`s in the shop grid's arrangement — two up on a
 * phone, so a shopper arriving from an ad sees products, prices and Add to
 * Cart without swiping a shelf.
 *
 * Nothing here is copy. Headline, subtitle, button, media and the product
 * list come from Dashboard → Landing 2; name, photo, price, discount and stock
 * come from the catalogue on every request.
 */

/** Same grid the shop page uses, so the cards read the way they do there. */
const GRID =
  "grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 sm:gap-y-14 md:grid-cols-3 lg:gap-x-7 lg:gap-y-16 xl:grid-cols-4 xl:gap-x-8";

/** The landing hero expressed as the homepage hero's content shape. */
export function landingHeroContent(hero: LandingPageHero): HomepageHeroContent {
  return {
    enabled: true,
    title: hero.title,
    // MachHero's `subtitle` is the small eyebrow above the headline; the
    // landing subtitle is the supporting line beneath it.
    subtitle: "",
    supportingText: hero.subtitle,
    ctaText: hero.ctaText,
    ctaLink: hero.ctaLink,
    media: hero.media,
    mediaLayout: "full-bleed",
    align: hero.align,
    verticalAlign: hero.verticalAlign,
    textTheme: hero.textTheme,
    overlayOpacity: hero.overlayOpacity,
  };
}

export function MachLanding2Page({
  hero,
  productsTitle,
  products,
}: {
  hero: LandingPageHero;
  productsTitle: string;
  products: MachProduct[];
}) {
  return (
    <>
      <MachHero content={landingHeroContent(hero)} />

      {products.length > 0 && (
        <section
          id={LANDING_PRODUCTS_ANCHOR}
          className="scroll-mt-20 bg-[var(--mach-ink)] text-white">
          <div className={`${SHELL} ${GUTTER} py-12 sm:py-14 lg:py-20`}>
            {productsTitle && (
              <MachSectionHead title={productsTitle} onDark size="sm" />
            )}
            <div className={`${GRID} ${productsTitle ? "mt-8 lg:mt-10" : ""}`}>
              {products.map((product) => (
                <MachProductCard
                  key={product.id}
                  product={product}
                  variant="shop"
                  onDark
                />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
