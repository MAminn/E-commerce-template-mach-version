import { useMemo } from "react";
import type { HomepageContent } from "#root/shared/types/homepage-content";
import {
  CAMPAIGN_SECTION_PREFIX,
  DEFAULT_DISCOUNTED_LIMIT,
  resolveSectionOrder,
} from "#root/shared/types/homepage-content";
import type { FeaturedProduct } from "../home/HomeFeaturedProducts";
import type { CategoryStripItem } from "#root/components/shop/CategoryStrip";
import type { NewArrivalProduct } from "#root/components/shop/NewArrivals";
import { MachChrome } from "../mach/MachChrome";
import { normalizeMediaUrl } from "../mach/MachMedia";
import { MachHero } from "../mach/sections/MachHero";
import { MachMarquee } from "../mach/sections/MachMarquee";
import { MachProductRow } from "../mach/sections/MachProductRow";
import { MachCategoryTiles } from "../mach/sections/MachCategoryTiles";
import { MachStackShowcase } from "../mach/sections/MachStackShowcase";
import { MachCampaignBanner } from "../mach/sections/MachCampaignBanner";
import { MachWhy } from "../mach/sections/MachWhy";
import { MachCertificates } from "../mach/sections/MachCertificates";
import { MachNewsletter } from "../mach/sections/MachNewsletter";
import { MachClosingCta } from "../mach/sections/MachClosingCta";
import {
  resolveRowGrounds,
  type MachRowRenderState,
} from "./mach-row-grounds";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface LandingTemplateMachProps {
  content: HomepageContent;
  featuredProducts?: FeaturedProduct[];
  discountedProducts?: FeaturedProduct[];
  /** The store's broad groups, for the discovery band under the hero. */
  categories?: CategoryStripItem[];
  categoriesLoading?: boolean;
  newArrivals?: NewArrivalProduct[];
  newArrivalsLoading?: boolean;
  /** "Stacks & Bundles" — resolved by the route from CMS selection. */
  stacksProducts?: FeaturedProduct[];
  stacksLoading?: boolean;
  /** "Gym Gear" — resolved by the route from CMS selection. */
  gymGearProducts?: FeaturedProduct[];
  gymGearLoading?: boolean;
  className?: string;
  onCtaClick?: (link: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

/**
 * Mach Supplements storefront homepage.
 *
 * A purpose-built supplement storefront on the existing ecommerce platform —
 * not the editorial fashion template with new words in it.
 *
 * The page opens the way the reference supplement stores open: hero, a
 * promotional strip, then **one band of broad-group discovery** — three
 * full-bleed campaign tiles that send a shopper into Supplements, Stacks &
 * Bundles or Gym Gear. That band is navigation, not merchandising; the
 * merchandising rows of real products start underneath it.
 *
 * The store is still not a deep category tree. Three doors is the whole
 * taxonomy the homepage admits to, and New Drops, Offers and Featured below
 * remain merchandising slots rather than categories.
 *
 * Order below the hero: promotional strip, group discovery, the product rows
 * broken up by full-bleed lifestyle campaigns, then trust (why / certificates
 * / manufacturing) and capture.
 *
 * Two rules hold the whole file together:
 *
 *  1. **No storefront copy lives here.** Every heading, label, destination and
 *     image is read from `content` (homepage CMS) or Layout Settings. This
 *     component decides how things look and in what order, never what they
 *     say.
 *
 *  2. **Sections below the hero render in the client's order.** The sequence
 *     comes from `content.sectionOrder`, so reordering the page is a CMS
 *     action, not a deploy. The hero stays pinned at the top because the
 *     navbar's transparent-over-hero behaviour depends on it being first.
 *
 * Merchandising sections with nothing to show render nothing at all. The
 * catalog is mid-population; an empty bordered placeholder reads as broken,
 * and designing the composition around an empty database would be designing
 * for a state that lasts a week.
 */
export function LandingTemplateMach({
  content,
  featuredProducts = [],
  discountedProducts = [],
  categories = [],
  newArrivals = [],
  newArrivalsLoading = false,
  stacksProducts = [],
  stacksLoading = false,
  gymGearProducts = [],
  gymGearLoading = false,
  className = "",
  onCtaClick,
}: LandingTemplateMachProps) {
  const banners = useMemo(
    () => content.campaignBanners ?? [],
    [content.campaignBanners],
  );

  const order = useMemo(
    () =>
      resolveSectionOrder(
        content.sectionOrder,
        banners.map((b) => b.id),
      ),
    [content.sectionOrder, banners],
  );

  const bannersById = useMemo(
    () => new Map(banners.map((b) => [b.id, b])),
    [banners],
  );

  /**
   * A picture for each broad group, for tiles whose category has no artwork
   * uploaded yet.
   *
   * The discovery band is entirely carried by imagery, and the category system
   * ships with an empty artwork slot — a store that has not shot group
   * campaigns yet would otherwise get three black rectangles under its hero.
   * Every product on this page already declares which groups it belongs to, so
   * the first product found in a group lends the tile its shot. Real catalogue
   * data, no invented media, and category artwork overrides it the moment the
   * client uploads any.
   */
  const groupFallbackImages = useMemo(() => {
    const byCategory = new Map<string, string>();
    const pools = [
      stacksProducts,
      gymGearProducts,
      featuredProducts,
      newArrivals,
      discountedProducts,
    ];
    for (const pool of pools) {
      for (const product of pool) {
        const url =
          product.images?.find((i) => i.isPrimary)?.url ??
          product.images?.[0]?.url ??
          product.imageUrl;
        if (!url) continue;
        for (const c of product.categories ?? []) {
          if (!byCategory.has(c.id)) byCategory.set(c.id, normalizeMediaUrl(url));
        }
      }
    }
    return byCategory;
  }, [
    stacksProducts,
    gymGearProducts,
    featuredProducts,
    newArrivals,
    discountedProducts,
  ]);

  /**
   * Whether each merchandising row will actually put something on the page.
   *
   * One predicate per row, read by both the ground alternation below and the
   * row's own branch in `renderSection`. The row components already return
   * `null` while loading or with an empty product list, so this is not a new
   * rule — it is the existing rule stated once, where the layout can see it,
   * instead of only inside each component where the page composition could
   * not.
   */
  const rowRenders = useMemo<MachRowRenderState>(
    () => ({
      stacks:
        Boolean(content.stacks?.enabled) &&
        !stacksLoading &&
        stacksProducts.length > 0,
      newArrivals:
        Boolean(content.newArrivals?.enabled) &&
        !newArrivalsLoading &&
        newArrivals.length > 0,
      featuredProducts:
        Boolean(content.featuredProducts.enabled) && featuredProducts.length > 0,
      gymGear:
        Boolean(content.gymGear?.enabled) &&
        !gymGearLoading &&
        gymGearProducts.length > 0,
    }),
    [
      content.stacks?.enabled,
      content.newArrivals?.enabled,
      content.featuredProducts.enabled,
      content.gymGear?.enabled,
      stacksLoading,
      stacksProducts.length,
      newArrivalsLoading,
      newArrivals.length,
      featuredProducts.length,
      gymGearLoading,
      gymGearProducts.length,
    ],
  );

  /**
   * Grounds for the merchandising rows, assigned by position rather than
   * pinned per section.
   *
   * The page's black/white rhythm has to survive the client reordering the
   * sections — hard-coding "Stacks is paper, Gym Gear is paper" would put two
   * identical grounds side by side the moment one of them moves. So the group
   * and product rows simply alternate paper / white in whatever order they end
   * up in, and Offers stays on ink as the page's dark merchandising anchor.
   *
   * Only rows that render take a turn: a hidden one used to consume an
   * alternation slot and hand two visible neighbours the same ground.
   */
  const rowGrounds = useMemo(
    () => resolveRowGrounds(order, rowRenders),
    [order, rowRenders],
  );

  /**
   * How many offers the homepage shelf carries — the merchant's setting, read
   * from the CMS.
   *
   * The offers query returns everything currently discounted, which on a busy
   * sale wraps the shelf onto a second row. How many to put on the homepage is
   * a merchandising decision, so it lives in Homepage Admin next to the rest of
   * the offers controls; this component only applies it. Content saved before
   * the field existed has no value, which is what the default covers.
   */
  const offersOnShelf = useMemo(() => {
    const limit = content.discountedProducts?.limit ?? DEFAULT_DISCOUNTED_LIMIT;
    return discountedProducts.slice(0, Math.max(1, limit));
  }, [discountedProducts, content.discountedProducts?.limit]);

  const renderSection = (key: string) => {
    // Campaign banners are addressed dynamically so a banner added in the CMS
    // can be dropped anywhere in the sequence.
    if (key.startsWith(CAMPAIGN_SECTION_PREFIX)) {
      const banner = bannersById.get(key.slice(CAMPAIGN_SECTION_PREFIX.length));
      if (!banner) return null;
      return <MachCampaignBanner key={key} banner={banner} />;
    }

    switch (key) {
      case "heroMarquee":
        return content.heroMarquee?.enabled ? (
          <MachMarquee key={key} content={content.heroMarquee} />
        ) : null;

      case "categories":
        // Broad-group discovery: the only navigation block on the page, and
        // the shopper's way into a whole part of the store rather than into
        // one product.
        return content.categories?.enabled ? (
          <MachCategoryTiles
            key={key}
            content={content.categories}
            categories={categories}
            fallbackImages={groupFallbackImages}
          />
        ) : null;

      case "stacks": {
        // Not a product row. The store carries two or three bundles on
        // purpose, so this one composes for the count it is given instead of
        // dropping them into a four-up shelf with two holes in it.
        const stacks = content.stacks;
        return rowRenders.stacks && stacks ? (
          <MachStackShowcase
            key={key}
            id="stacks"
            title={stacks.title}
            subtitle={stacks.subtitle}
            actionLabel={stacks.viewAllText}
            actionHref={stacks.viewAllLink}
            products={stacksProducts}
            isLoading={stacksLoading}
            ground={rowGrounds.get("stacks")}
          />
        ) : null;
      }

      case "gymGear": {
        const gymGear = content.gymGear;
        return rowRenders.gymGear && gymGear ? (
          <MachProductRow
            key={key}
            id="gym-gear"
            title={gymGear.title}
            subtitle={gymGear.subtitle}
            actionLabel={gymGear.viewAllText}
            actionHref={gymGear.viewAllLink}
            products={gymGearProducts}
            isLoading={gymGearLoading}
            ground={rowGrounds.get("gymGear")}
            dense
          />
        ) : null;
      }

      case "featuredProducts":
        return rowRenders.featuredProducts ? (
          <MachProductRow
            key={key}
            id="products"
            title={content.featuredProducts.title}
            subtitle={content.featuredProducts.subtitle}
            actionLabel={content.featuredProducts.viewAllText}
            actionHref={content.featuredProducts.viewAllLink}
            products={featuredProducts}
            ground={rowGrounds.get("featuredProducts")}
            dense
          />
        ) : null;

      case "discountedProducts":
        return content.discountedProducts?.enabled ? (
          <MachProductRow
            key={key}
            id="offers"
            title={content.discountedProducts.title}
            actionLabel={content.discountedProducts.viewAllText}
            actionHref={content.discountedProducts.viewAllLink}
            products={offersOnShelf}
            ground="ink"
            dense
          />
        ) : null;

      case "newArrivals": {
        const newDrops = content.newArrivals;
        return rowRenders.newArrivals && newDrops ? (
          <MachProductRow
            key={key}
            id="new-drops"
            title={newDrops.title}
            actionLabel={newDrops.viewAllText}
            actionHref={newDrops.viewAllLink}
            products={newArrivals}
            isLoading={newArrivalsLoading}
            ground={rowGrounds.get("newArrivals")}
            dense
          />
        ) : null;
      }

      case "whyMach":
        return content.whyMach?.enabled ? (
          <MachWhy key={key} content={content.whyMach} />
        ) : null;

      case "certificates":
        return content.certificates?.enabled ? (
          <MachCertificates key={key} content={content.certificates} />
        ) : null;

      case "ugc":
        // Reserved. The review system does not carry media yet, so there is
        // nothing to render — the slot exists so the composition and the CMS
        // are ready when it does.
        return null;

      case "newsletter":
        return content.newsletter.enabled ? (
          <MachNewsletter key={key} content={content.newsletter} />
        ) : null;

      case "footerCta":
        return content.footerCta.enabled ? (
          <MachClosingCta
            key={key}
            content={content.footerCta}
            onCtaClick={onCtaClick}
          />
        ) : null;

      default:
        return null;
    }
  };

  return (
    <MachChrome hasPageNewsletter={content.newsletter.enabled}>
      <div
        className={`landing-template-mach overflow-x-clip bg-[var(--mach-paper)] ${className}`}>
        {content.hero.enabled && (
          <MachHero content={content.hero} onCtaClick={onCtaClick} />
        )}
        {order.map(renderSection)}
      </div>
    </MachChrome>
  );
}
