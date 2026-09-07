import type { MediaSlot } from "./homepage-content";
import { isMediaSlotEmpty } from "./homepage-content";

/**
 * Client-editable content for the Mach Shop and real category pages.
 *
 * Stored in the existing `homepage_content` table under
 * `template_id = "sorting-mach"` — that table is a generic
 * (merchant_id, template_id) → jsonb content store, so this needs no new table
 * and no migration. It is deliberately kept OUT of `HomepageContentSchema`:
 * the shapes have nothing in common and forcing shop fields into the homepage
 * schema would couple two unrelated editors.
 *
 * Nothing here is product or category *data* — products come from the product
 * tables and categories from the category table. This is only the surrounding
 * copy and media the client owns.
 */

export const SHOP_CONTENT_TEMPLATE_ID = "sorting-mach";

/** Optional full-bleed banner at the top of the shop. */
export interface ShopHeroContent {
  /**
   * When false the hero is not published. The storefront renders no element at
   * all — no reserved height, no empty band — and the page heading moves up.
   * Disabling never clears the stored media or copy, so the client can toggle
   * it back on without re-entering anything.
   */
  enabled: boolean;
  media?: MediaSlot;
  headline?: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export interface ShopContent {
  hero: ShopHeroContent;
  /** Page heading. Blank hides the heading row entirely. */
  heading?: string;
  /**
   * The broad groups offered as top-level filters, in display order.
   *
   * Mach's storefront is product-first: the client sells out of three broad
   * groups, and the shop's primary filter row is meant to be exactly
   * ALL / SUPPLEMENTS / STACKS & BUNDLES / GYM GEAR — not a category tree.
   *
   * These are category ids, so the category system stays authoritative for
   * each group's own name and slug; this only records which of them are
   * promoted to the top-level row and in what order. Left empty, every
   * category is offered, which is the correct behaviour for a catalog that
   * already contains only the broad groups.
   */
  groupCategoryIds?: string[];
  /** Short paragraph under the heading. Blank hides it. */
  intro?: string;
  /** Shown when a search/filter combination returns nothing. */
  emptyStateText?: string;
  /** Terminology for the product counter, e.g. "product" / "products". */
  countSingular?: string;
  countPlural?: string;
  /**
   * Per-category copy, keyed by category id.
   *
   * FALLBACK, deliberately. The repo already ships a `category_content` system
   * (table, services, tRPC, admin page) that owns exactly these fields — but
   * its `category_content` table is defined in schema.ts and present in every
   * drizzle snapshot from 0009 onward while **no .sql migration ever creates
   * it**, so the table does not exist in any database and the service silently
   * returns defaults. Repairing that needs a migration, which is out of scope
   * for this phase, so category copy lives here for now. Migrating this map
   * into `category_content` later is a data move, not a redesign.
   */
  categories?: Record<string, ShopCategoryContent>;
}

export interface ShopCategoryContent {
  /** Overrides the category's own name as the page heading when set. */
  heading?: string;
  description?: string;
  /** Category banner. Falls back to the shop hero media when unset. */
  media?: MediaSlot;
}

export const DEFAULT_SHOP_CONTENT: ShopContent = {
  // The shop leads with products, not a campaign banner. A hero is available
  // and fully CMS-controlled, but it is off unless the client turns it on.
  hero: { enabled: false },
  heading: "PRODUCTS",
};

/** True when the hero should render nothing at all. */
export function isShopHeroHidden(hero: ShopHeroContent | undefined): boolean {
  if (!hero || !hero.enabled) return true;
  // An enabled hero with neither media nor copy would render an empty band.
  return (
    isMediaSlotEmpty(hero.media) &&
    !(hero.headline || "").trim() &&
    !(hero.description || "").trim()
  );
}

/** Fills in every optional branch so consumers never null-check twice. */
export function mergeShopContentWithDefaults(
  stored: Partial<ShopContent> | null | undefined,
): ShopContent {
  return {
    ...DEFAULT_SHOP_CONTENT,
    ...(stored ?? {}),
    hero: { ...DEFAULT_SHOP_CONTENT.hero, ...(stored?.hero ?? {}) },
    categories: stored?.categories ?? {},
    groupCategoryIds: stored?.groupCategoryIds ?? [],
  };
}

/** Picks the right count noun without hard-coding terminology in a component. */
export function formatProductCount(
  count: number,
  content: Pick<ShopContent, "countSingular" | "countPlural">,
): string {
  const singular = (content.countSingular || "product").trim();
  const plural = (content.countPlural || "products").trim();
  return `${count} ${count === 1 ? singular : plural}`;
}
