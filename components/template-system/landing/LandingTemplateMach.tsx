import { useMemo } from "react";
import type { HomepageContent } from "#root/shared/types/homepage-content";
import {
  CAMPAIGN_SECTION_PREFIX,
  DEFAULT_DISCOUNTED_LIMIT,
  resolveProductSectionDisplayMode,
  resolveSectionOrder,
} from "#root/shared/types/homepage-content";
import {
  groupCategoryIds,
  indexGroupSections,
  isGroupSectionKey,
  type ResolvedGroupSection,
} from "#root/shared/types/homepage-group-sections";
import type { FeaturedProduct } from "../home/HomeFeaturedProducts";
import type { CategoryStripItem } from "#root/components/shop/CategoryStrip";
import type { NewArrivalProduct } from "#root/components/shop/NewArrivals";
import { MachChrome } from "../mach/MachChrome";
import { MachPromoBanner } from "../mach/MachPromoBanner";
import { normalizeMediaUrl } from "../mach/MachMedia";
import { MachHero } from "../mach/sections/MachHero";
import { MachMarquee } from "../mach/sections/MachMarquee";
import { MachCategoryTiles } from "../mach/sections/MachCategoryTiles";
import { MachCampaignBanner } from "../mach/sections/MachCampaignBanner";
import { MachWhy } from "../mach/sections/MachWhy";
import { MachCertificates } from "../mach/sections/MachCertificates";
import { MachNewsletter } from "../mach/sections/MachNewsletter";
import { MachClosingCta } from "../mach/sections/MachClosingCta";
import {
  resolveRowGrounds,
  type MachRowRenderState,
} from "./mach-row-grounds";
import { groupSectionRenders } from "./mach-group-rendering";
import { MachProductSection } from "./MachProductSection";

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
  /** Hand-picked "Featured" shelf. */
  featuredShelf?: FeaturedProduct[];
  /**
   * The store's broad group sections, reconciled by the route against the live
   * category list. One per broad group, in broad-group order.
   */
  groupSections?: ResolvedGroupSection[];
  /** Products for each group section, keyed by category id. */
  groupProducts?: Record<
    string,
    { products: FeaturedProduct[]; isLoading: boolean }
  >;
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
 * Above everything sits the promotional bar (`content.promoBanner`), which
 * is chrome rather than a section: it is portaled above the navbar and is
 * not part of the section order.
 *
 * The page opens the way the reference supplement stores open: hero, a
 * promotional strip, then **one band of broad-group discovery** — full-bleed
 * campaign tiles that send a shopper into Supplements, Stacks & Bundles, Gym
 * Gear or whatever the store's groups are. That band is navigation, not
 * merchandising; the merchandising rows of real products start underneath it.
 *
 * Below it the page keeps two kinds of section apart, which is the distinction
 * the whole composition rests on:
 *
 *  - **Group sections** merchandise one broad group each, addressed as
 *    `group:<categoryId>`. How many there are is the client's business, not
 *    this file's — they are reconciled against the category system on every
 *    load, so opening a fourth group produces a fourth section.
 *  - **Merchandising sections** — Best Sellers, New Drops, Featured, Offers —
 *    cut across the catalogue and are not groups. Each is independent; none is
 *    a renamed stand-in for another.
 *
 * Order below the hero: promotional strip, group discovery, the group
 * sections, then the merchandising rows broken up by full-bleed lifestyle
 * campaigns, then trust (why / certificates / manufacturing) and capture.
 *
 * Two rules hold the whole file together:
 *
 *  1. **No storefront copy lives here.** Every heading, label, destination and
 *     image is read from `content` (homepage CMS), from the category system,
 *     or from Layout Settings. This component decides how things look and in
 *     what order, never what they say — there is no product, group or category
 *     name written anywhere in this file.
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
  featuredShelf = [],
  groupSections = [],
  groupProducts = {},
  className = "",
  onCtaClick,
}: LandingTemplateMachProps) {
  const banners = useMemo(
    () => content.campaignBanners ?? [],
    [content.campaignBanners],
  );

  const groupsByKey = useMemo(
    () => indexGroupSections(groupSections),
    [groupSections],
  );

  const order = useMemo(
    () =>
      resolveSectionOrder(
        content.sectionOrder,
        banners.map((b) => b.id),
        groupCategoryIds(groupSections.map((s) => s.category)),
      ),
    [content.sectionOrder, banners, groupSections],
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
      ...groupSections.map(
        (section) => groupProducts[section.category.id]?.products ?? [],
      ),
      featuredProducts,
      featuredShelf,
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
    groupSections,
    groupProducts,
    featuredProducts,
    featuredShelf,
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
  const rowRenders = useMemo<MachRowRenderState>(() => {
    const renders: MachRowRenderState = {
      newArrivals:
        Boolean(content.newArrivals?.enabled) &&
        !newArrivalsLoading &&
        newArrivals.length > 0,
      featuredProducts:
        Boolean(content.featuredProducts.enabled) && featuredProducts.length > 0,
      featuredShelf:
        Boolean(content.featuredShelf?.enabled) && featuredShelf.length > 0,
    };
    // Group rows join the same map under their own order keys, so a group the
    // client added is part of the page's rhythm without this component knowing
    // how many groups there are.
    for (const section of groupSections) {
      renders[section.key] = groupSectionRenders(
        section,
        groupProducts[section.category.id],
      );
    }
    return renders;
  }, [
    content.newArrivals?.enabled,
    content.featuredProducts.enabled,
    content.featuredShelf?.enabled,
    newArrivalsLoading,
    newArrivals.length,
    featuredProducts.length,
    featuredShelf.length,
    groupSections,
    groupProducts,
  ]);

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

    // Broad group sections, addressed by category id. Every heading, label and
    // destination below comes from the group's CMS config or from the category
    // itself — no group name or slug is written into this component, which is
    // what lets a fourth group render without a deploy.
    if (isGroupSectionKey(key)) {
      const section = groupsByKey.get(key);
      if (!section || !rowRenders[key]) return null;

      const resolved = groupProducts[section.category.id];
      const products = resolved?.products ?? [];
      const shared = {
        id: `group-${section.category.slug}`,
        title: section.heading,
        subtitle: section.subtitle,
        actionLabel: section.viewAllText,
        actionHref: section.viewAllLink,
        products,
        isLoading: resolved?.isLoading ?? false,
        ground: rowGrounds.get(key),
      };

      // Two independent choices the client made. `displayMode` decides whether
      // the group is laid out or scrolled; `presentation` decides which layout
      // it uses when it is laid out — feature panels compose for the two or
      // three items a bundles group carries, the dense shelf is the normal
      // merchandising row. A group set to carousel keeps its presentation
      // stored and unread, so switching back restores it.
      return (
        <MachProductSection
          key={key}
          {...shared}
          displayMode={section.displayMode}
          presentation={section.presentation}
        />
      );
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

      case "featuredProducts":
        return rowRenders.featuredProducts ? (
          <MachProductSection
            key={key}
            id="products"
            title={content.featuredProducts.title}
            subtitle={content.featuredProducts.subtitle}
            actionLabel={content.featuredProducts.viewAllText}
            actionHref={content.featuredProducts.viewAllLink}
            products={featuredProducts}
            ground={rowGrounds.get("featuredProducts")}
            displayMode={resolveProductSectionDisplayMode(
              content.featuredProducts.displayMode,
            )}
          />
        ) : null;

      case "featuredShelf": {
        // A real section, not a renamed one. It sits alongside Best Sellers
        // rather than instead of it, and shows exactly what the client picked.
        const featured = content.featuredShelf;
        return rowRenders.featuredShelf && featured ? (
          <MachProductSection
            key={key}
            id="featured"
            title={featured.title}
            subtitle={featured.subtitle}
            actionLabel={featured.viewAllText}
            actionHref={featured.viewAllLink}
            products={featuredShelf}
            ground={rowGrounds.get("featuredShelf")}
            displayMode={resolveProductSectionDisplayMode(
              featured.displayMode,
            )}
          />
        ) : null;
      }

      case "discountedProducts":
        return content.discountedProducts?.enabled ? (
          <MachProductSection
            key={key}
            id="offers"
            title={content.discountedProducts.title}
            actionLabel={content.discountedProducts.viewAllText}
            actionHref={content.discountedProducts.viewAllLink}
            products={offersOnShelf}
            /* Offers is the page's dark merchandising anchor, in either
               arrangement. Scrolling a shelf is not a reason to relight it. */
            ground="ink"
            displayMode={resolveProductSectionDisplayMode(
              content.discountedProducts.displayMode,
            )}
          />
        ) : null;

      case "newArrivals": {
        const newDrops = content.newArrivals;
        return rowRenders.newArrivals && newDrops ? (
          <MachProductSection
            key={key}
            id="new-drops"
            title={newDrops.title}
            actionLabel={newDrops.viewAllText}
            actionHref={newDrops.viewAllLink}
            products={newArrivals}
            isLoading={newArrivalsLoading}
            ground={rowGrounds.get("newArrivals")}
            displayMode={resolveProductSectionDisplayMode(
              newDrops.displayMode,
            )}
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
      {/* The promotional bar is not a section of this page: it is portaled
          into the global chrome above the navbar, so it stays with the
          navigation rather than scrolling away with the hero. Nothing about
          the section order below applies to it. */}
      <MachPromoBanner content={content.promoBanner} />
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
