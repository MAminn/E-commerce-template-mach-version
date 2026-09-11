import {
  CAMPAIGN_SECTION_PREFIX,
  SECTION_LABELS,
  isMediaSlotEmpty,
  type HomepageContent,
  type OrderableSectionKey,
} from "./homepage-content";
import {
  indexGroupSections,
  isGroupSectionKey,
  type ResolvedGroupSection,
} from "./homepage-group-sections";

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
 * So a row carries the section's own name, the storefront heading underneath
 * when the client has renamed it, and a status derived from the same
 * conditions the storefront renders on.
 *
 * The naming runs identity-first, and that direction matters. Leading with the
 * *heading* was an improvement on an internal-only list, but it made Section
 * Order rename itself: a list where "Best Sellers" can read "Bundles & Stacks"
 * today and "Featured" tomorrow describes the page's copy, not its structure,
 * and structure is the only thing a reorder screen is for. Each broad group is
 * its own section now and Featured is its own section, so every row has a
 * stable name worth leading with — the category's name for a group, the
 * section's name for the rest — and a renamed heading is reported as what it
 * is: a copy override, on the second line.
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
  /** The section's canonical name — a group's category, or the block itself. */
  label: string;
  /** The storefront heading, set only when it differs from the name. */
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
    case "newArrivals":
      return content.newArrivals?.title;
    case "featuredProducts":
      return content.featuredProducts?.title;
    case "featuredShelf":
      return content.featuredShelf?.title;
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

/**
 * The status of a hand-curated merchandising shelf.
 *
 * Best Sellers, New Drops, Featured and Offers all work the same way now —
 * each shows exactly the products the client chose for it — so they get one
 * predicate rather than four that could drift. None of them falls back to a
 * catalogue query any more, which is what makes "nothing picked" a reportable
 * state instead of an invisible one.
 */
function curatedStatus(
  section: { enabled?: boolean; productIds?: string[] } | undefined,
): SectionStatus {
  if (!section?.enabled) return "off";
  return (section.productIds ?? []).length > 0 ? "enabled" : "no-source";
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

    // The four merchandising shelves are hand-curated: the client picks what
    // goes in each one, so an empty selection *is* knowable here and means the
    // row renders nothing. Still never "Visible" with a selection, because
    // whether those products come back is a runtime question.
    case "featuredProducts":
      return curatedStatus(content.featuredProducts);

    case "newArrivals":
      return curatedStatus(content.newArrivals);

    case "featuredShelf":
      return curatedStatus(content.featuredShelf);

    case "discountedProducts":
      return curatedStatus(content.discountedProducts);

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
      return "Enabled, but no products have been selected for this section.";
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
  groupSections: readonly ResolvedGroupSection[] = [],
): SectionRow[] {
  const banners = content.campaignBanners ?? [];
  const bannerNumbers = new Map(banners.map((b, i) => [b.id, i + 1]));
  const groups = indexGroupSections(groupSections);

  return order.map((key): SectionRow => {
    if (isGroupSectionKey(key)) {
      const group = groups.get(key);
      // A key whose category is no longer a broad group. `resolveSectionOrder`
      // drops these, so reaching here means the caller passed an unresolved
      // order; name it honestly rather than inventing a category.
      if (!group) {
        return {
          key,
          label: "Group section",
          status: "unavailable",
          hint: "This group is no longer part of the store's broad groups.",
        };
      }
      // Never "Visible": a group fills itself from a catalogue query, so a
      // perfectly valid configuration can still put nothing on the page.
      const status: SectionStatus = group.enabled ? "enabled" : "off";
      return {
        key,
        // The category's name, not the heading. A renamed heading is a copy
        // change; the section is still that group.
        label: group.category.name,
        meta: group.headingOverride
          ? `Storefront heading: ${group.headingOverride}`
          : undefined,
        status,
        hint: hintFor(key, status),
      };
    }

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
    const status = statusForSection(sectionKey, content);

    return {
      key,
      label: canonical,
      // Only worth the line when the client renamed the heading: otherwise it
      // would read "Best Sellers / Best Sellers".
      meta:
        sectionKey === "heroMarquee"
          ? preview(content.heroMarquee?.text)
          : !heading || sameHeading(heading, canonical)
            ? undefined
            : `Storefront heading: ${heading}`,
      status,
      hint: hintFor(key, status),
    };
  });
}
