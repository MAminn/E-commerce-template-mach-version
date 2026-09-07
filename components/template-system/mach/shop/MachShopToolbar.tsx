import { memo } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";

/**
 * Search / filter / sort utility row.
 *
 * Fully controlled — every value and handler is owned by the route, which
 * drives the server-side product.search query. Nothing filters in here, so the
 * numbers shown always describe the whole result set rather than one page.
 *
 * ── Why there are no boxes ────────────────────────────────────────────────
 *
 * This row used to be three bordered fields inside a boxed band, which is what
 * made a merchandised page open like an admin screen: four rectangles of
 * chrome above the first product. The controls now share a single rule — each
 * one is a 44px cell sitting on a hairline, and every hairline lands on the
 * same baseline across the row, so the row reads as one line of utility rather
 * than as a toolbar assembled from widgets.
 *
 * They are deliberately quiet at rest and only darken their rule on hover or
 * focus. That is the hierarchy: the group navigation above is the page's
 * navigation, the grid below is its content, and this is a refinement of both.
 *
 * The result count is deliberately not here. It sits on the page heading, so
 * the shopper reads "PRODUCTS / 24 products" as one statement — and at every
 * width the heading and this row are close enough together that repeating it
 * would just be the same number twice.
 */

export interface SortOption {
  value: string;
  label: string;
}

export const MACH_SORT_OPTIONS: SortOption[] = [
  { value: "featured", label: "Featured" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
];

/**
 * One 44px cell standing on a hairline that darkens when it is worked.
 *
 * The rule colour is deliberately NOT in here. Two unprefixed `border-*`
 * utilities on the same element are resolved by stylesheet order rather than
 * by the order they are written in the class attribute, so a cell that has to
 * show a permanently-darkened rule (Filters, while a filter is applied) has to
 * supply exactly one resting colour, not override a second one.
 */
const CELL = "flex h-11 items-center border-b transition-colors duration-200";

/** Resting hairline. */
const RULE = "border-[var(--mach-ink)]/20";
/** Worked, or holding state. */
const RULE_ON = "border-[var(--mach-ink)]";

/** Micro-label type, one step tighter on phones so nothing has to truncate. */
const LABEL =
  "text-[10px] font-bold uppercase tracking-[0.14em] sm:text-[11px] sm:tracking-[0.18em]";

export const MachShopToolbar = memo(function MachShopToolbar({
  searchValue,
  onSearchChange,
  sortValue,
  onSortChange,
  filtersOpen,
  onToggleFilters,
  activeFilterCount,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  sortValue: string;
  onSortChange: (value: string) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
}) {
  return (
    <div className="flex flex-col gap-4 sm:gap-5 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
      {/* ── Search — full width on phones, a third of the row on desktop ── */}
      <div
        className={`${CELL} ${RULE} relative w-full focus-within:border-[var(--mach-ink)] lg:max-w-[360px]`}>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute start-0 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--mach-mute)]"
        />
        <input
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search products"
          aria-label="Search products"
          className="h-full w-full min-w-0 border-0 bg-transparent ps-7 pe-8 text-[13px] text-[var(--mach-ink)] outline-none placeholder:text-[var(--mach-mute)] sm:text-sm"
        />
        {searchValue && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute end-0 top-1/2 -translate-y-1/2 p-1.5 text-[var(--mach-mute)] transition-colors hover:text-[var(--mach-ink)]">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ── Refinements — two cells, side by side at every width ──
          Filters keeps its intrinsic width and Sort takes what is left, so a
          long sort label has room to sit on a 390px screen instead of forcing
          the row to wrap or scroll. */}
      <div className="flex items-end gap-6 sm:gap-8 lg:gap-10">
        <button
          type="button"
          onClick={onToggleFilters}
          aria-expanded={filtersOpen}
          className={`${CELL} ${LABEL} ${
            filtersOpen || activeFilterCount > 0 ? RULE_ON : RULE
          } shrink-0 gap-2 text-[var(--mach-ink)] hover:border-[var(--mach-ink)]`}>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ms-0.5 inline-flex h-4 min-w-4 items-center justify-center bg-[var(--mach-ink)] px-1 text-[10px] font-bold leading-none text-white">
              {activeFilterCount}
            </span>
          )}
        </button>

        <label className="sr-only" htmlFor="mach-shop-sort">
          Sort products
        </label>
        <div
          className={`${CELL} ${RULE} relative min-w-0 flex-1 gap-2 hover:border-[var(--mach-ink)] focus-within:border-[var(--mach-ink)] lg:flex-none`}>
          <span
            aria-hidden="true"
            className={`${LABEL} shrink-0 text-[var(--mach-mute)]`}>
            Sort
          </span>
          <select
            id="mach-shop-sort"
            value={sortValue}
            onChange={(e) => onSortChange(e.target.value)}
            className={`${LABEL} h-full w-full min-w-0 cursor-pointer appearance-none truncate border-0 bg-transparent pe-5 text-[var(--mach-ink)] outline-none`}>
            {MACH_SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute end-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--mach-mute)]"
          />
        </div>
      </div>
    </div>
  );
});
