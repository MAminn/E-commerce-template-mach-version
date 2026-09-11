import {
  DEFAULT_GROUP_SECTION_LIMIT,
  DEFAULT_GROUP_VIEW_ALL_TEXT,
  LEGACY_GROUP_SECTION_KEYS,
  groupSectionKey,
  parseGroupSectionKey,
  type GroupSectionPresentation,
  type HomepageContent,
  type HomepageGroupSectionContent,
  type HomepageProductGroupContent,
  type LegacyGroupSectionKey,
} from "./homepage-content";

/**
 * Broad product groups, and the homepage sections that merchandise them.
 *
 * The homepage used to mix two things that are not the same thing. *Groups* —
 * Supplements, Stacks & Bundles, Gym Gear — are parts of the store's catalogue
 * that a shopper walks into. *Merchandising sections* — Best Sellers, New
 * Drops, Featured, Offers — are editorial selections cut across the whole
 * catalogue. Both were being expressed as a fixed list of section keys, so a
 * new group needed a deploy, and the only way to get a fourth merchandising
 * idea onto the page was to rename an existing one and hope nobody needed the
 * original.
 *
 * This module supplies the group half of that split, as pure functions of
 * saved CMS content and the category list the app already fetches:
 *
 *  - which categories count as broad groups (`resolveBroadGroups`)
 *  - what the two hard-coded group slots become (`normalizeGroupSections`,
 *    `migrateLegacySectionOrder`)
 *  - the sections the storefront and the admin actually work from
 *    (`resolveGroupSections`)
 *
 * A group section's identity is its category id, never its name. The client
 * can rename Gym Gear to Equipment and keep its position, its switch and its
 * configuration, because none of those were ever keyed on the word.
 */

/* ------------------------------------------------------------------ */
/*  Broad groups                                                      */
/* ------------------------------------------------------------------ */

/** The fields a category row needs for any of this. Extra fields ignored. */
export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  showOnLanding?: boolean | null;
  deleted?: boolean | null;
}

/** A category the store treats as one of its broad groups. */
export interface BroadGroupCategory {
  id: string;
  name: string;
  slug: string;
}

/**
 * The store's broad groups, in the order the client wants them read.
 *
 * This is the same rule the "Shop by group" band has always applied, lifted
 * out so the group *sections* can share it: the CMS category selection wins
 * outright when there is one, and a store whose client never opened Homepage
 * Admin falls back to every category flagged for the landing page.
 *
 * Sharing the rule is the point. It means the band and the sections are two
 * views of one set of groups — but only the set is shared, not the
 * visibility: turning the navigation band off says nothing about whether
 * Supplements has a product section, and vice versa.
 */
export function resolveBroadGroups(
  categories: readonly CategoryRecord[],
  selectedCategoryIds: readonly string[] | undefined,
): BroadGroupCategory[] {
  const live = categories.filter((c) => !c.deleted);

  const asGroup = (c: CategoryRecord): BroadGroupCategory => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
  });

  if (selectedCategoryIds && selectedCategoryIds.length > 0) {
    const byId = new Map(live.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const selected: BroadGroupCategory[] = [];
    for (const id of selectedCategoryIds) {
      if (seen.has(id)) continue;
      const category = byId.get(id);
      // A selected category that has since been deleted simply stops being a
      // group — the section keyed to it then resolves to nothing and its
      // stale order entry is dropped.
      if (!category) continue;
      seen.add(id);
      selected.push(asGroup(category));
    }
    return selected;
  }

  return live.filter((c) => c.showOnLanding !== false).map(asGroup);
}

/** Broad groups read straight off homepage content plus the category list. */
export function broadGroupsFor(
  content: Pick<HomepageContent, "categories">,
  categories: readonly CategoryRecord[],
): BroadGroupCategory[] {
  return resolveBroadGroups(categories, content.categories?.categoryIds);
}

/* ------------------------------------------------------------------ */
/*  Legacy compatibility                                              */
/* ------------------------------------------------------------------ */

/** The presentation each hard-coded group row was built with. */
const LEGACY_PRESENTATION: Record<
  LegacyGroupSectionKey,
  GroupSectionPresentation
> = {
  // Stacks was always the composed panel treatment — it carries two or three
  // bundles on purpose and a four-up shelf left holes in it.
  stacks: "feature",
  gymGear: "shelf",
};

/** The category a legacy group row was pointed at, if it was pointed at one. */
export function legacyGroupCategoryId(
  group: HomepageProductGroupContent | undefined,
): string | undefined {
  return (group?.categoryIds ?? []).find(
    (id) => typeof id === "string" && id.length > 0,
  );
}

/**
 * Drops the deprecated manual product override from a group's configuration.
 *
 * Removes the key rather than emptying it, so a re-saved config stops carrying
 * a field that no longer means anything.
 */
function withoutManualOverride(
  section: HomepageGroupSectionContent,
): HomepageGroupSectionContent {
  if (!("productIds" in section)) return section;
  const { productIds: _deprecated, ...rest } = section;
  return rest;
}

/**
 * Turns one legacy group row into its generic equivalent.
 *
 * Everything that describes the section carries across — whether it is on, its
 * copy, its limit, its "view all", and the presentation it was built with.
 * Its `productIds` deliberately do not: a group is filled from its category
 * now, and a hand-picked list saved under the old model would otherwise
 * survive as a permanent override on a section whose whole point is that it
 * follows the catalogue.
 */
function convertLegacyGroup(
  key: LegacyGroupSectionKey,
  group: HomepageProductGroupContent,
  categoryId: string,
): HomepageGroupSectionContent {
  return {
    categoryId,
    enabled: group.enabled ?? true,
    title: group.title,
    titleAr: group.titleAr,
    subtitle: group.subtitle,
    subtitleAr: group.subtitleAr,
    viewAllText: group.viewAllText,
    viewAllTextAr: group.viewAllTextAr,
    viewAllLink: group.viewAllLink,
    limit: group.limit,
    presentation: LEGACY_PRESENTATION[key],
  };
}

/**
 * The group sections saved content describes, legacy rows included.
 *
 * Runs on every load, and has to be idempotent to be safe there: a legacy row
 * only seeds a section for a category that does not have one yet. Once the
 * client saves anything, `groupSections` holds the truth for that category and
 * the legacy field beside it is inert — otherwise the first save would be
 * silently undone by the stale copy on the next read.
 *
 * Legacy rows that were never pointed at a category cannot become sections:
 * there is no identity to give them. They rendered nothing before this change
 * (no source, no products, `null`), so nothing that was on the page is lost.
 *
 * It is also where the deprecated manual override is dropped, for saved and
 * legacy content alike. Doing it here rather than at each point of use is what
 * makes the guarantee structural: every reader of a group's configuration —
 * the storefront, the admin, the merge that feeds SSR — comes through this
 * function, so there is no path by which a stale `productIds` can reach a
 * product query, and the next save writes the config without it.
 */
export function normalizeGroupSections(
  content: Pick<HomepageContent, "groupSections" | "stacks" | "gymGear">,
): HomepageGroupSectionContent[] {
  const sections: HomepageGroupSectionContent[] = [];
  const claimed = new Set<string>();

  for (const section of content.groupSections ?? []) {
    if (!section?.categoryId || claimed.has(section.categoryId)) continue;
    claimed.add(section.categoryId);
    sections.push(withoutManualOverride(section));
  }

  for (const key of LEGACY_GROUP_SECTION_KEYS) {
    const legacy = content[key];
    const categoryId = legacyGroupCategoryId(legacy);
    if (!legacy || !categoryId || claimed.has(categoryId)) continue;
    claimed.add(categoryId);
    sections.push(convertLegacyGroup(key, legacy, categoryId));
  }

  return sections;
}

/**
 * Rewrites the two legacy group keys in a saved order to their group keys.
 *
 * In place, deliberately. The client arranged this page; a migration that
 * appended the new key and dropped the old one would move Stacks halfway down
 * the homepage as a side effect of a refactor they did not ask for.
 */
export function migrateLegacySectionOrder(
  savedOrder: string[] | undefined,
  content: Pick<HomepageContent, "stacks" | "gymGear">,
): string[] | undefined {
  if (!savedOrder) return savedOrder;

  const replacements = new Map<string, string>();
  for (const key of LEGACY_GROUP_SECTION_KEYS) {
    const categoryId = legacyGroupCategoryId(content[key]);
    if (categoryId) replacements.set(key, groupSectionKey(categoryId));
  }
  if (replacements.size === 0) return savedOrder;

  return savedOrder.map((key) => replacements.get(key) ?? key);
}

/* ------------------------------------------------------------------ */
/*  Resolved sections                                                 */
/* ------------------------------------------------------------------ */

/**
 * One group section with everything needed to render or list it, defaults
 * already applied.
 *
 * The split between `heading` and `category.name` is the load-bearing part.
 * `category.name` is what the section *is* — the name in Section Order, stable
 * across renames of the storefront copy. `heading` is what the shopper reads.
 * They are the same until the client overrides the copy, and the identity
 * never follows the override.
 *
 * There is deliberately no product list on this shape. A group's products are
 * whatever is in its category, so the resolved section carries the category and
 * a limit and nothing that could contradict them — which is why no caller can
 * accidentally reintroduce a manual override.
 */
export interface ResolvedGroupSection {
  /** The `sectionOrder` entry addressing this section. */
  key: string;
  category: BroadGroupCategory;
  enabled: boolean;
  /** Heading the storefront renders. */
  heading: string;
  /** Set only when the client genuinely renamed the heading. */
  headingOverride?: string;
  subtitle?: string;
  viewAllText: string;
  viewAllLink: string;
  /**
   * How many of the category's products the section carries.
   *
   * There is no product list beside it. The category is the source, so the
   * only question left is how much of it the homepage shows.
   */
  limit: number;
  presentation: GroupSectionPresentation;
  /** The stored config, or undefined for a group nobody has configured yet. */
  config?: HomepageGroupSectionContent;
}

/**
 * Whether a heading is still the group's own name.
 *
 * Loose on purpose, exactly as the section-row model compares the static
 * headings: the shipped group copy is set in caps ("GYM GEAR" against the
 * category's "Gym Gear"), and treating case as a rename would put a redundant
 * "Storefront heading: GYM GEAR" under every group row — burying the one case
 * the line exists for.
 */
function sameHeading(a: string, b: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return normalize(a) === normalize(b);
}

/**
 * The store's group sections, one per broad group, in broad-group order.
 *
 * Reconciliation runs in one direction: the broad groups decide which sections
 * exist, and saved content decides how each one is configured. That is what
 * makes a new group appear on its own and a removed group disappear without
 * leaving anything behind — a config whose category is no longer a broad group
 * is simply not returned, and the stale `group:<id>` order entry stops being
 * valid.
 *
 * A group with no saved config is a group the client has not set up. It
 * defaults to off, so opening a catalogue group never changes the live page by
 * itself.
 */
export function resolveGroupSections(
  content: Pick<HomepageContent, "groupSections" | "stacks" | "gymGear">,
  broadGroups: readonly BroadGroupCategory[],
): ResolvedGroupSection[] {
  const configs = new Map(
    normalizeGroupSections(content).map((s) => [s.categoryId, s]),
  );

  return broadGroups.map((category) => {
    const config = configs.get(category.id);
    const title = config?.title?.trim();
    const headingOverride =
      title && !sameHeading(title, category.name) ? title : undefined;
    const viewAllLink = config?.viewAllLink?.trim();
    const viewAllText = config?.viewAllText?.trim();

    return {
      key: groupSectionKey(category.id),
      category,
      enabled: config?.enabled ?? false,
      // The category's own name is the fallback heading, so a group the client
      // has never opened still reads correctly on the storefront.
      heading: title || category.name,
      headingOverride,
      subtitle: config?.subtitle,
      viewAllText: viewAllText || DEFAULT_GROUP_VIEW_ALL_TEXT,
      // A group section is a category, so the category's own page is where
      // "view all" naturally goes. Only an explicit override changes that.
      viewAllLink: viewAllLink || `/categories/${category.slug}`,
      limit: config?.limit ?? DEFAULT_GROUP_SECTION_LIMIT,
      presentation: config?.presentation ?? "shelf",
      config,
    };
  });
}

/** Looks up resolved sections by their `sectionOrder` key. */
export function indexGroupSections(
  sections: readonly ResolvedGroupSection[],
): Map<string, ResolvedGroupSection> {
  return new Map(sections.map((s) => [s.key, s]));
}

/** The category ids of the broad groups, for `resolveSectionOrder`. */
export function groupCategoryIds(
  broadGroups: readonly BroadGroupCategory[],
): string[] {
  return broadGroups.map((g) => g.id);
}

/** True when a section-order entry addresses a broad group section. */
export function isGroupSectionKey(key: string): boolean {
  return parseGroupSectionKey(key) !== undefined;
}
