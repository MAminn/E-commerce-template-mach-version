import {
  CAMPAIGN_SECTION_PREFIX,
  SECTION_LABELS,
  isMediaSlotEmpty,
  type HomepageContent,
  type OrderableSectionKey,
} from "./homepage-content";

/**
 * What Homepage Admin shows for one row of Section Order.
 *
 * Two things went wrong when the reorder list described sections in its own
 * words:
 *
 *  1. **The names were internal.** A row said "Best Sellers" while the
 *     storefront heading had been renamed to "BUNDLES & STACKS" in the CMS, so
 *     the client read the list as being in the wrong order when the renderer
 *     was faithfully following the saved keys.
 *
 *  2. **"On" meant `enabled === true`,** which is not the same as "this block
 *     appears on the site". A campaign with no artwork, a group row with no
 *     source selected and the whole Community section all return `null` on the
 *     storefront while reporting "On" here.
 *
 * So a row now carries the *storefront* heading, a quiet reminder of which
 * internal block it is when that heading has been renamed, and a status that
 * is derived from the same conditions the storefront renders on.
 *
 * Everything in this module is a pure function of saved CMS content. It never
 * claims to know a live product count: Homepage Admin does not load the
 * catalogue, and a badge that guessed "No products" would be exactly the kind
 * of confident-but-wrong signal this change exists to remove.
 *
 * That is why there are two positive statuses rather than one, and the
 * difference between them is the whole point of the model:
 *
 *  - **Visible** is a claim, and it is only made where this file evaluates the
 *    *same condition the storefront evaluates* — a marquee has text, a banner
 *    has artwork, the certificates block has documents. If it says Visible,
 *    the block renders.
 *  - **Enabled** means the switch is on and nothing more is knowable here.
 *    The merchandising rows and the category band resolve their contents from
 *    a runtime query, so they can still render nothing with a perfectly valid
 *    configuration. Calling those "Visible" would rebuild the exact
 *    misdirection this model replaced, one word further along.
 */
export type SectionStatus =
  | "visible"
  | "enabled"
  | "off"
  | "no-source"
  | "missing-media"
  | "empty"
  | "unavailable";

/** Badge text. Operational vocabulary, not marketing. */
export const SECTION_STATUS_LABELS: Record<SectionStatus, string> = {
  visible: "Visible",
  enabled: "Enabled",
  off: "Off",
  "no-source": "No source",
  "missing-media": "Missing media",
  empty: "Empty",
  unavailable: "Not available yet",
};

/** One row of the reorder list, fully described. */
export interface SectionRow {
  /** The `sectionOrder` entry this row stands for. */
  key: string;
  /** The heading the shopper sees, so the list matches the storefront. */
  label: string;
  /** Which internal block this is — set only when the heading was renamed. */
  meta?: string;
  status: SectionStatus;
  /** Plain sentence explaining what the status means. Absent for "Visible". */
  hint?: string;
}

/** The CMS heading for a section, where the section has an editable one. */
function storefrontHeading(
  key: OrderableSectionKey,
  content: HomepageContent,
): string | undefined {
  switch (key) {
    case "categories":
      return content.categories?.title;
    case "stacks":
      return content.stacks?.title;
    case "newArrivals":
      return content.newArrivals?.title;
    case "featuredProducts":
      return content.featuredProducts?.title;
    case "gymGear":
      return content.gymGear?.title;
    case "discountedProducts":
      return content.discountedProducts?.title;
    case "whyMach":
      return content.whyMach?.title;
    case "certificates":
      return content.certificates?.title;
    case "ugc":
      return content.ugc?.title;
    case "newsletter":
      return content.newsletter?.title;
    case "footerCta":
      return content.footerCta?.title;
    // The promotional strip has no heading — it is one scrolling line, and its
    // text is shown as the row's secondary label instead.
    case "heroMarquee":
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Whether a CMS heading is still the section's own name.
 *
 * Compared loosely on purpose: the shipped content sets these headings in caps
 * ("NEW DROPS" against the internal "New Drops"), and treating that as a
 * rename would put a redundant second line under almost every row — which
 * would bury the one case the line exists for, a heading the client genuinely
 * changed.
 */
function sameHeading(a: string, b: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return normalize(a) === normalize(b);
}

/** Trims a marquee line down to something that fits one row. */
function preview(text: string | undefined, max = 56): string | undefined {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** True when the certificates block has neither documents nor a factory note. */
function certificatesAreEmpty(content: HomepageContent): boolean {
  const certificates = content.certificates;
  const items = certificates?.items ?? [];
  const factory = certificates?.factory;
  const factoryReady =
    Boolean(factory?.enabled) &&
    Boolean(factory?.heading?.trim() || factory?.body?.trim());
  return items.length === 0 && !factoryReady;
}

/** The storefront status of one non-campaign section. */
function statusForSection(
  key: OrderableSectionKey,
  content: HomepageContent,
): SectionStatus {
  switch (key) {
    case "heroMarquee":
      if (!content.heroMarquee?.enabled) return "off";
      // MachMarquee renders nothing without a line to scroll.
      return content.heroMarquee.text?.trim() ? "visible" : "empty";

    case "categories":
      if (!content.categories?.enabled) return "off";
      // Not "No source" — an empty selection falls back to every category
      // flagged for the landing page. But not "Visible" either: whether either
      // route resolves to a tile is a catalogue question, and this file cannot
      // see the catalogue.
      return "enabled";

    case "stacks":
    case "gymGear": {
      const group = key === "stacks" ? content.stacks : content.gymGear;
      if (!group?.enabled) return "off";
      const hasProducts = (group.productIds ?? []).length > 0;
      const hasCategories = (group.categoryIds ?? []).length > 0;
      // A selected source is only a source: the products behind it can be
      // unpublished or out of stock, and the row renders nothing then.
      return hasProducts || hasCategories ? "enabled" : "no-source";
    }

    // The three merchandising shelves are filled by a runtime product query.
    // Switched on is all the CMS can honestly report about them.
    case "featuredProducts":
      return content.featuredProducts?.enabled ? "enabled" : "off";

    case "newArrivals":
      return content.newArrivals?.enabled ? "enabled" : "off";

    case "discountedProducts":
      return content.discountedProducts?.enabled ? "enabled" : "off";

    case "whyMach":
      if (!content.whyMach?.enabled) return "off";
      return (content.whyMach.items ?? []).length > 0 ? "visible" : "empty";

    case "certificates":
      if (!content.certificates?.enabled) return "off";
      return certificatesAreEmpty(content) ? "empty" : "visible";

    case "ugc":
      // The storefront returns null for this slot unconditionally — the review
      // system does not carry media yet. Saying "Visible" here would promise a
      // block that cannot exist.
      return content.ugc?.enabled ? "unavailable" : "off";

    case "newsletter":
      return content.newsletter?.enabled ? "visible" : "off";

    case "footerCta":
      return content.footerCta?.enabled ? "visible" : "off";

    default:
      return "off";
  }
}

/** What a status means for the page, in the client's terms. */
function hintFor(key: string, status: SectionStatus): string | undefined {
  switch (status) {
    case "visible":
      return undefined;
    case "enabled":
      return key === "categories"
        ? "Switched on. Whether tiles appear depends on the categories available when the page loads."
        : "Switched on. Whether it appears depends on the products it finds when the page loads.";
    case "off":
      return "Switched off, so it keeps its place here but does not render.";
    case "no-source":
      return "No products or groups selected yet, so there is nothing to show.";
    case "missing-media":
      return "Enabled, but no image or video has been uploaded for it.";
    case "empty":
      return key === "heroMarquee"
        ? "Enabled, but the strip has no text to scroll."
        : "Enabled, but nothing has been added to it yet.";
    case "unavailable":
      return "Reserved for a future release — it renders nothing on the site.";
    default:
      return undefined;
  }
}

/**
 * Describes every row of the reorder list, in the order given.
 *
 * Campaign banners are numbered by their position in `campaignBanners` rather
 * than by their position on the page, so an untitled banner keeps the same
 * name while the client moves it around.
 */
export function describeSectionRows(
  order: string[],
  content: HomepageContent,
): SectionRow[] {
  const banners = content.campaignBanners ?? [];
  const bannerNumbers = new Map(banners.map((b, i) => [b.id, i + 1]));

  return order.map((key): SectionRow => {
    if (key.startsWith(CAMPAIGN_SECTION_PREFIX)) {
      const id = key.slice(CAMPAIGN_SECTION_PREFIX.length);
      const banner = banners.find((b) => b.id === id);
      const title = banner?.title?.trim();
      const number = bannerNumbers.get(id);
      const status: SectionStatus = !banner?.enabled
        ? "off"
        : isMediaSlotEmpty(banner.media)
          ? "missing-media"
          : "visible";
      return {
        key,
        // Untitled banners are numbered so two of them are still tellable
        // apart; a titled one shows its own copy.
        label: title || `Campaign banner ${number ?? ""}`.trim(),
        meta: title ? "Campaign banner" : undefined,
        status,
        hint: hintFor(key, status),
      };
    }

    const sectionKey = key as OrderableSectionKey;
    const canonical = SECTION_LABELS[sectionKey] ?? key;
    const heading = storefrontHeading(sectionKey, content)?.trim();
    const label = heading || canonical;
    const status = statusForSection(sectionKey, content);

    return {
      key,
      label,
      // Only worth the line when the client renamed the heading: otherwise it
      // would read "Best Sellers / Best Sellers section".
      meta:
        sectionKey === "heroMarquee"
          ? preview(content.heroMarquee?.text)
          : sameHeading(label, canonical)
            ? undefined
            : `${canonical} section`,
      status,
      hint: hintFor(key, status),
    };
  });
}
