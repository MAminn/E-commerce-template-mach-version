import { useCallback, useEffect, useMemo, useState } from "react";
import { trpc } from "#root/shared/trpc/client";
import { mapSearchProducts } from "#root/lib/utils/product-media";
import { getStoreOwnerId } from "#root/shared/config/store";
import type { SortingPageProduct } from "../../sorting/SortingMinimalTemplate";
import {
  DEFAULT_SHOP_CONTENT,
  mergeShopContentWithDefaults,
  type ShopContent,
} from "#root/shared/types/shop-content";
import {
  SortingMachTemplate,
  type MachShopCategoryContext,
  type MachShopCategoryOption,
} from "./SortingMachTemplate";

/**
 * Container for Mach shop and category browsing.
 *
 * Both `/shop` and `/categories/@slug` mount this, so the two pages cannot
 * drift apart: identical query behaviour, identical toolbar, identical grid.
 *
 * All browsing is server-side. Search text, sort, category, the stock and sale
 * filters and pagination are all passed to the existing `product.search`
 * procedure, which already implements every one of them — there is no second
 * search implementation here, and no client-side slice of a fixed first page.
 * That also removes the previous 100-product ceiling.
 */

const PAGE_SIZE = 24;

export interface MachShopViewProps {
  /**
   * Set on a category route. The slug alone is enough — the category is
   * resolved here from the same category list the chips use, so the page never
   * renders as the all-products shop for a frame while an id is looked up
   * separately by the route.
   */
  categorySlug?: string | null;
  /**
   * Category resolved during SSR by the route's `+data.ts`. When supplied the
   * heading, breadcrumb and product query are all correct on the first paint —
   * the client-side category list is not consulted to identify the current
   * category at all. It still loads normally for browsing chips elsewhere.
   */
  ssrCategory?: {
    id: string;
    name: string;
    slug?: string | null;
    imageUrl?: string | null;
  } | null;
  /**
   * Pre-selected category on /shop from a `?category=` link. Accepts either a
   * category id or a slug — both forms are produced by existing links, and the
   * category list fetched here resolves whichever arrives.
   */
  initialCategoryId?: string | null;
  /**
   * Shop CMS content resolved during SSR. Supplied by each route's `+data.ts`
   * so the hero, heading and intro are in the first paint rather than popping
   * in after hydration. When present the client does not re-fetch it.
   */
  content?: ShopContent;
  /**
   * Merchandising entry point from a `?section=` link (offers / newarrivals /
   * featured) — the destinations Layout Settings already points navigation and
   * footer links at.
   *
   * These are merchandising slots, not categories: they only set the shop's
   * opening sort or sale filter, both of which `product.search` already
   * implements. The shopper can change either from the toolbar afterwards.
   */
  initialSection?: string | null;
}

export function MachShopView({
  categorySlug = null,
  ssrCategory = null,
  initialCategoryId = null,
  content: ssrContent,
  initialSection = null,
}: MachShopViewProps) {
  const merchantId = getStoreOwnerId();

  const [content, setContent] = useState<ShopContent>(
    ssrContent ?? DEFAULT_SHOP_CONTENT,
  );
  const [categories, setCategories] = useState<MachShopCategoryOption[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);

  const [products, setProducts] = useState<SortingPageProduct[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // A category route is in "category mode" from the very first render, before
  // the slug has resolved to an id — that keeps the chips hidden and the
  // breadcrumb correct instead of briefly showing the all-products layout.
  const isCategoryRoute = Boolean(categorySlug || ssrCategory);
  const category = useMemo(() => {
    // Prefer the server-resolved category; only fall back to searching the
    // client list when SSR could not supply one.
    if (ssrCategory) {
      return {
        id: ssrCategory.id,
        name: ssrCategory.name,
        slug: ssrCategory.slug ?? null,
      };
    }
    return categorySlug
      ? (categories.find((c) => c.slug === categorySlug) ?? null)
      : null;
  }, [ssrCategory, categorySlug, categories]);

  // On a category route the category is fixed; on /shop it is a filter.
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(
    initialCategoryId ?? null,
  );

  // Adopt the resolved category id once the category list arrives.
  useEffect(() => {
    if (isCategoryRoute) setActiveCategoryId(category?.id ?? null);
  }, [isCategoryRoute, category?.id]);

  // `?category=` may carry a slug rather than an id; resolve it once the
  // category list lands so the chip and the query agree.
  const [initialParamResolved, setInitialParamResolved] = useState(false);
  useEffect(() => {
    if (isCategoryRoute || initialParamResolved) return;
    if (!initialCategoryId || categories.length === 0) return;
    const match = categories.find(
      (c) => c.id === initialCategoryId || c.slug === initialCategoryId,
    );
    if (match) setActiveCategoryId(match.id);
    setInitialParamResolved(true);
  }, [isCategoryRoute, initialParamResolved, initialCategoryId, categories]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(
    initialSection === "newarrivals" ? "newest" : "featured",
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [discountedOnly, setDiscountedOnly] = useState(
    initialSection === "offers",
  );
  const [page, setPage] = useState(1);

  /* ── CMS content ─────────────────────────────────────────────────── */
  // Only fetched when SSR did not already supply it, so there is exactly one
  // read of the shop content per page load.
  useEffect(() => {
    if (ssrContent) return;
    let cancelled = false;
    trpc.shopContent.getContent
      .query({ merchantId })
      .then((res) => {
        if (cancelled || !res.success) return;
        setContent(mergeShopContentWithDefaults(res.result));
      })
      .catch(() => {
        /* copy is an enhancement — never block browsing */
      });
    return () => {
      cancelled = true;
    };
  }, [merchantId, ssrContent]);

  // Keep in step if the route hands down fresh SSR content on navigation.
  useEffect(() => {
    if (ssrContent) setContent(ssrContent);
  }, [ssrContent]);

  /* ── Category chips (real category data, never CMS) ──────────────── */
  useEffect(() => {
    let cancelled = false;
    trpc.category.view
      .query()
      .then((res) => {
        if (cancelled || !res.success || !Array.isArray(res.result)) return;
        setCategories(
          (res.result as any[]).map((c) => ({
            id: c.id as string,
            name: (c.displayName || c.name) as string,
            slug: c.slug as string | null,
          })),
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCategoriesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── Debounce the search box ─────────────────────────────────────── */
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  /* ── Server-side product query ───────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;

    // On a category route, wait for the slug to resolve rather than briefly
    // querying (and showing) the whole catalogue. Once the category list has
    // arrived and the slug still matches nothing, stop waiting and fall through
    // to the empty state instead of spinning on a skeleton forever.
    if (isCategoryRoute && !activeCategoryId) {
      // SSR could not resolve the slug, so we are waiting on the client list.
      // Once that has loaded without a match there is nothing left to wait for.
      if (categoriesLoaded) {
        setProducts([]);
        setTotalProducts(0);
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);

    trpc.product.search
      .query({
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        // The stock filter is the search procedure's own flag, so out-of-stock
        // products are excluded in SQL rather than hidden after paging.
        includeOutOfStock: !inStockOnly,
        categoryIds: activeCategoryId ? [activeCategoryId] : undefined,
        search: search || undefined,
        sortBy:
          sort === "featured"
            ? undefined
            : (sort as "newest" | "price-asc" | "price-desc"),
        discountedOnly: discountedOnly || undefined,
      })
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.result) {
          setProducts(mapSearchProducts(res.result.items ?? []));
          setTotalProducts(res.result.total ?? 0);
        } else {
          setProducts([]);
          setTotalProducts(0);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[MachShop] product search failed:", err);
        setProducts([]);
        setTotalProducts(0);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    page,
    activeCategoryId,
    search,
    sort,
    inStockOnly,
    discountedOnly,
    isCategoryRoute,
    categoriesLoaded,
  ]);

  const totalPages = Math.max(1, Math.ceil(totalProducts / PAGE_SIZE));

  /* ── Broad groups offered as top-level filters ───────────────────── */
  // The client promotes the broad groups (and their order) in Shop CMS
  // content; with nothing promoted every category is offered, which is right
  // for a catalog that already contains only the broad groups. Names and slugs
  // still come from the category system, never from the CMS.
  const groupCategories = useMemo(() => {
    const promoted = content.groupCategoryIds ?? [];
    if (promoted.length === 0) return categories;
    const byId = new Map(categories.map((c) => [c.id, c]));
    return promoted
      .map((id) => byId.get(id))
      .filter((c): c is MachShopCategoryOption => Boolean(c));
  }, [categories, content.groupCategoryIds]);

  /* ── Category context / copy ─────────────────────────────────────── */
  const categoryContext: MachShopCategoryContext | null = useMemo(() => {
    if (!isCategoryRoute) return null;
    const cms = category ? content.categories?.[category.id] : undefined;
    return {
      id: category?.id ?? "",
      // Server-resolved on the first paint; only ever empty for the moment
      // before an unresolved slug falls back to the client list.
      name: category?.name ?? "",
      slug: categorySlug,
      heading: cms?.heading || undefined,
      description: cms?.description || undefined,
    };
  }, [isCategoryRoute, category, categorySlug, content.categories]);

  const handleCategoryChange = useCallback((id: string | null) => {
    setActiveCategoryId(id);
    setPage(1);
  }, []);

  const handleSortChange = useCallback((value: string) => {
    setSort(value);
    setPage(1);
  }, []);

  const handlePageChange = useCallback((next: number) => {
    setPage(next);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  return (
    <SortingMachTemplate
      products={products}
      isLoading={isLoading}
      content={content}
      categoryContext={categoryContext}
      // A category page is already scoped, so it shows no group switcher.
      categories={isCategoryRoute ? [] : groupCategories}
      activeCategoryId={activeCategoryId}
      onCategoryChange={isCategoryRoute ? undefined : handleCategoryChange}
      searchValue={searchInput}
      onSearchChange={setSearchInput}
      sortValue={sort}
      onSortChange={handleSortChange}
      filtersOpen={filtersOpen}
      onToggleFilters={() => setFiltersOpen((v) => !v)}
      inStockOnly={inStockOnly}
      onInStockOnlyChange={(v) => {
        setInStockOnly(v);
        setPage(1);
      }}
      discountedOnly={discountedOnly}
      onDiscountedOnlyChange={(v) => {
        setDiscountedOnly(v);
        setPage(1);
      }}
      totalProducts={totalProducts}
      page={page}
      totalPages={totalPages}
      onPageChange={handlePageChange}
    />
  );
}
