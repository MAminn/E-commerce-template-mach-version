import type {
  CampaignBannerContent,
  HomepageCertificatesContent,
  HomepageContent,
} from "#root/shared/types/homepage-content";
import {
  DEFAULT_HOMEPAGE_CONTENT,
  MACH_LANDING_TEMPLATE_ID,
  repairLegacyNewDropsTitle,
} from "#root/shared/types/homepage-content";
import {
  migrateLegacySectionOrder,
  normalizeGroupSections,
} from "#root/shared/types/homepage-group-sections";

/**
 * Single source of truth for turning a stored `homepage_content.content` blob
 * into a fully-populated `HomepageContent`.
 *
 * This used to be copy-pasted into both the tRPC read path and the SSR raw
 * read path. Any key added to one copy and not the other produced content that
 * rendered on the client but vanished during SSR — so it lives here now and
 * both paths import it.
 */

/**
 * Recursively strips null values so defaults survive a spread.
 *
 * `null` overrides a default when spread; `undefined` does not. The CMS sends
 * `null` for cleared optional fields (zod `.nullish()`), so without this a
 * client clearing one field would blank out the whole default for it.
 */
export function stripNulls<T>(obj: T): T {
  if (obj === null || obj === undefined) return undefined as unknown as T;
  if (Array.isArray(obj)) return obj.map(stripNulls) as unknown as T;
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value !== null) {
        result[key] = typeof value === "object" ? stripNulls(value) : value;
      }
    }
    return result as T;
  }
  return obj;
}

/**
 * Merges a saved campaign banner over the matching default.
 *
 * Banners are addressed by id from `sectionOrder`, so a banner the client
 * added keeps its own id while the two seeded banners inherit their defaults
 * for any field an older save predates.
 */
function mergeCampaignBanners(
  stored: CampaignBannerContent[] | undefined,
): CampaignBannerContent[] {
  const defaults = DEFAULT_HOMEPAGE_CONTENT.campaignBanners ?? [];
  if (!stored) return defaults.map((b) => ({ ...b }));

  const defaultsById = new Map(defaults.map((b) => [b.id, b]));
  return stored.map((banner) => {
    const base = defaultsById.get(banner.id);
    return base ? { ...base, ...banner } : banner;
  });
}

/**
 * Certificates need a deeper merge than a plain spread: the nested `factory`
 * block would be lost wholesale for content saved before it existed.
 */
function mergeCertificates(
  stored: Partial<HomepageCertificatesContent> | undefined,
): HomepageCertificatesContent {
  const base = DEFAULT_HOMEPAGE_CONTENT.certificates as HomepageCertificatesContent;
  if (!stored) return { ...base, factory: { ...base.factory } };
  return {
    ...base,
    ...stored,
    items: stored.items ?? base.items,
    factory: { ...base.factory, ...(stored.factory ?? {}) },
  };
}

/**
 * New Drops, with the one obsolete heading repaired on Mach.
 *
 * Before Featured had a section of its own, the only way to get a Featured row
 * onto the page was to rename New Drops to "FEATURED". Featured is a real
 * section now, so a store still carrying that heading renders two rows called
 * FEATURED and no New Drops at all. The rename is repaired on read — and only
 * that exact string, because every other heading is a decision the client made
 * rather than a workaround they were pushed into.
 */
function mergeNewArrivals(
  stored: HomepageContent["newArrivals"],
  isMach: boolean,
): HomepageContent["newArrivals"] {
  const merged = stored ?? DEFAULT_HOMEPAGE_CONTENT.newArrivals;
  if (!isMach || !merged) return merged;
  const title = repairLegacyNewDropsTitle(merged.title) ?? merged.title;
  return title === merged.title ? merged : { ...merged, title };
}

/**
 * Merges stored content with defaults so every required field exists,
 * whatever vintage the saved blob is.
 */
export function mergeHomepageContentWithDefaults(
  storedContent: Partial<HomepageContent>,
  templateId?: string,
): HomepageContent {
  const clean = stripNulls(storedContent);
  // Scoped to Mach by the template id the content is stored under, because the
  // heading it repairs is a leftover of a Mach-only workaround. Other
  // templates never had a Featured section to work around and keep whatever
  // they saved.
  const isMach = templateId === MACH_LANDING_TEMPLATE_ID;

  return {
    meta: { ...DEFAULT_HOMEPAGE_CONTENT.meta, ...clean.meta },
    hero: { ...DEFAULT_HOMEPAGE_CONTENT.hero, ...clean.hero },
    brandStatement: {
      ...DEFAULT_HOMEPAGE_CONTENT.brandStatement,
      ...clean.brandStatement,
    },
    promoBanner: {
      ...DEFAULT_HOMEPAGE_CONTENT.promoBanner,
      ...clean.promoBanner,
    },
    categories: { ...DEFAULT_HOMEPAGE_CONTENT.categories, ...clean.categories },
    featuredProducts: {
      ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
      ...clean.featuredProducts,
    },
    valueProps: {
      ...DEFAULT_HOMEPAGE_CONTENT.valueProps,
      ...(clean.valueProps || {}),
      items:
        clean.valueProps?.items || DEFAULT_HOMEPAGE_CONTENT.valueProps.items,
    },
    newsletter: { ...DEFAULT_HOMEPAGE_CONTENT.newsletter, ...clean.newsletter },
    footerCta: { ...DEFAULT_HOMEPAGE_CONTENT.footerCta, ...clean.footerCta },
    discountedProducts:
      clean.discountedProducts ?? DEFAULT_HOMEPAGE_CONTENT.discountedProducts,
    newArrivals: mergeNewArrivals(clean.newArrivals, isMach),
    marquee: clean.marquee ?? DEFAULT_HOMEPAGE_CONTENT.marquee,
    promoLine: clean.promoLine ?? DEFAULT_HOMEPAGE_CONTENT.promoLine,
    contactBanner:
      clean.contactBanner ?? DEFAULT_HOMEPAGE_CONTENT.contactBanner,
    bottomCarousel:
      clean.bottomCarousel ?? DEFAULT_HOMEPAGE_CONTENT.bottomCarousel,
    aboutUs: clean.aboutUs ?? DEFAULT_HOMEPAGE_CONTENT.aboutUs,
    returnPolicy: clean.returnPolicy ?? DEFAULT_HOMEPAGE_CONTENT.returnPolicy,
    productCarouselTitle:
      clean.productCarouselTitle ??
      DEFAULT_HOMEPAGE_CONTENT.productCarouselTitle,
    productCarouselTitleAr:
      clean.productCarouselTitleAr ??
      DEFAULT_HOMEPAGE_CONTENT.productCarouselTitleAr,
    testimonials: clean.testimonials ?? DEFAULT_HOMEPAGE_CONTENT.testimonials,

    // ── Mach storefront sections ──
    heroMarquee: {
      ...DEFAULT_HOMEPAGE_CONTENT.heroMarquee!,
      ...clean.heroMarquee,
    },
    // Deprecated group slots. Still merged so nothing that reads them breaks,
    // but the storefront and the admin work from `groupSections` below.
    stacks: { ...DEFAULT_HOMEPAGE_CONTENT.stacks!, ...clean.stacks },
    gymGear: { ...DEFAULT_HOMEPAGE_CONTENT.gymGear!, ...clean.gymGear },
    // The one place legacy group content becomes generic group content, so
    // SSR, the client read path and Homepage Admin all see the same shape and
    // no stored blob needs editing by hand. Idempotent: a legacy row only
    // seeds a category that has no section yet, so the client's first save
    // takes over permanently.
    groupSections: normalizeGroupSections(clean),
    featuredShelf: {
      ...DEFAULT_HOMEPAGE_CONTENT.featuredShelf!,
      ...clean.featuredShelf,
    },
    campaignBanners: mergeCampaignBanners(clean.campaignBanners),
    whyMach: {
      ...DEFAULT_HOMEPAGE_CONTENT.whyMach!,
      ...clean.whyMach,
      items: clean.whyMach?.items ?? DEFAULT_HOMEPAGE_CONTENT.whyMach!.items,
    },
    certificates: mergeCertificates(clean.certificates),
    ugc: { ...DEFAULT_HOMEPAGE_CONTENT.ugc!, ...clean.ugc },
    // Left undefined when unsaved so `resolveSectionOrder` falls through to the
    // default composition rather than locking in an empty order. The two
    // legacy group keys are rewritten to their `group:<categoryId>` keys in
    // place, so a client's saved arrangement survives the move to dynamic
    // groups instead of Stacks jumping to wherever the new key gets inserted.
    sectionOrder: migrateLegacySectionOrder(clean.sectionOrder, clean),
  };
}
