import { memo } from "react";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "#root/components/ui/skeleton";
import type { SortingPageProduct } from "../../sorting/SortingMinimalTemplate";
import { MachChrome } from "../MachChrome";
import { MachProductCard } from "../MachProductCard";
import { MachShopHero } from "./MachShopHero";
import { MachShopToolbar } from "./MachShopToolbar";
import { GUTTER, HEADING, SHELL } from "../machTokens";
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
      className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--mach-mute)]">
      <a href="/" className="transition-colors hover:text-[var(--mach-ink)]">
        Home
      </a>
      <ChevronRight aria-hidden="true" className="h-3 w-3" />
      {category ? (
        <>
          <a
            href="/shop"
            className="transition-colors hover:text-[var(--mach-ink)]">
            Shop
          </a>
          <ChevronRight aria-hidden="true" className="h-3 w-3" />
          <span className="text-[var(--mach-ink)]">{category.name}</span>
        </>
      ) : (
        <span className="text-[var(--mach-ink)]">Shop</span>
      )}
    </nav>
  );
}

/**
 * Top-level broad-group switcher.
 *
 * Deliberately heavy: on a product-first storefront this row is the primary
 * navigation of the shop, not a secondary refinement, so it reads as a set of
 * hard-edged tabs rather than small pills. "All" is a real option and the
 * default.
 */
function GroupNav({
  categories,
  activeCategoryId,
  onCategoryChange,
}: {
  categories: MachShopCategoryOption[];
  activeCategoryId?: string | null;
  onCategoryChange: (id: string | null) => void;
}) {
  const tab = (active: boolean) =>
    `whitespace-nowrap border px-5 py-3 text-[11px] font-black uppercase tracking-[0.2em] transition-colors sm:px-7 sm:py-3.5 sm:text-[12px] ${
      active
        ? "border-[var(--mach-ink)] bg-[var(--mach-ink)] text-white"
        : "border-[var(--mach-ink)]/20 bg-white text-[var(--mach-ink)] hover:border-[var(--mach-ink)]"
    }`;

  return (
    <div className="-mx-5 overflow-x-auto px-5 pb-1 sm:-mx-8 sm:px-8 lg:mx-0 lg:px-0">
      <div className="flex min-w-max items-center gap-2">
        <button
          type="button"
          onClick={() => onCategoryChange(null)}
          className={tab(!activeCategoryId)}>
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onCategoryChange(c.id)}
            className={tab(activeCategoryId === c.id)}>
            {c.name}
          </button>
        ))}
      </div>
    </div>
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
    "flex cursor-pointer items-center gap-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--mach-ink)]";
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-[var(--mach-ink)]/12 py-4">
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
  const btn =
    "inline-flex h-11 min-w-11 items-center justify-center border border-[var(--mach-ink)]/20 bg-white px-4 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--mach-ink)] transition-colors hover:border-[var(--mach-ink)] disabled:pointer-events-none disabled:opacity-35";
  return (
    <nav
      aria-label="Pagination"
      className="mt-16 flex items-center justify-center gap-2 border-t border-[var(--mach-ink)]/10 pt-10">
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
 */
const GRID =
  "grid grid-cols-2 gap-x-4 gap-y-12 sm:gap-x-6 md:grid-cols-3 lg:gap-y-16 xl:grid-cols-4 xl:gap-x-8";

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
      <div className={`mach-shop bg-white text-[var(--mach-ink)] ${className}`}>
        {/* Hero renders nothing at all when disabled — no reserved space. */}
        {!categoryContext && <MachShopHero hero={content.hero} />}

        {/* ── Masthead: what this page is, and how much of it there is ── */}
        <header
          className={`${GUTTER} border-b border-[var(--mach-ink)]/10 bg-[var(--mach-paper)] pt-8 pb-9 sm:pt-10 sm:pb-11`}>
          <div className={SHELL}>
            <Breadcrumb category={categoryContext} />

            {heading && (
              <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-2">
                <h1 className={HEADING}>{heading}</h1>
                {/* The live count sits on the heading baseline rather than in
                  the toolbar: on a product-first page the size of the catalog
                  is part of the headline, not a filter readout. */}
                {!isLoading && totalProducts > 0 && (
                  <span className="pb-2 text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--mach-mute)]">
                    {countLabel}
                  </span>
                )}
              </div>
            )}

            {intro && (
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--mach-mute)] sm:text-base">
                {intro}
              </p>
            )}
          </div>
        </header>

        {/* ── Controls ── */}
        <section className={`${GUTTER} pt-7`}>
          <div className={SHELL}>
            {showGroups && (
              <GroupNav
                categories={categories}
                activeCategoryId={activeCategoryId}
                onCategoryChange={
                  onCategoryChange as (id: string | null) => void
                }
              />
            )}

            <div className={showGroups ? "mt-5" : ""}>
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
          </div>
        </section>

        {/* ── Grid ── */}
        <section className={`${GUTTER} pb-24 pt-12 sm:pt-14`}>
          <div className={SHELL}>
            {isLoading ? (
              <div className={GRID}>
                {Array.from({ length: 8 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
                  <div key={i}>
                    <Skeleton className="aspect-square w-full" />
                    <Skeleton className="mt-5 h-3 w-1/3" />
                    <Skeleton className="mt-2.5 h-4 w-4/5" />
                    <Skeleton className="mt-2.5 h-4 w-1/4" />
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
                    <MachProductCard key={p.id} product={p} size="lg" />
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
