import { useEffect, useMemo, useState } from "react";
import { trpc } from "#root/shared/trpc/client";
import type { ResolvedGroupSection } from "#root/shared/types/homepage-group-sections";

/**
 * Product fetching shared by the homepage's merchandising sections.
 *
 * One mapping function and one ordering function, so image-path rules, price
 * coercion and "respect the client's chosen sequence" cannot drift between the
 * rows — and one hook for the broad group sections, which are no longer a
 * fixed pair the page can call a hook for individually.
 */

/**
 * Normalises one `product.search` row into the shape the landing templates
 * consume.
 *
 * Return type is inferred on purpose: it narrows `discountPrice` to
 * `number | null`, which satisfies both FeaturedProduct and NewArrivalProduct.
 * Annotating it as FeaturedProduct would re-widen the field to
 * `string | number` and break the new-arrivals setter.
 */
export function mapSearchItem(item: {
  id: string;
  slug?: string | null;
  name: string;
  price: string | number;
  discountPrice?: string | number | null;
  stock: number;
  imageUrl?: string | null;
  images?: { url: string; isPrimary?: boolean }[];
  categoryName?: string | null;
  categories?: { id: string; name: string }[];
  variantCount?: number;
}) {
  return {
    id: item.id,
    slug: item.slug,
    name: item.name,
    price: Number(item.price),
    discountPrice: item.discountPrice != null ? Number(item.discountPrice) : null,
    stock: item.stock,
    imageUrl: item.imageUrl
      ? item.imageUrl.startsWith("http")
        ? item.imageUrl
        : `/uploads/${item.imageUrl}`
      : undefined,
    images: item.images,
    categoryName: item.categoryName || "",
    categories: item.categories,
    available: item.stock > 0,
    // Left undefined when the row predates the field, so a card that can't
    // establish the option state offers no quick-add rather than guessing.
    variantCount:
      typeof item.variantCount === "number" ? item.variantCount : undefined,
  };
}

export type MappedProduct = ReturnType<typeof mapSearchItem>;

/**
 * Re-orders fetched products to match the sequence the client picked in the
 * CMS.
 *
 * `product.search` returns rows in its own order, so without this the "select
 * products, in this order" control in Homepage Admin would silently only
 * control *which* products appear, not their sequence. Products that no longer
 * exist simply drop out.
 */
export function orderByCmsSelection<T extends { id: string }>(
  items: T[],
  selectedIds: string[] | undefined,
): T[] {
  if (!selectedIds || selectedIds.length === 0) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  return selectedIds
    .map((id) => byId.get(id))
    .filter((item): item is T => Boolean(item));
}

/** The `product.search` input for a hand-curated merchandising shelf. */
export interface CuratedSectionRequest {
  limit: number;
  includeOutOfStock: boolean;
  productIds: string[];
}

/**
 * The query a curated merchandising section needs, or `null` for no query.
 *
 * Best Sellers, New Drops, Featured and Offers are lists the client chose. On
 * Mach all four are curated outright, which makes the empty case the important
 * one: each used to fall back to a catalogue query — a general product search,
 * `sortBy: "newest"`, `discountedOnly: true` — so a section the client had not
 * filled in quietly populated itself, and clearing a selection put the
 * fallback back on the page rather than taking the section off it.
 *
 * Returning `null` rather than an empty query is the whole point: there is no
 * request to issue for a section nobody has picked products for, and the row
 * renders nothing.
 *
 * `includeOutOfStock` stays per-section, matching what each shelf already did.
 */
export function buildCuratedSectionRequest(
  productIds: string[] | undefined,
  includeOutOfStock: boolean,
): CuratedSectionRequest | null {
  const ids = (productIds ?? []).filter(Boolean);
  if (ids.length === 0) return null;
  return { limit: ids.length, includeOutOfStock, productIds: ids };
}

/** What one group section resolved to at runtime. */
export interface GroupProductsState {
  products: MappedProduct[];
  isLoading: boolean;
  error: string | null;
}

const EMPTY_GROUP: GroupProductsState = {
  products: [],
  isLoading: false,
  error: null,
};

/** A group section reduced to the query it needs, and nothing else. */
export interface GroupRequest {
  categoryId: string;
  limit: number;
}

/**
 * The queries an enabled set of group sections needs.
 *
 * Pure, and exported, so what the homepage actually asks the database for can
 * be asserted directly rather than inferred from a mock.
 */
export function buildGroupProductRequests(
  sections: readonly ResolvedGroupSection[],
): GroupRequest[] {
  return sections
    .filter((s) => s.enabled)
    .map((s) => ({ categoryId: s.category.id, limit: s.limit }));
}

/**
 * The exact `product.search` input for one group.
 *
 * A group section is its category, so this is the whole query: the category,
 * and how much of it to show. There is no manual-selection branch — a group
 * that could be pinned to a list of product ids would quietly stop showing new
 * products the moment the client added one to the category, and they would
 * have to come back here to publish something they had already published.
 * Curating a list is what Featured is for.
 */
export function groupSearchInput(request: GroupRequest) {
  return {
    limit: request.limit,
    includeOutOfStock: true,
    categoryIds: [request.categoryId],
  };
}

/**
 * Loads the products for every enabled broad group section.
 *
 * The homepage used to call a hook per group, once for Stacks and once for Gym
 * Gear. That does not survive groups being dynamic: the obvious fix — calling
 * the hook inside `.map()` over the sections — breaks the rules of hooks the
 * first time the client adds or removes a group, because the number of hooks
 * on a render would change. So there is one hook and one effect here, holding
 * a result per category id.
 *
 * Every group is filled from its own category, through the same
 * `product.search` procedure every other row uses, so a product added to the
 * category in Dashboard → Products appears on the homepage without anyone
 * opening Homepage Admin. A disabled group is never queried.
 */
export function useHomepageGroupProducts(
  sections: readonly ResolvedGroupSection[],
): Record<string, GroupProductsState> {
  const [byCategory, setByCategory] = useState<
    Record<string, GroupProductsState>
  >({});

  // Serialised so the effect re-runs on a changed configuration rather than on
  // a new array identity from the CMS content object — which is rebuilt on
  // every content fetch and would otherwise re-query the whole page.
  const requestKey = useMemo(
    () =>
      JSON.stringify(buildGroupProductRequests(sections)),
    [sections],
  );

  useEffect(() => {
    const requests: GroupRequest[] = JSON.parse(requestKey);

    if (requests.length === 0) {
      // Replace rather than merge: a group switched off or removed must not
      // leave its last result behind for the renderer to find.
      setByCategory({});
      return;
    }

    let cancelled = false;

    setByCategory((prev) => {
      const next: Record<string, GroupProductsState> = {};
      for (const request of requests) {
        // Keep whatever a group already has while it refetches, so an edit to
        // one group does not blank the others mid-flight.
        next[request.categoryId] = {
          ...(prev[request.categoryId] ?? EMPTY_GROUP),
          isLoading: true,
          error: null,
        };
      }
      return next;
    });

    Promise.all(
      requests.map(async (request): Promise<[string, GroupProductsState]> => {
        try {
          const res = await trpc.product.search.query(
            groupSearchInput(request),
          );
          const items =
            res.success && res.result
              ? res.result.items.map(mapSearchItem)
              : [];
          return [
            request.categoryId,
            { products: items, isLoading: false, error: null },
          ];
        } catch (err) {
          console.error("Error loading group section products:", err);
          return [
            request.categoryId,
            {
              products: [],
              isLoading: false,
              error: err instanceof Error ? err.message : "Request failed",
            },
          ];
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setByCategory(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  return byCategory;
}
