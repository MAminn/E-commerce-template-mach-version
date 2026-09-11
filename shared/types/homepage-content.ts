/**
 * Homepage Content Management Schema
 *
 * This file defines the content structure for the homepage that merchants can edit.
 * Layout and styling are NOT part of this schema - only editable content.
 */

/* ------------------------------------------------------------------ */
/*  Shared content primitives                                         */
/* ------------------------------------------------------------------ */

/** What a MediaSlot is pointing at. */
export type MediaKind = "image" | "video";

/**
 * A single CMS-managed media slot.
 *
 * Every large visual on the storefront (hero, campaign banners, category
 * artwork, factory shot) uses this shape so the client gets the same controls
 * everywhere: a desktop asset, an optional dedicated mobile crop, and — for
 * video — a poster frame that shows before playback starts.
 *
 * `focalPoint` drives CSS `object-position` so hard full-bleed crops can be
 * re-centred from the CMS instead of needing the image re-cut.
 */
export interface MediaSlot {
  kind: MediaKind;
  /** Desktop / default asset URL. Empty string means "not set yet". */
  desktopUrl: string;
  /** Dedicated mobile crop. Falls back to desktopUrl when empty. */
  mobileUrl?: string;
  /** Poster frame for video slots. Ignored for images. */
  posterUrl?: string;
  alt?: string;
  /** Percentages, 0-100. Defaults to dead centre (50/50). */
  focalPoint?: { x: number; y: number };
}

/** How the hero arranges its copy against its media. */
export type HeroMediaLayout = "split" | "full-bleed";

/** Horizontal placement of a text block over media. */
export type TextAlign = "left" | "center" | "right";

/** Vertical placement of a text block over media. */
export type TextVerticalAlign = "top" | "middle" | "bottom";

/** Which way text has to read against the media behind it. */
export type TextTheme = "light" | "dark";

/** Empty media slot — the shape the CMS starts every new slot from. */
export const EMPTY_MEDIA_SLOT: MediaSlot = {
  kind: "image",
  desktopUrl: "",
  mobileUrl: "",
  posterUrl: "",
  alt: "",
};

/** True when a slot has nothing to render. */
export function isMediaSlotEmpty(slot: MediaSlot | undefined | null): boolean {
  if (!slot) return true;
  return !(slot.desktopUrl || "").trim() && !(slot.mobileUrl || "").trim();
}

/**
 * Meta information for SEO and page head
 */
export interface HomepageMetaContent {
  enabled: boolean;
  pageTitle: string;
  pageDescription: string;
}

/**
 * A single hero carousel slide
 */
export interface HeroSlideContent {
  id: string;
  imageUrl: string;
  mobileImageUrl?: string;
  linkUrl?: string;
  alt?: string;
}

/**
 * Hero section content
 */
export interface HomepageHeroContent {
  enabled: boolean;
  title: string;
  subtitle: string;
  /** Short supporting paragraph rendered under the headline. Optional. */
  supportingText?: string;
  ctaText: string;
  ctaLink: string;
  backgroundImage?: string;
  /** Mobile-specific hero background image. Falls back to backgroundImage if empty. */
  mobileBackgroundImage?: string;
  /** Multiple hero carousel slides (takes priority over backgroundImage if non-empty) */
  heroSlides?: HeroSlideContent[];

  /* ── Campaign hero controls (Mach) ── */
  /**
   * Primary campaign media. Supersedes backgroundImage/mobileBackgroundImage,
   * which are kept so content saved before the Mach rebuild still renders.
   */
  media?: MediaSlot;
  /**
   * Foreground product cut-out laid over the campaign scene.
   *
   * This is the hero's focal point — a pack shot on a transparent background
   * (PNG / WebP), lit and grounded by the template rather than baked into the
   * photograph. Keeping it separate from `media` is what lets the same hero
   * work as a full lifestyle campaign, as a studio product shot on black, or
   * as pure type, without re-cutting artwork every time the campaign changes.
   */
  productMedia?: MediaSlot;
  /**
   * How large the cut-out renders, as a percentage of the template's default
   * size. 60-140, defaults to 100. Pack shots arrive framed very differently
   * from one another; this is the client's way of matching them without
   * re-exporting the asset.
   */
  productScale?: number;
  /**
   * How the hero arranges copy against media.
   *
   *  `split`      copy in the left column, media held in a framed stage down
   *               the right — the default, and the composition the campaign
   *               artwork is being produced for.
   *  `full-bleed` the scene covers the whole frame and the copy is overlaid,
   *               for the occasions where a single photograph is the whole
   *               idea and cropping it into a column would waste it.
   */
  mediaLayout?: HeroMediaLayout;
  /** Secondary / outline CTA shown beside the primary one. */
  secondaryCtaText?: string;
  secondaryCtaLink?: string;
  /** Where the text block sits within the hero. */
  align?: TextAlign;
  verticalAlign?: TextVerticalAlign;
  /** Whether the copy reads light-on-dark or dark-on-light. */
  textTheme?: TextTheme;
  /** Scrim strength over the media, 0-100. */
  overlayOpacity?: number;
}

/**
 * Brand statement section content
 */
export interface HomepageBrandStatementContent {
  enabled: boolean;
  title: string;
  description: string;
  image?: string;
}

/**
 * Promotional banner content
 */
export interface HomepagePromoBannerContent {
  enabled: boolean;
  text: string;
  linkText?: string;
  linkUrl?: string;
}

/**
 * Icon types for value propositions
 */
export enum ValuePropIconType {
  SHOPPING = "shopping",
  SHIPPING = "shipping",
  SECURITY = "security",
  SUPPORT = "support",
  QUALITY = "quality",
  RETURNS = "returns",
  PACKAGE = "package",
  BOTTLE = "bottle",
  RECEIPT = "receipt",
  PAYMENT = "payment",
}

/**
 * Single value proposition item
 */
export interface ValuePropItem {
  icon: ValuePropIconType;
  title: string;
  description: string;
}

/**
 * Value propositions section content
 */
export interface HomepageValuePropsContent {
  enabled: boolean;
  items: ValuePropItem[];
}

/**
 * Categories section content
 */
export interface HomepageCategoriesContent {
  enabled: boolean;
  title: string;
  titleAr?: string;
  subtitle: string;
  ctaText: string;
  ctaLink: string;
  /**
   * Categories the client picked for the homepage, in display order.
   * When empty the storefront falls back to every category flagged
   * `showOnLanding` in the category system — which stays authoritative for
   * the category's own name, slug and artwork either way.
   */
  categoryIds?: string[];
  /** Tile grid density. */
  layoutVariant?: CategoryLayoutVariant;
}

/** How the category tiles are laid out on desktop. */
export type CategoryLayoutVariant = "tiles-4" | "tiles-3" | "tiles-2";

/**
 * Featured products section content
 */
export interface HomepageFeaturedProductsContent {
  enabled: boolean;
  title: string;
  titleAr?: string;
  subtitle: string;
  viewAllText: string;
  viewAllTextAr?: string;
  viewAllLink: string;
  /** Manually selected product IDs (when set, only these products are shown) */
  productIds?: string[];
}

/**
 * Newsletter subscription section content
 */
export interface HomepageNewsletterContent {
  enabled: boolean;
  title: string;
  subtitle: string;
  placeholderText: string;
  ctaText: string;
  privacyText: string;
}

/**
 * Footer CTA section content
 */
export interface HomepageFooterCtaContent {
  enabled: boolean;
  title: string;
  subtitle: string;
  ctaText: string;
  ctaLink: string;
}

/**
 * Discounted / On-Sale products section content
 */
export interface HomepageDiscountedProductsContent {
  enabled: boolean;
  title: string;
  titleAr?: string;
  viewAllText: string;
  viewAllTextAr?: string;
  viewAllLink: string;
  /** Manually selected product IDs (when set, only these products are shown) */
  productIds?: string[];
  /**
   * How many offers the homepage shelf carries.
   *
   * The offers query returns everything currently discounted, which on a busy
   * sale wraps the shelf onto a second row and makes it the tallest block on
   * the page. This is the merchant's call, not the layout's: show the first
   * few here and let "view all" carry the rest.
   *
   * Optional, because content saved before this field existed has no value for
   * it — read it through `DEFAULT_DISCOUNTED_LIMIT`.
   */
  limit?: number;
}

/**
 * Offers shown on the homepage shelf when the CMS has no `limit` saved.
 *
 * Four, because that is the shelf's own column count — one full row, no
 * wrapping. Defined here rather than at the point of use so the storefront and
 * the shipped default content cannot drift apart.
 */
export const DEFAULT_DISCOUNTED_LIMIT = 4;

/** Range the Homepage Admin offers limit accepts. */
export const DISCOUNTED_LIMIT_MIN = 1;
export const DISCOUNTED_LIMIT_MAX = 12;

/**
 * New Arrivals products section content
 */
export interface HomepageNewArrivalsContent {
  enabled: boolean;
  title: string;
  titleAr?: string;
  viewAllText: string;
  viewAllTextAr?: string;
  viewAllLink: string;
  /** Manually selected product IDs (when set, only these products are shown) */
  productIds?: string[];
}

/**
 * A broad product group merchandised on the homepage.
 *
 * @deprecated Superseded by `HomepageGroupSectionContent`. Kept so content
 * saved against the two hard-coded group slots (`stacks`, `gymGear`) still
 * reads, and is normalised into `groupSections` on load — see
 * `shared/types/homepage-group-sections.ts`. Nothing renders from this shape
 * any more; do not add fields to it.
 */
export interface HomepageProductGroupContent {
  enabled: boolean;
  title: string;
  titleAr?: string;
  subtitle?: string;
  subtitleAr?: string;
  viewAllText: string;
  viewAllTextAr?: string;
  viewAllLink: string;
  /** Broad group(s) this section merchandises, by category id. */
  categoryIds?: string[];
  /** Explicit, ordered product selection. Takes precedence over categoryIds. */
  productIds?: string[];
  /** How many products the row shows. */
  limit?: number;
}

/* ------------------------------------------------------------------ */
/*  Broad group merchandising sections                                */
/* ------------------------------------------------------------------ */

/**
 * How a group section puts its products on the page.
 *
 * `shelf` is the dense four-up product row every merchandising section uses.
 * `feature` is the composed panel treatment built for a group that carries two
 * or three items on purpose (bundles), which would leave holes in a shelf.
 */
export type GroupSectionPresentation = "shelf" | "feature";

/**
 * One broad product group, merchandised as its own homepage section.
 *
 * The store sells out of a handful of broad groups — Supplements, Stacks &
 * Bundles, Gym Gear, and whatever the client adds next — and each one gets an
 * independent section it can switch on, configure and place. This shape is
 * what makes that dynamic: a group section is *identified by its category*,
 * so the set of sections follows the catalogue instead of a list of hard-coded
 * keys that needs a deploy every time the client opens a new group.
 *
 * The category stays canonical. `categoryId` is the identity, the category's
 * own name is the section's name, and its slug is the natural destination for
 * "view all". Everything else here is an override of presentation or copy —
 * a renamed heading changes what the shopper reads and nothing else, so
 * Section Order, the saved order key and the admin row all survive a rename.
 *
 * **The category is the product source, always.** A group section shows what
 * is in its category, resolved through the existing `product.search`
 * procedure, and there is no manual override. That is the difference between a
 * group and a merchandising shelf: Featured is a list somebody chose, and a
 * group is a part of the shop. A hand-picked group would go stale the moment a
 * product was added to the category, and the client would have to come back to
 * Homepage Admin to publish a product they had already published.
 *
 * `limit` controls how many of the category's products the section carries.
 *
 * Only categories in the store's *broad group* set get a section — see
 * `resolveBroadGroups` in `homepage-group-sections.ts`. A deep catalogue
 * category is not a homepage section.
 */
export interface HomepageGroupSectionContent {
  /** The broad category this section merchandises. The section's identity. */
  categoryId: string;
  enabled: boolean;
  /**
   * Storefront heading. Empty or absent means "use the category's own name",
   * which is what a section that has never been renamed stores.
   */
  title?: string;
  titleAr?: string;
  subtitle?: string;
  subtitleAr?: string;
  viewAllText?: string;
  viewAllTextAr?: string;
  /** Empty or absent falls back to the category's own page. */
  viewAllLink?: string;
  /**
   * @deprecated Group sections are filled from their category and nothing
   * else. Retained only so content saved while a manual override existed still
   * parses; it is stripped by `normalizeGroupSections` and never reaches the
   * storefront. Curating a list of products is what Featured is for.
   */
  productIds?: string[];
  /** How many of the category's products the section shows. */
  limit?: number;
  presentation?: GroupSectionPresentation;
}

/** Prefix marking a section-order entry as a broad group section. */
export const GROUP_SECTION_PREFIX = "group:";

/** The `sectionOrder` entry that addresses one group's section. */
export function groupSectionKey(categoryId: string): string {
  return `${GROUP_SECTION_PREFIX}${categoryId}`;
}

/** The category id inside a group section-order entry, if it is one. */
export function parseGroupSectionKey(key: string): string | undefined {
  return key.startsWith(GROUP_SECTION_PREFIX)
    ? key.slice(GROUP_SECTION_PREFIX.length)
    : undefined;
}

/**
 * How many products a group section shows before the client picks a number.
 *
 * Four, because that is the dense shelf's own column count — one full row, no
 * wrapping. Matches the limit the two original group rows shipped with.
 */
export const DEFAULT_GROUP_SECTION_LIMIT = 4;

/** Range the Homepage Admin group limit accepts. */
export const GROUP_SECTION_LIMIT_MIN = 1;
export const GROUP_SECTION_LIMIT_MAX = 24;

/**
 * The "view all" label a group section carries until the client changes it.
 *
 * Lives here rather than in the storefront component: the renderer holds no
 * copy, and a group the client has never opened still needs a label for the
 * link the shopper sees.
 */
export const DEFAULT_GROUP_VIEW_ALL_TEXT = "VIEW ALL";

/**
 * Featured — a merchandising shelf of hand-picked products.
 *
 * Its own section, deliberately. "Featured" used to be achieved by renaming
 * the Best Sellers heading, which meant the two could never appear on the page
 * together and Section Order described a block that was pretending to be a
 * different one. This is a real fourth merchandising slot alongside Best
 * Sellers, New Drops and Offers, with its own switch, copy and selection.
 *
 * There is no automatic "featured" ranking and there should not be: featured
 * means *someone chose these*. With nothing selected the section has nothing
 * to say and renders nothing, rather than quietly repeating whatever Best
 * Sellers is already showing.
 */
export interface HomepageFeaturedShelfContent {
  enabled: boolean;
  title: string;
  titleAr?: string;
  subtitle?: string;
  subtitleAr?: string;
  viewAllText: string;
  viewAllTextAr?: string;
  viewAllLink: string;
  /** Hand-picked, ordered. The only way this section is filled. */
  productIds?: string[];
}

/**
 * Marquee announcement bar content (minimal template)
 */
export interface HomepageMarqueeContent {
  enabled: boolean;
  text: string;
  textAr?: string;
  /** Background color (hex). Defaults to white when unset. */
  backgroundColor?: string;
  /** Text color (hex). Defaults to black when unset. */
  textColor?: string;
}

/**
 * Promo text line for product detail page (minimal template)
 */
export interface HomepagePromoLineContent {
  text: string;
  textAr?: string;
}

/**
 * A single contact page banner slide
 */
export interface ContactBannerSlide {
  id: string;
  imageUrl: string;
  mobileImageUrl?: string;
  alt?: string;
}

/**
 * Contact page banner content (minimal template)
 */
export interface HomepageContactBannerContent {
  enabled: boolean;
  slides: ContactBannerSlide[];
  heading: string;
  headingAr?: string;
  description: string;
  descriptionAr?: string;
  directionsUrl?: string;
}

/**
 * About Us section content
 */
export interface HomepageAboutUsContent {
  enabled: boolean;
  title: string;
  titleAr?: string;
  description: string;
  descriptionAr?: string;
  imageUrl?: string;
}

/**
 * Return Policy page step (minimal template)
 */
export interface HomepageReturnPolicyStep {
  icon: ValuePropIconType;
  title: string;
  titleAr?: string;
  description: string;
  descriptionAr?: string;
}

/**
 * Return Policy page detail section (minimal template)
 */
export interface HomepageReturnPolicyDetailSection {
  title: string;
  titleAr?: string;
  body: string;
  bodyAr?: string;
}

/**
 * Return Policy page content (minimal template)
 */
export interface HomepageReturnPolicyContent {
  enabled: boolean;
  title: string;
  titleAr?: string;
  intro: string;
  introAr?: string;
  steps: HomepageReturnPolicyStep[];
  detailSections: HomepageReturnPolicyDetailSection[];
  footerPrefix: string;
  footerPrefixAr?: string;
  supportEmail: string;
  footerMiddle: string;
  footerMiddleAr?: string;
  contactLinkLabel: string;
  contactLinkLabelAr?: string;
  contactLinkUrl: string;
}

/* ------------------------------------------------------------------ */
/*  Mach storefront sections                                          */
/* ------------------------------------------------------------------ */

/**
 * Kinetic strip that runs directly under the hero.
 *
 * Carries the page's first motion beat without spending any colour on it —
 * the line repeats across the full width and scrolls continuously.
 */
export interface HomepageHeroMarqueeContent {
  enabled: boolean;
  text: string;
  textAr?: string;
  /** Glyph placed between repeats. Defaults to a bullet. */
  separator?: string;
  /** Seconds for one full pass. Lower is faster. */
  speedSeconds?: number;
  direction?: "left" | "right";
  /** Inverted = white text on black. */
  invert?: boolean;
}

/**
 * A full-bleed campaign banner.
 *
 * Stored as an array so the client can add a second or third banner between
 * merchandising rows without any code change.
 */
export interface CampaignBannerContent {
  id: string;
  enabled: boolean;
  media?: MediaSlot;
  eyebrow?: string;
  title: string;
  body?: string;
  ctaText?: string;
  ctaLink?: string;
  /** Where the copy sits over the media. */
  align?: TextAlign;
  verticalAlign?: TextVerticalAlign;
  textTheme?: TextTheme;
  /** Scrim strength over the media, 0-100. */
  overlayOpacity?: number;
  height?: "standard" | "tall";
}

/** One "Why Mach" pillar. */
export interface WhyMachItem {
  id: string;
  icon?: ValuePropIconType;
  title: string;
  titleAr?: string;
  description: string;
  descriptionAr?: string;
  /** Optional supporting visual for the pillar. */
  imageUrl?: string;
  /** Optional short figure rendered oversized (e.g. "100%"). */
  stat?: string;
}

/** "Why Mach" trust section. */
export interface HomepageWhyMachContent {
  enabled: boolean;
  title: string;
  titleAr?: string;
  subtitle: string;
  subtitleAr?: string;
  items: WhyMachItem[];
}

/**
 * A single certificate or compliance document.
 *
 * `thumbnailUrl` is the seal/logo shown in the strip; `documentUrl` is the
 * full scan or PDF opened on click. Both are uploaded by the client — none of
 * this is ever generated or bundled, because it is compliance evidence.
 */
export interface CertificateItem {
  id: string;
  title: string;
  titleAr?: string;
  issuer?: string;
  thumbnailUrl: string;
  /**
   * Alt text for the certificate image, authored independently of the title.
   *
   * A certificate's title is a label under the document ("ISO 9001:2015"); its
   * alt text describes the image for someone who cannot see it. They are not
   * the same sentence, and the admin previously had nowhere to put the second
   * one — the field was fed from `title` and never stored, so it could not be
   * edited or cleared. Optional: blank is a legitimate saved value, and the
   * storefront decides what to fall back to at render time.
   */
  alt?: string;
  documentUrl?: string;
  externalUrl?: string;
}

/** Manufacturing / factory trust block shown with the certificates. */
export interface FactoryContent {
  enabled: boolean;
  heading: string;
  headingAr?: string;
  body: string;
  bodyAr?: string;
  media?: MediaSlot;
  linkLabel: string;
  linkLabelAr?: string;
  linkUrl: string;
}

/** Certificates + manufacturing section. */
export interface HomepageCertificatesContent {
  enabled: boolean;
  title: string;
  titleAr?: string;
  subtitle: string;
  subtitleAr?: string;
  items: CertificateItem[];
  factory: FactoryContent;
}

/**
 * Community / UGC section.
 *
 * Typed and CMS-editable now so the homepage composition reserves the slot,
 * but it renders nothing until the review system carries media. `reviewIds`
 * will select from the existing product_review data — no separate community
 * store.
 */
export interface HomepageUgcContent {
  enabled: boolean;
  title: string;
  titleAr?: string;
  subtitle: string;
  subtitleAr?: string;
  /** Reviews promoted to the homepage, in display order. */
  reviewIds?: string[];
}

/* ------------------------------------------------------------------ */
/*  Section ordering                                                  */
/* ------------------------------------------------------------------ */

/**
 * Homepage sections the client can reorder.
 *
 * The hero is deliberately not in this list — it is the page opener and
 * anchors the navbar's transparent-over-hero behaviour, so it stays pinned
 * at the top. Everything below it is free to move.
 *
 * Campaign banners are addressed dynamically as `campaign:<bannerId>` so a
 * banner added in the CMS can be dropped anywhere in the sequence.
 */
export const ORDERABLE_SECTION_KEYS = [
  "heroMarquee",
  "categories",
  "newArrivals",
  "featuredProducts",
  "featuredShelf",
  "discountedProducts",
  "whyMach",
  "certificates",
  "ugc",
  "newsletter",
  "footerCta",
] as const;

export type OrderableSectionKey = (typeof ORDERABLE_SECTION_KEYS)[number];

/** Prefix marking a section-order entry as a campaign banner reference. */
export const CAMPAIGN_SECTION_PREFIX = "campaign:";

/**
 * The two section-order keys the hard-coded group rows used.
 *
 * They are no longer rendered from: a saved order carrying them is rewritten
 * in place to the matching `group:<categoryId>` key on load, so the client's
 * arrangement survives the move to dynamic groups. Declared here so the
 * migration and the tests share one list.
 */
export const LEGACY_GROUP_SECTION_KEYS = ["stacks", "gymGear"] as const;

export type LegacyGroupSectionKey = (typeof LEGACY_GROUP_SECTION_KEYS)[number];

/**
 * Human labels for the reorder UI in Homepage Admin.
 *
 * These are the *canonical* names — what the section is, not what its heading
 * currently reads. A heading the client renamed is shown underneath as
 * secondary metadata instead, because the identity is what Section Order is
 * for: a list that renames itself cannot be reasoned about, which is how
 * "Best Sellers" came to be doing duty as three different sections.
 *
 * Broad group sections are not in here. Their name is the category's name,
 * which is the category system's to own — see `resolveGroupSections`.
 */
export const SECTION_LABELS: Record<OrderableSectionKey, string> = {
  heroMarquee: "Promotional strip",
  categories: "Shop by group",
  newArrivals: "New Drops",
  featuredProducts: "Best Sellers",
  featuredShelf: "Featured",
  discountedProducts: "Offers",
  whyMach: "Why Mach",
  certificates: "Certificates & manufacturing",
  ugc: "Community",
  newsletter: "Newsletter",
  footerCta: "Closing CTA",
};

/**
 * Resolves the section sequence actually rendered on the homepage.
 *
 * Takes the client's saved order, drops entries that no longer exist (a
 * deleted campaign banner, a key we no longer render), then splices in any
 * known section the saved order predates — at the position the default
 * composition puts it, not at the end. That is what lets us ship a new
 * merchandising section into an existing storefront and have it land in the
 * middle of the page where it belongs, without the client having to re-save
 * their order first.
 */
export function resolveSectionOrder(
  savedOrder: string[] | undefined,
  campaignBannerIds: string[],
  groupCategoryIds: string[] = [],
): string[] {
  const valid = new Set<string>([
    ...ORDERABLE_SECTION_KEYS,
    ...campaignBannerIds.map((id) => `${CAMPAIGN_SECTION_PREFIX}${id}`),
    ...groupCategoryIds.map(groupSectionKey),
  ]);

  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const key of savedOrder ?? []) {
    if (valid.has(key) && !seen.has(key)) {
      ordered.push(key);
      seen.add(key);
    }
  }

  // Sections the saved order predates are inserted immediately after whichever
  // of their default-order predecessors is already on the page, so a new
  // section keeps its intended place in the composition instead of being
  // dumped below the closing CTA. This is also what gives a broad group the
  // client opened this morning a deterministic home: the placeholder expands
  // to the group keys in broad-group order, so the new one lands beside the
  // groups that are already placed rather than at the end of the page.
  let anchor = -1;
  for (const key of expandDefaultComposition(groupCategoryIds)) {
    if (!valid.has(key)) continue;
    const existing = ordered.indexOf(key);
    if (existing >= 0) {
      anchor = existing;
      continue;
    }
    const at = anchor + 1;
    ordered.splice(at, 0, key);
    seen.add(key);
    anchor = at;
  }

  // Campaign banners the default order doesn't know about land before the
  // closing CTA rather than being silently dropped.
  for (const id of campaignBannerIds) {
    const key = `${CAMPAIGN_SECTION_PREFIX}${id}`;
    if (seen.has(key)) continue;
    const ctaIndex = ordered.indexOf("footerCta");
    if (ctaIndex >= 0) ordered.splice(ctaIndex, 0, key);
    else ordered.push(key);
    seen.add(key);
  }

  return ordered;
}

/**
 * Stands in for "the broad group sections, in broad-group order" inside the
 * default composition.
 *
 * The group keys cannot be written into a shipped constant — they are category
 * ids, which belong to the store's data, not to this file. The placeholder is
 * expanded at resolve time and is never a real section key, never rendered and
 * never saved.
 */
export const GROUP_SECTIONS_PLACEHOLDER = "groupSections:*";

/**
 * The composition the Mach storefront ships with out of the box.
 *
 * The shape of the page, read top to bottom: the promotional strip, the
 * navigation band, then the store's broad groups as their own merchandising
 * band, then the four merchandising shelves that are *not* groups — Best
 * Sellers, New Drops, Featured, Offers — broken up by the campaign banners,
 * and finally trust and capture.
 */
export const DEFAULT_SECTION_COMPOSITION: string[] = [
  "heroMarquee",
  "categories",
  GROUP_SECTIONS_PLACEHOLDER,
  `${CAMPAIGN_SECTION_PREFIX}campaign-primary`,
  "featuredProducts",
  "newArrivals",
  "featuredShelf",
  "discountedProducts",
  "whyMach",
  `${CAMPAIGN_SECTION_PREFIX}campaign-secondary`,
  "certificates",
  "ugc",
  "newsletter",
  "footerCta",
];

/** The default composition with the group placeholder resolved to real keys. */
export function expandDefaultComposition(
  groupCategoryIds: string[] = [],
): string[] {
  return DEFAULT_SECTION_COMPOSITION.flatMap((key) =>
    key === GROUP_SECTIONS_PLACEHOLDER
      ? groupCategoryIds.map(groupSectionKey)
      : [key],
  );
}

/**
 * The default composition as a concrete, storable order.
 *
 * Group sections are absent rather than guessed at: which groups exist is a
 * question about the store's catalogue, which this constant cannot see. They
 * are spliced in by `resolveSectionOrder` once the categories are known.
 */
export const DEFAULT_SECTION_ORDER: string[] = expandDefaultComposition();

/**
 * Complete homepage content structure
 */
export interface HomepageContent {
  meta: HomepageMetaContent;
  hero: HomepageHeroContent;
  brandStatement: HomepageBrandStatementContent;
  promoBanner: HomepagePromoBannerContent;
  categories: HomepageCategoriesContent;
  featuredProducts: HomepageFeaturedProductsContent;
  valueProps: HomepageValuePropsContent;
  newsletter: HomepageNewsletterContent;
  footerCta: HomepageFooterCtaContent;
  discountedProducts?: HomepageDiscountedProductsContent;
  newArrivals?: HomepageNewArrivalsContent;
  marquee?: HomepageMarqueeContent;
  promoLine?: HomepagePromoLineContent;
  contactBanner?: HomepageContactBannerContent;
  /** Bottom carousel slides shown above testimonials (minimal template) */
  bottomCarousel?: {
    enabled: boolean;
    slides: HeroSlideContent[];
  };
  /** About Us section */
  aboutUs?: HomepageAboutUsContent;
  /** Return Policy page (minimal template) */
  returnPolicy?: HomepageReturnPolicyContent;
  /** Product page inline carousel custom title */
  productCarouselTitle?: string;
  productCarouselTitleAr?: string;
  /* ── Mach storefront sections ── */
  /** Kinetic strip under the hero. */
  heroMarquee?: HomepageHeroMarqueeContent;
  /**
   * One merchandising section per broad product group, keyed by category id.
   *
   * Reconciled against the store's broad groups on every load, so a group the
   * client opens in the category system gets a section without a deploy, and a
   * group they delete stops having one.
   */
  groupSections?: HomepageGroupSectionContent[];
  /** Hand-picked "Featured" shelf — its own section, not a renamed one. */
  featuredShelf?: HomepageFeaturedShelfContent;
  /**
   * @deprecated Read-only compatibility. Normalised into `groupSections` on
   * load; the storefront and the admin both work from that.
   */
  stacks?: HomepageProductGroupContent;
  /** @deprecated See `stacks`. */
  gymGear?: HomepageProductGroupContent;
  /** Full-bleed campaign banners, placed via `sectionOrder`. */
  campaignBanners?: CampaignBannerContent[];
  /** "Why Mach" trust pillars (supersedes `valueProps` on the Mach template). */
  whyMach?: HomepageWhyMachContent;
  /** Certificates + manufacturing trust section. */
  certificates?: HomepageCertificatesContent;
  /** Community / UGC slot — reserved, renders once reviews carry media. */
  ugc?: HomepageUgcContent;
  /** Client-defined order of the sections below the hero. */
  sectionOrder?: string[];

  /** CMS-controlled testimonials (minimal template) */
  testimonials?: {
    enabled: boolean;
    title?: string;
    titleAr?: string;
    items: {
      name: string;
      nameAr?: string;
      rating: number;
      review: string;
      reviewAr?: string;
    }[];
  };
}

/**
 * Default homepage content - safe fallback values
 */
export const DEFAULT_HOMEPAGE_CONTENT: HomepageContent = {
  meta: {
    enabled: true,
    pageTitle: "Mach Supplements",
    pageDescription:
      "Sports nutrition and gym supplements built for serious training.",
  },
  hero: {
    enabled: true,
    title: "FUEL THE NEXT LEVEL",
    // The eyebrow line above the headline in the editorial hero.
    subtitle: "MACH SUPPLEMENTS",
    supportingText:
      "Protein, creatine and pre-workout formulated for real training loads. Built for the sessions that actually count.",
    ctaText: "SHOP SUPPLEMENTS",
    ctaLink: "/shop",
    // No bundled hero photo yet — the template renders its own typographic
    // fallback so nothing requests a missing upload. Real Mach lifestyle /
    // product media gets uploaded through Dashboard → Homepage later.
    backgroundImage: undefined,
    mobileBackgroundImage: undefined,
    heroSlides: [],
    // Campaign media is uploaded through Dashboard -> Homepage. Until then the
    // hero renders its typographic treatment rather than a broken <img>.
    media: { ...EMPTY_MEDIA_SLOT },
    // The foreground pack shot. Also empty until real Mach product artwork is
    // cut out; the hero degrades to a studio-lit typographic stage without it.
    productMedia: { ...EMPTY_MEDIA_SLOT },
    productScale: 100,
    mediaLayout: "split",
    secondaryCtaText: "VIEW ALL PRODUCTS",
    secondaryCtaLink: "/shop",
    align: "left",
    verticalAlign: "bottom",
    textTheme: "light",
    overlayOpacity: 55,
  },
  brandStatement: {
    enabled: true,
    title: "Train hard. Recover harder.",
    description:
      "Mach is built for people who show up. Every formula is made for real training loads — clean ingredients, honest doses, and labels that say exactly what's inside. No filler, no guesswork, no shortcuts between you and the next set.",
    // Intentionally empty until Mach brand photography is supplied.
    image: "",
  },
  promoBanner: {
    enabled: false,
    text: "🎉 Special Offer: Get 20% off your first order!",
    linkText: "Shop Now",
    linkUrl: "/shop",
  },
  categories: {
    enabled: true,
    title: "SHOP BY CATEGORY",
    subtitle: "Find what your training actually needs.",
    ctaText: "SHOP ALL",
    ctaLink: "/shop",
    // Empty = every category flagged "show on landing" in the category system.
    categoryIds: [],
    layoutVariant: "tiles-4",
  },
  featuredProducts: {
    enabled: true,
    title: "BEST SELLERS",
    subtitle: "The products our athletes reorder most.",
    viewAllText: "VIEW ALL",
    viewAllLink: "/shop",
  },
  valueProps: {
    enabled: true,
    items: [
      {
        icon: ValuePropIconType.QUALITY,
        title: "Quality You Can Read",
        description:
          "Full label transparency — every ingredient and dose listed up front.",
      },
      {
        icon: ValuePropIconType.SECURITY,
        title: "Trusted Manufacturing",
        description:
          "Sourced from certified facilities with batch-level quality control.",
      },
      {
        icon: ValuePropIconType.SHIPPING,
        title: "Fast Delivery",
        description:
          "Nationwide shipping across Egypt with tracking from checkout to door.",
      },
    ],
  },
  newsletter: {
    enabled: true,
    title: "JOIN THE MACH CREW",
    subtitle:
      "Drop dates, restocks and training-day offers — straight to your inbox, no noise.",
    placeholderText: "Enter your email address",
    ctaText: "JOIN",
    privacyText: "We respect your privacy. Unsubscribe at any time.",
  },
  footerCta: {
    enabled: true,
    title: "YOUR NEXT SESSION STARTS HERE",
    subtitle: "Built for the work",
    ctaText: "SHOP SUPPLEMENTS",
    ctaLink: "/shop",
  },
  discountedProducts: {
    enabled: true,
    title: "OFFERS",
    viewAllText: "VIEW ALL",
    viewAllLink: "/shop",
    limit: DEFAULT_DISCOUNTED_LIMIT,
  },
  newArrivals: {
    enabled: true,
    title: "NEW DROPS",
    viewAllText: "VIEW ALL",
    viewAllLink: "/shop",
  },
  marquee: {
    enabled: false,
    text: "",
  },
  promoLine: {
    text: "",
    textAr: "",
  },
  bottomCarousel: {
    enabled: true,
    slides: [],
  },
  contactBanner: {
    enabled: true,
    slides: [],
    heading: "We Would Love To Hear From You",
    headingAr: "نود أن نسمع منك",
    description:
      "Have a question, feedback, or just want to say hello? Drop us a message and we'll get back to you as soon as possible.",
    descriptionAr:
      "هل لديك سؤال أو ملاحظة أو تريد فقط أن تقول مرحبا؟ أرسل لنا رسالة وسنعود إليك في أقرب وقت ممكن.",
    directionsUrl: "",
  },
  aboutUs: {
    enabled: false,
    title: "About Us",
    titleAr: "من نحن",
    description:
      "Mach Supplements exists to fuel serious training — honest formulas, tested ingredients, and no compromises.",
    descriptionAr: "",
    imageUrl: "",
  },
  returnPolicy: {
    enabled: true,
    title: "Return Policy",
    titleAr: "سياسة الإرجاع",
    intro:
      "We want you to be happy with every Mach order. If something's not right, we're here to help.",
    introAr:
      "نريدك أن تكون راضياً عن كل طلب من Mach. إذا كان هناك أي مشكلة، نحن هنا لمساعدتك.",
    steps: [
      {
        icon: ValuePropIconType.PACKAGE,
        title: "1. Return Window",
        titleAr: "1. فترة الإرجاع",
        description: "You may return any item within 14 days of delivery.",
        descriptionAr: "يمكنك إرجاع أي منتج خلال 14 يوماً من تاريخ التسليم.",
      },
      {
        icon: ValuePropIconType.BOTTLE,
        title: "2. Eligible Items",
        titleAr: "2. المنتجات المؤهلة",
        description:
          "Items must be unused, unopened, and in original packaging.",
        descriptionAr:
          "يجب أن تكون المنتجات غير مستخدمة، غير مفتوحة، وفي عبوتها الأصلية.",
      },
      {
        icon: ValuePropIconType.RECEIPT,
        title: "3. How to Return",
        titleAr: "3. كيفية الإرجاع",
        description:
          "Contact our support team via email or phone to initiate a return.",
        descriptionAr:
          "تواصل مع فريق الدعم عبر البريد الإلكتروني أو الهاتف لبدء عملية الإرجاع.",
      },
      {
        icon: ValuePropIconType.PAYMENT,
        title: "4. Refunds",
        titleAr: "4. المبالغ المستردة",
        description:
          "Once we receive and inspect your return, we'll process your refund within 5–7 business days.",
        descriptionAr:
          "بمجرد استلامنا وفحص المرتجع، سنعالج استرداد المبلغ خلال 5–7 أيام عمل.",
      },
    ],
    detailSections: [
      {
        title: "Non-Returnable Items",
        titleAr: "منتجات غير قابلة للإرجاع",
        body: "For hygiene and safety reasons, we cannot accept returns on opened or unsealed supplement containers. Gift cards and promotional items are also non-returnable.",
        bodyAr:
          "لأسباب صحية وأمنية، لا نقبل إرجاع عبوات المكملات المفتوحة أو غير المختومة. بطاقات الهدايا والعروض الترويجية غير قابلة للإرجاع أيضاً.",
      },
      {
        title: "Damaged or Wrong Items",
        titleAr: "منتجات تالفة أو خاطئة",
        body: "If your order arrives damaged or incorrect, please contact us within 48 hours of delivery with photos. We'll arrange a replacement or refund as quickly as possible.",
        bodyAr:
          "إذا وصل طلبك تالفاً أو غير صحيح، يرجى التواصل معنا خلال 48 ساعة من التسليم مع صور. سنرتب استبدالاً أو استرداداً في أسرع وقت ممكن.",
      },
    ],
    footerPrefix:
      "Need help? We're just an email away. Reach out to us at",
    footerPrefixAr: "تحتاج مساعدة؟ نحن على بعد بريد إلكتروني. تواصل معنا على",
    // Left blank on purpose — set the real Mach support address in
    // Dashboard → Homepage before enabling this page.
    supportEmail: "",
    footerMiddle: "or via our",
    footerMiddleAr: "أو عبر",
    contactLinkLabel: "Contact Us page",
    contactLinkLabelAr: "صفحة اتصل بنا",
    contactLinkUrl: "/contact",
  },
  heroMarquee: {
    enabled: true,
    text: "BUILT FOR THE WORK",
    separator: "•",
    speedSeconds: 28,
    direction: "left",
    invert: true,
  },
  // No group sections are shipped. Which broad groups the store has is a
  // question about its catalogue, and seeding this array would mean inventing
  // category ids — so it starts empty and is reconciled against the real
  // categories on load. A group the client has never configured defaults to
  // off, so opening a catalogue group never silently changes the live page.
  groupSections: [],
  // Featured ships off and empty. It is a hand-picked shelf: with nothing
  // picked it has nothing to say, and defaulting it on would put a second copy
  // of Best Sellers on every existing storefront the moment this deploys.
  featuredShelf: {
    enabled: false,
    title: "FEATURED",
    viewAllText: "VIEW ALL",
    viewAllLink: "/shop",
    productIds: [],
  },
  // Deprecated. Retained so content saved against the two hard-coded group
  // slots still merges cleanly; normalised into `groupSections` on load.
  stacks: {
    enabled: true,
    title: "STACKS & BUNDLES",
    subtitle: "Built to work together. Priced to move as one.",
    viewAllText: "VIEW ALL",
    viewAllLink: "/shop",
    categoryIds: [],
    productIds: [],
    limit: 4,
  },
  gymGear: {
    enabled: true,
    title: "GYM GEAR",
    subtitle: "The kit that goes in the bag.",
    viewAllText: "VIEW ALL",
    viewAllLink: "/shop",
    categoryIds: [],
    productIds: [],
    limit: 4,
  },
  campaignBanners: [
    {
      id: "campaign-primary",
      enabled: true,
      media: { ...EMPTY_MEDIA_SLOT },
      eyebrow: "",
      title: "",
      body: "",
      ctaText: "",
      ctaLink: "",
      align: "left",
      verticalAlign: "bottom",
      textTheme: "light",
      overlayOpacity: 45,
      height: "standard",
    },
    {
      id: "campaign-secondary",
      enabled: false,
      media: { ...EMPTY_MEDIA_SLOT },
      eyebrow: "",
      title: "",
      body: "",
      ctaText: "",
      ctaLink: "",
      align: "left",
      verticalAlign: "middle",
      textTheme: "light",
      overlayOpacity: 45,
      height: "standard",
    },
  ],
  whyMach: {
    enabled: true,
    title: "WHY MACH",
    subtitle: "What you are actually buying.",
    items: [
      {
        id: "why-transparency",
        icon: ValuePropIconType.QUALITY,
        stat: "01",
        title: "Quality You Can Read",
        description:
          "Full label transparency — every ingredient and dose listed up front.",
      },
      {
        id: "why-manufacturing",
        icon: ValuePropIconType.SECURITY,
        stat: "02",
        title: "Trusted Manufacturing",
        description:
          "Sourced from certified facilities with batch-level quality control.",
      },
      {
        id: "why-delivery",
        icon: ValuePropIconType.SHIPPING,
        stat: "03",
        title: "Fast Delivery",
        description:
          "Nationwide shipping across Egypt with tracking from checkout to door.",
      },
    ],
  },
  certificates: {
    enabled: false,
    title: "",
    subtitle: "",
    // Certificates are compliance evidence — the client uploads the real
    // documents in Dashboard -> Homepage. Nothing is shipped pre-filled.
    items: [],
    factory: {
      enabled: false,
      heading: "",
      body: "",
      media: { ...EMPTY_MEDIA_SLOT },
      linkLabel: "",
      linkUrl: "",
    },
  },
  ugc: {
    enabled: false,
    title: "",
    subtitle: "",
    reviewIds: [],
  },
  sectionOrder: [...DEFAULT_SECTION_ORDER],
  testimonials: {
    enabled: true,
    title: undefined,
    titleAr: undefined,
    items: [
      {
        name: "Sarah Mitchell",
        nameAr: "نورة العتيبي",
        rating: 5,
        review:
          "Absolutely love the quality! Fast shipping and the product exceeded my expectations. Will definitely order again.",
        reviewAr:
          "من أفضل المنتجات اللي استخدمتها وبصراحة يستاهل أضعاف سعره، جودة عالية وتوصيل سريع.",
      },
      {
        name: "James Cooper",
        nameAr: "محمد المحسن",
        rating: 5,
        review:
          "Excellent shopping experience from start to finish. Customer service was outstanding and the product looks even better in person.",
        reviewAr:
          "تجربة شراء ممتازة من البداية للنهاية، خدمة عملاء رائعة والمنتج طلع أحلى من الصور.",
      },
      {
        name: "Emily Chen",
        nameAr: "فرح أحمد",
        rating: 5,
        review:
          "The attention to detail is remarkable. Premium packaging and the product itself is simply stunning. Highly recommended!",
        reviewAr:
          "تميز وإتقان سواء على مستوى التقديم أو جودة المنتجات، شكراً جزيلاً.",
      },
      {
        name: "David Wilson",
        nameAr: "مهند المري",
        rating: 4,
        review:
          "Fast delivery and solid quality. Returns were effortless when I needed to swap sizes — customer support made it painless.",
        reviewAr:
          "التوصيل سريع والجودة ممتازة، وتجربة الاستبدال كانت سهلة جداً بفضل خدمة العملاء.",
      },
      {
        name: "Olivia Taylor",
        nameAr: "ريم الشمري",
        rating: 5,
        review:
          "Everything was beautifully packaged and presented. The product quality is exceptional — worth every penny.",
        reviewAr:
          "كل شيء كان مرتباً ومغلفاً بشكل أنيق، والمنتج نفسه جودته عالية جداً.",
      },
      {
        name: "Marcus Reyes",
        nameAr: "خالد السبيعي",
        rating: 4,
        review:
          "Great value for the price. Shipping was a day faster than estimated and the item matched the photos exactly.",
        reviewAr:
          "قيمة ممتازة مقابل السعر، الشحن أسرع من المتوقع والمنتج مطابق تماماً للصور.",
      },
    ],
  },
};
