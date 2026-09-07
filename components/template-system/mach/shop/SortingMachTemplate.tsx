import { memo } from "react";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "#root/components/ui/skeleton";
import type { SortingPageProduct } from "../../sorting/SortingMinimalTemplate";
import { MachChrome } from "../MachChrome";
import { MachProductCard } from "../MachProductCard";
import { MachShopHero } from "./MachShopHero";
import { MachShopToolbar } from "./MachShopToolbar";
import { GUTTER, HEADING_SHOP, SHELL } from "../machTokens";
import {
  DEFAULT_SHOP_CONTENT,
  formatProductCount,
  type ShopContent,
} from "#root/shared/types/shop-content";

/**
 * Mach shop and category browsing template.
 *
 * Serves both `/shop` and the real `/categories/@slug` route — the only
 * difference is the category context the route hands in, so the two pages share
 * one grid, one card, one toolbar and one set of spacing rules.
 *
 * The composition is **product-first**. The page opens on a heading and a live
 * product count, offers the broad groups as a single top-level filter row, and
 * then gets out of the way: the grid starts high, the cards are large, and
 * there is no campaign furniture between the shopper and the catalog. The hero
 * is available and fully CMS-controlled but ships off, because a clean
 * product-first shop is the better production layout.
 *
 * The group row is *not* a category tree. It shows whichever categories the
 * client promoted to top-level in Shop CMS content — or every category, when
 * they have promoted none, which is the correct behaviour for a catalog that
 * contains only the broad groups. Sub-taxonomy never appears here.
 *
 * Fully controlled: search, sort, category and filter state live in the route
 * and drive server-side `product.search`. This component runs no filtering of
 * its own, so counts and pagination describe the real result set rather than
 * one page of client-side leftovers.
 *
 * Every client-visible string is either product/category data or ShopContent.
 * There is no inherited copy and no hard-coded Mach wording here.
 */

export interface MachShopCategoryOption {
  id: string;
  name: string;
  slug?: string | null;
}

export interface MachShopCategoryContext {
  id: string;
  name: string;
  slug?: string | null;
  heading?: string;
  description?: string;
}

export interface SortingMachTemplateProps {
  products: SortingPageProduct[];
  isLoading?: boolean;
  content?: ShopContent;

  /** Set on a category route; null/undefined on /shop. */
  categoryContext?: MachShopCategoryContext | null;

  categories?: MachShopCategoryOption[];
  activeCategoryId?: string | null;
  onCategoryChange?: (categoryId: string | null) => void;

  searchValue: string;
  onSearchChange: (value: string) => void;
  sortValue: string;
  onSortChange: (value: string) => void;

  filtersOpen: boolean;
  onToggleFilters: () => void;
  inStockOnly: boolean;
  onInStockOnlyChange: (value: boolean) => void;
  discountedOnly: boolean;
  onDiscountedOnlyChange: (value: boolean) => void;

  totalProducts: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;

  className?: string;
}

/* ------------------------------------------------------------------ */

function Breadcrumb({
  category,
}: {
  category?: MachShopCategoryContext | null;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--mach-mute)]">
      <a href="/" className="transition-colors hover:text-[var(--mach-ink)]">
        Home
      </a>
      <ChevronRight aria-hidden="true" className="h-2.5 w-2.5 opacity-60" />
      {category ? (
        <>
          <a
            href="/shop"
            className="transition-colors hover:text-[var(--mach-ink)]">
            Shop
          </a>
          <ChevronRight aria-hidden="true" className="h-2.5 w-2.5 opacity-60" />
          <span className="text-[var(--mach-ink)]">{category.name}</span>
        </>
      ) : (
        <span className="text-[var(--mach-ink)]">Shop</span>
      )}
    </nav>
  );
}

/**
 * Top-level broad-group switcher — the shop's primary navigation.
 *
 * It is navigation, so it is drawn as navigation: a rail of labels sharing one
 * hairline, the active one carried by a hard black underline and full-weight
 * ink, the rest dropped to mute until hovered. The previous treatment gave
 * every group a filled or outlined button, which put four pieces of form
 * chrome across the top of a merchandised page and made the current group read
 * as a pressed control rather than as the page you are on.
 *
 * The underline is the masthead rule: each label carries a 2px bottom border
 * pulled a pixel down over the row's own hairline, so the active tab looks
 * like a thickening of the rule instead of a mark floating above it.
 *
 * "All" is a real option and the default. The rail scrolls horizontally on
 * phones — bleeding past the gutter so it visibly continues off-screen —
 * rather than squeezing four labels into 350px, and every label is a 44px
 * touch target.
 *
 * Behaviour is unchanged: these are the same two calls into the same handler.
 */
function GroupNav({
  categories,
  activeCategoryId,
  onCategoryChange,
  className = "",
}: {
  categories: MachShopCategoryOption[];
  activeCategoryId?: string | null;
  onCategoryChange: (id: string | null) => void;
  className?: string;
}) {
  const tab = (active: boolean) =>
    `-mb-px whitespace-nowrap border-b-2 pb-4 pt-3.5 text-[11px] font-bold uppercase tracking-[0.16em] transition-colors duration-200 sm:text-[12px] sm:tracking-[0.2em] ${
      active
        ? "border-[var(--mach-ink)] text-[var(--mach-ink)]"
        : "border-transparent text-[var(--mach-mute)] hover:text-[var(--mach-ink)]"
    }`;

  return (
    <nav aria-label="Product groups" className={className}>
      <div className="scrollbar-hide -mx-5 overflow-x-auto px-5 sm:-mx-8 sm:px-8 lg:mx-0 lg:px-0">
        <div className="flex w-max min-w-full items-end gap-7 border-b border-[var(--mach-ink)]/15 sm:gap-9 lg:gap-10">
          <button
            type="button"
            onClick={() => onCategoryChange(null)}
            aria-current={!activeCategoryId ? "true" : undefined}
            className={tab(!activeCategoryId)}>
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onCategoryChange(c.id)}
              aria-current={activeCategoryId === c.id ? "true" : undefined}
              className={tab(activeCategoryId === c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

function FilterPanel({
  inStockOnly,
  onInStockOnlyChange,
  discountedOnly,
  onDiscountedOnlyChange,
}: {
  inStockOnly: boolean;
  onInStockOnlyChange: (v: boolean) => void;
  discountedOnly: boolean;
  onDiscountedOnlyChange: (v: boolean) => void;
}) {
  const box =
    "flex cursor-pointer items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--mach-ink)] sm:text-[12px]";
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-[var(--mach-ink)]/12 pt-5">
      <label className={box}>
        <input
          type="checkbox"
          checked={inStockOnly}
          onChange={(e) => onInStockOnlyChange(e.target.checked)}
          className="h-4 w-4 accent-[var(--mach-ink)]"
        />
        In stock only
      </label>
      <label className={box}>
        <input
          type="checkbox"
          checked={discountedOnly}
          onChange={(e) => onDiscountedOnlyChange(e.target.checked)}
          className="h-4 w-4 accent-[var(--mach-ink)]"
        />
        On sale
      </label>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  // Same restraint as the toolbar: hairline-only, quiet until worked.
  const btn =
    "inline-flex h-11 min-w-11 items-center justify-center border-b border-[var(--mach-ink)]/25 px-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--mach-ink)] transition-colors duration-200 hover:border-[var(--mach-ink)] disabled:pointer-events-none disabled:opacity-30";
  return (
    <nav
      aria-label="Pagination"
      className="mt-20 flex items-center justify-center gap-8 border-t border-[var(--mach-ink)]/10 pt-12 sm:gap-10">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className={btn}>
        Prev
      </button>
      <span className="px-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--mach-mute)]">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className={btn}>
        Next
      </button>
    </nav>
  );
}

/**
 * The grid. Two-up on phones, three-up from tablet and four-up only on the
 * widest screens — one step less dense than the previous four-up-at-1024 rule,
 * so a supplement tub reads at real scale instead of as a thumbnail.
 *
 * The rhythm is deliberately anisotropic: rows are spaced roughly twice as far
 * apart as columns at every breakpoint. Equal gutters are what make a product
 * grid read as a spreadsheet — the eye has no reason to group a row — and the
 * cards carry no frame, so the vertical air is the only thing separating one
 * row of products from the next.
 */
const GRID =
  "grid grid-cols-2 gap-x-5 gap-y-12 sm:gap-x-6 sm:gap-y-14 md:grid-cols-3 lg:gap-x-7 lg:gap-y-16 xl:grid-cols-4 xl:gap-x-8 xl:gap-y-20";

/* ------------------------------------------------------------------ */

export const SortingMachTemplate = memo(function SortingMachTemplate({
  products,
  isLoading = false,
  content = DEFAULT_SHOP_CONTENT,
  categoryContext = null,
  categories = [],
  activeCategoryId = null,
  onCategoryChange,
  searchValue,
  onSearchChange,
  sortValue,
  onSortChange,
  filtersOpen,
  onToggleFilters,
  inStockOnly,
  onInStockOnlyChange,
  discountedOnly,
  onDiscountedOnlyChange,
  totalProducts,
  page,
  totalPages,
  onPageChange,
  className = "",
}: SortingMachTemplateProps) {
  // On a category route the category owns the heading; on /shop the CMS does.
  const heading = categoryContext
    ? categoryContext.heading?.trim() || categoryContext.name
    : (content.heading || "").trim();
  const intro = categoryContext
    ? (categoryContext.description || "").trim()
    : (content.intro || "").trim();

  const activeFilterCount = (inStockOnly ? 1 : 0) + (discountedOnly ? 1 : 0);
  const countLabel = formatProductCount(totalProducts, content);
  const emptyText =
    (content.emptyStateText || "").trim() ||
    "No products match your selection.";

  const showGroups = categories.length > 0 && Boolean(onCategoryChange);

  return (
    // MachChrome puts the Mach footer under the shop and the category pages,
    // so the storefront does not change footer between the homepage and
    // everywhere else.
    <MachChrome>
      {/* One continuous paper ground under the whole page, with the product
          stages drawn on it in white.

          The shop used to run white with a paper masthead, which left the
          cards nothing to stand on: the pack shots are photographed on white
          and are not cut out, so on a white page every product dissolved into
          the ground and the grid read as a flat sheet of pictures. Inverting
          it — paper page, white stage — makes each tile a piece of
          merchandising without drawing a single border, and the photo's own
          white background lands exactly on the stage instead of showing up as
          a rectangle inside a frame. It is also why the stage cannot be tinted
          off-white: that would put the rectangle back. */}
      <div
        className={`mach-shop bg-[var(--mach-paper)] text-[var(--mach-ink)] ${className}`}>
        {/* Hero renders nothing at all when disabled — no reserved space. */}
        {!categoryContext && <MachShopHero hero={content.hero} />}

        {/* ── Masthead: what this page is, how much of it there is, and the
            groups it is divided into. The group rail belongs here rather than
            with the search row — it is navigation, and the rule it stands on
            is what closes the masthead. ── */}
        <header className={`${GUTTER} pt-7 sm:pt-10 lg:pt-12`}>
          <div className={SHELL}>
            <Breadcrumb category={categoryContext} />

            {heading && (
              // The live count sits with the heading rather than in the
              // toolbar: on a product-first page the size of the catalog is
              // part of the headline, not a filter readout. It is subordinate
              // by weight, not by distance — micro type at the far end of a
              // hairline that runs off the heading's baseline. On phones the
              // rule is dropped and the count takes the line underneath, which
              // keeps the masthead three tight lines deep.
              <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-1.5 sm:mt-5">
                <h1 className={HEADING_SHOP}>{heading}</h1>
                {!isLoading && totalProducts > 0 && (
                  <>
                    <span
                      aria-hidden="true"
                      className="hidden h-px min-w-8 flex-1 -translate-y-[0.6rem] bg-[var(--mach-ink)]/15 sm:block"
                    />
                    <span className="w-full pb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--mach-mute)] sm:w-auto sm:pb-[0.35rem]">
                      {countLabel}
                    </span>
                  </>
                )}
              </div>
            )}

            {intro && (
              <p className="mt-4 max-w-[52ch] text-[13px] leading-relaxed text-[var(--mach-mute)] sm:text-[15px]">
                {intro}
              </p>
            )}

            {showGroups ? (
              <GroupNav
                className="mt-7 sm:mt-9"
                categories={categories}
                activeCategoryId={activeCategoryId}
                onCategoryChange={
                  onCategoryChange as (id: string | null) => void
                }
              />
            ) : (
              // Without groups the masthead still needs its closing rule, or
              // the search row floats under the heading with nothing under it.
              <div className="mt-7 border-b border-[var(--mach-ink)]/15 sm:mt-9" />
            )}
          </div>
        </header>

        {/* ── Utility row ── */}
        <section className={`${GUTTER} pt-6 sm:pt-7`}>
          <div className={SHELL}>
            <MachShopToolbar
              searchValue={searchValue}
              onSearchChange={onSearchChange}
              sortValue={sortValue}
              onSortChange={onSortChange}
              filtersOpen={filtersOpen}
              onToggleFilters={onToggleFilters}
              activeFilterCount={activeFilterCount}
            />
            {filtersOpen && (
              <FilterPanel
                inStockOnly={inStockOnly}
                onInStockOnlyChange={onInStockOnlyChange}
                discountedOnly={discountedOnly}
                onDiscountedOnlyChange={onDiscountedOnlyChange}
              />
            )}
          </div>
        </section>

        {/* ── Grid ── */}
        <section className={`${GUTTER} pb-24 pt-10 sm:pt-12 lg:pt-14`}>
          <div className={SHELL}>
            {isLoading ? (
              <div className={GRID}>
                {Array.from({ length: 8 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
                  <div key={i}>
                    {/* Square, hard-edged and white — the skeleton stands in
                        for the media stage, so it has to be the same shape. */}
                    <Skeleton className="aspect-square w-full rounded-none" />
                    <Skeleton className="mt-5 h-2.5 w-1/3 rounded-none sm:mt-6" />
                    <Skeleton className="mt-3 h-3.5 w-4/5 rounded-none" />
                    <Skeleton className="mt-3 h-3.5 w-1/4 rounded-none" />
                  </div>
                ))}
              </div>
            ) : products.length === 0 ? (
              <p className="py-24 text-center text-sm text-[var(--mach-mute)]">
                {emptyText}
              </p>
            ) : (
              <>
                <div className={GRID}>
                  {products.map((p) => (
                    // `variant="shop"` and not `size="lg"`: the shelf sizes
                    // stay where the homepage put them.
                    <MachProductCard key={p.id} product={p} variant="shop" />
                  ))}
                </div>
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  onPageChange={onPageChange}
                />
              </>
            )}
          </div>
        </section>
      </div>
    </MachChrome>
  );
});
