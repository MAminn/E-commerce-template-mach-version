import React, { useState, useEffect, useRef } from "react";
import { trpc } from "#root/shared/trpc/client";
import { getStoreOwnerId } from "#root/shared/config/store";
import { getTemplateComponent } from "#root/components/template-system";
import { useTemplate } from "#root/frontend/contexts/TemplateContext";
import type { LandingTemplateModernProps } from "#root/components/template-system";
import type { LandingTemplateMachProps } from "#root/components/template-system/landing/LandingTemplateMach";
import type {
  HomepageContent,
  HomepageProductGroupContent,
} from "#root/shared/types/homepage-content";
import type { CategoryStripItem } from "#root/components/shop/CategoryStrip";
import type { NewArrivalProduct } from "#root/components/shop/NewArrivals";
import { useData } from "vike-react/useData";
import type { Data } from "./+data";

export { Page };

interface FeaturedProduct {
  id: string;
  slug?: string | null;
  name: string;
  price: number;
  discountPrice?: number | string | null;
  stock: number;
  imageUrl?: string;
  images?: { url: string; isPrimary?: boolean }[];
  categoryName: string;
  available: boolean;
  categories?: { id: string; name: string }[];
}

/**
 * Re-orders fetched products to match the sequence the client picked in the
 * CMS.
 *
 * `product.search` returns rows in its own order, so without this the "select
 * products, in this order" control in Homepage Admin would silently only
 * control *which* products appear, not their sequence. Products that no longer
 * exist simply drop out.
 */
/**
 * Normalises one `product.search` row into the shape the landing templates
 * consume. Shared by all three merchandising rows so image-path and
 * price-coercion rules can't drift between them.
 */
function mapSearchItem(item: {
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
  // Return type is inferred on purpose: it narrows `discountPrice` to
  // `number | null`, which satisfies both FeaturedProduct and
  // NewArrivalProduct. Annotating it as FeaturedProduct would re-widen the
  // field to `string | number` and break the new-arrivals setter.
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

function orderByCmsSelection<T extends { id: string }>(
  items: T[],
  selectedIds: string[] | undefined,
): T[] {
  if (!selectedIds || selectedIds.length === 0) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  return selectedIds
    .map((id) => byId.get(id))
    .filter((item): item is T => Boolean(item));
}

/**
 * Resolves one broad merchandising group (Stacks & Bundles, Gym Gear) into
 * live products.
 *
 * The group is filled from the client's explicit product selection when there
 * is one, otherwise from the broad category (or categories) they pointed the
 * section at. With neither configured there is nothing to ask the database
 * for, so no query is issued and the section renders nothing — which is the
 * correct state while the catalog is still being populated.
 *
 * Uses the same `product.search` procedure every other row uses; there is no
 * second product query implementation and no hard-coded product anywhere.
 */
function useProductGroup(group: HomepageProductGroupContent | undefined) {
  const [products, setProducts] = useState<FeaturedProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const productIds = group?.productIds;
  const categoryIds = group?.categoryIds;
  const limit = group?.limit ?? 4;
  const enabled = group?.enabled ?? false;

  // Serialised so the effect re-runs on a changed selection, not a new array
  // identity from the CMS content object.
  const productKey = (productIds ?? []).join(",");
  const categoryKey = (categoryIds ?? []).join(",");

  useEffect(() => {
    const hasProducts = productKey.length > 0;
    const hasCategories = categoryKey.length > 0;

    if (!enabled || (!hasProducts && !hasCategories)) {
      setProducts([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const selectedProductIds = hasProducts ? productKey.split(",") : undefined;

    trpc.product.search
      .query({
        limit: hasProducts ? selectedProductIds!.length : limit,
        includeOutOfStock: true,
        productIds: selectedProductIds,
        categoryIds:
          !hasProducts && hasCategories ? categoryKey.split(",") : undefined,
      })
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.result) {
          setProducts(
            orderByCmsSelection(
              res.result.items.map(mapSearchItem),
              selectedProductIds,
            ),
          );
        } else {
          setProducts([]);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error loading product group:", err);
        setProducts([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, productKey, categoryKey, limit]);

  return { products, isLoading };
}

function Page() {
  // SSR-provided CMS content — no flash of defaults
  const ssrData = useData<Data>();

  const [featuredProducts, setFeaturedProducts] = useState<FeaturedProduct[]>(
    [],
  );
  const [discountedProducts, setDiscountedProducts] = useState<FeaturedProduct[]>(
    [],
  );
  const [homepageContent, setHomepageContent] = useState<HomepageContent>(
    ssrData.homepageContent,
  );
  const [categories, setCategories] = useState<CategoryStripItem[]>([]);
  const [newArrivals, setNewArrivals] = useState<NewArrivalProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [newArrivalsLoading, setNewArrivalsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { getTemplateId, isLoading: isTemplateLoading } = useTemplate();

  // Broad merchandising groups. Both resolve through the shared hook above, so
  // "Stacks & Bundles" and "Gym Gear" behave identically and neither knows a
  // product name or id.
  const stacks = useProductGroup(homepageContent.stacks);
  const gymGear = useProductGroup(homepageContent.gymGear);

  // Resolve the active landing template ID early so we can use it for content fetching
  const activeLandingTemplateId = getTemplateId("landing") ?? "landing-modern";

  // Track which template ID the CMS content was fetched for.
  // Starts with the SSR template so we skip the redundant initial fetch.
  const lastFetchedTemplateRef = useRef(ssrData.ssrTemplateId);

  // ───────────────────────────────────────────────────
  // Fetch featured products (always client-side — dynamic data)
  // ───────────────────────────────────────────────────
  useEffect(() => {
    const fetchProducts = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const searchParams: Record<string, any> = {
          limit: 8,
          includeOutOfStock: false,
        };
        // Use manually selected product IDs from CMS if configured
        const featuredIds = homepageContent.featuredProducts?.productIds;
        if (featuredIds && featuredIds.length > 0) {
          searchParams.productIds = featuredIds;
        }
        const productsResult = await trpc.product.search.query(searchParams);

        if (productsResult.success && productsResult.result) {
          setFeaturedProducts(
            orderByCmsSelection(
              productsResult.result.items.map(mapSearchItem),
              featuredIds ?? undefined,
            ),
          );
        }
      } catch (err) {
        setError("Error loading homepage data");
        console.error("Error loading homepage data:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProducts();
  }, [homepageContent.featuredProducts?.productIds]);

  // ───────────────────────────────────────────────────
  // Re-fetch CMS content only when the active template changes
  // client-side (e.g. admin switches template). SSR already
  // provided the initial content so we skip the first fetch.
  // ───────────────────────────────────────────────────
  useEffect(() => {
    // Skip if the active template matches what SSR (or our last fetch) provided
    if (activeLandingTemplateId === lastFetchedTemplateRef.current) return;

    let cancelled = false;
    const merchantId = getStoreOwnerId();

    trpc.homepage.getContent
      .query({ merchantId, templateId: activeLandingTemplateId })
      .then((contentResult) => {
        if (cancelled) return;
        if (contentResult.success && contentResult.result) {
          setHomepageContent(contentResult.result);
        }
        lastFetchedTemplateRef.current = activeLandingTemplateId;
      })
      .catch((err) => {
        if (!cancelled) console.warn("Using default homepage content:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [activeLandingTemplateId]);

  // Fetch categories separately (parallel loading)
  useEffect(() => {
    const fetchCategories = async () => {
      setCategoriesLoading(true);
      try {
        const categoriesResult = await trpc.category.view.query();

        if (categoriesResult.success && categoriesResult.result) {
          // When the client has picked categories in the CMS, that selection
          // wins outright — including over `showOnLanding`, which is the
          // fallback rule for merchants who never open Homepage Admin. The
          // template applies the selection and its ordering; the category
          // system stays authoritative for each category's own name, slug and
          // artwork either way.
          const hasCmsSelection =
            (homepageContent.categories?.categoryIds?.length ?? 0) > 0;

          const mappedCategories: CategoryStripItem[] = categoriesResult.result
            .filter(
              (cat: any) =>
                !cat.deleted && (hasCmsSelection || cat.showOnLanding !== false),
            )
            .map((cat: any) => ({
              id: cat.id,
              name: cat.name,
              slug: cat.slug,
              imageUrl: cat.filename || null,
            }));

          setCategories(mappedCategories);
        }
      } catch (err) {
        console.error("Error loading categories:", err);
        // Continue without categories
      } finally {
        setCategoriesLoading(false);
      }
    };

    fetchCategories();
  }, [homepageContent.categories?.categoryIds]);

  // Fetch new arrivals (newest products, parallel loading)
  useEffect(() => {
    const fetchNewArrivals = async () => {
      setNewArrivalsLoading(true);
      try {
        const searchParams: Record<string, any> = {
          limit: 8,
          sortBy: "newest" as const,
          includeOutOfStock: true,
        };
        // Use manually selected product IDs from CMS if configured
        const newArrivalIds = homepageContent.newArrivals?.productIds;
        if (newArrivalIds && newArrivalIds.length > 0) {
          searchParams.productIds = newArrivalIds;
        }
        const result = await trpc.product.search.query(searchParams);

        if (result.success && result.result) {
          setNewArrivals(
            orderByCmsSelection(
              result.result.items.map(mapSearchItem),
              newArrivalIds ?? undefined,
            ),
          );
        }
      } catch (err) {
        console.error("Error loading new arrivals:", err);
      } finally {
        setNewArrivalsLoading(false);
      }
    };

    fetchNewArrivals();
  }, [homepageContent.newArrivals?.productIds]);

  // Fetch discounted products (products with discountPrice < price)
  useEffect(() => {
    const fetchDiscounted = async () => {
      try {
        const searchParams: Record<string, any> = {
          limit: 8,
          discountedOnly: true,
          includeOutOfStock: false,
        };
        // Use manually selected product IDs from CMS if configured
        const discountedIds = homepageContent.discountedProducts?.productIds;
        if (discountedIds && discountedIds.length > 0) {
          searchParams.productIds = discountedIds;
        }
        const result = await trpc.product.search.query(searchParams);

        if (result.success && result.result) {
          setDiscountedProducts(
            orderByCmsSelection(
              result.result.items.map(mapSearchItem),
              discountedIds ?? undefined,
            ),
          );
        }
      } catch (err) {
        console.error("Error loading discounted products:", err);
      }
    };

    fetchDiscounted();
  }, [homepageContent.discountedProducts?.productIds]);

  // Get the selected landing template
  const templateEntry = getTemplateComponent("landing", activeLandingTemplateId);

  // Wait for template selection to resolve from DB before rendering
  // This prevents flickering between the default and active template
  if (isTemplateLoading) {
    return null;
  }

  if (!templateEntry) {
    return <div>Error: Landing page template not found.</div>;
  }

  const Template = templateEntry.component;

  // One prop bag serves every landing template — each one reads the props it
  // understands and ignores the rest.
  const templateProps: LandingTemplateModernProps & LandingTemplateMachProps = {
    content: homepageContent,
    featuredProducts,
    discountedProducts,
    categories,
    categoriesLoading,
    newArrivals,
    newArrivalsLoading,
    stacksProducts: stacks.products,
    stacksLoading: stacks.isLoading,
    gymGearProducts: gymGear.products,
    gymGearLoading: gymGear.isLoading,
    onCtaClick: (link: string) => {
      window.location.href = link;
    },
  };

  return <Template {...templateProps} />;
}
