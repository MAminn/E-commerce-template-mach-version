import { memo } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";

/**
 * Search / sort / filter strip.
 *
 * Fully controlled — every value and handler is owned by the route, which
 * drives the server-side product.search query. Nothing filters in here, so the
 * numbers shown always describe the whole result set rather than one page.
 *
 * Hierarchy, in order of weight: the broad-group tabs above this strip, then
 * search (the widest control here, and the only one on its own row at small
 * widths), then the two refinements. Sort and Filters are deliberately quiet —
 * they are refinements of a product-first page, not its navigation.
 *
 * The result count is deliberately not here. It sits on the page heading, so
 * the shopper reads "PRODUCTS / 24 products" as one statement — and at every
 * width the heading and this strip are close enough together that repeating it
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
  const control =
    "h-12 border border-[var(--mach-ink)]/20 bg-white text-[var(--mach-ink)] outline-none transition-colors focus:border-[var(--mach-ink)]";

  return (
    <div className="border-y border-[var(--mach-ink)]/12 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        {/* Search — the primary control, full width on mobile */}
        <div className="relative w-full lg:max-w-md">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--mach-mute)]"
          />
          <input
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search products"
            aria-label="Search products"
            className={`${control} w-full ps-11 pe-10 text-sm placeholder:text-[var(--mach-mute)]`}
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              className="absolute end-2.5 top-1/2 -translate-y-1/2 p-1 text-[var(--mach-mute)] hover:text-[var(--mach-ink)]">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onToggleFilters}
            aria-expanded={filtersOpen}
            className={`${control} inline-flex items-center gap-2 px-5 text-[11px] font-bold uppercase tracking-[0.18em] hover:border-[var(--mach-ink)] ${
              filtersOpen
                ? "border-[var(--mach-ink)] bg-[var(--mach-ink)] text-white"
                : ""
            }`}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span
                className={`ms-1 inline-flex h-4 min-w-4 items-center justify-center px-1 text-[10px] font-bold ${
                  filtersOpen
                    ? "bg-white text-[var(--mach-ink)]"
                    : "bg-[var(--mach-ink)] text-white"
                }`}>
                {activeFilterCount}
              </span>
            )}
          </button>

          <label className="sr-only" htmlFor="mach-shop-sort">
            Sort products
          </label>
          <select
            id="mach-shop-sort"
            value={sortValue}
            onChange={(e) => onSortChange(e.target.value)}
            className={`${control} px-4 text-[11px] font-bold uppercase tracking-[0.18em]`}>
            {MACH_SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
});
