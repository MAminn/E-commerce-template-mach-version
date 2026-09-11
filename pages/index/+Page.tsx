import React, { useState, useEffect, useMemo, useRef } from "react";
import { trpc } from "#root/shared/trpc/client";
import { getStoreOwnerId } from "#root/shared/config/store";
import { getTemplateComponent } from "#root/components/template-system";
import { useTemplate } from "#root/frontend/contexts/TemplateContext";
import type { LandingTemplateModernProps } from "#root/components/template-system";
import type { LandingTemplateMachProps } from "#root/components/template-system/landing/LandingTemplateMach";
import type { HomepageContent } from "#root/shared/types/homepage-content";
import type { CategoryRecord } from "#root/shared/types/homepage-group-sections";
import {
  broadGroupsFor,
  resolveGroupSections,
} from "#root/shared/types/homepage-group-sections";
import {
  mapSearchItem,
  orderByCmsSelection,
  useHomepageGroupProducts,
} from "./homepage-products";
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
  // The unfiltered category list, kept alongside the tile band's own mapping
  // because the broad-group rule needs `showOnLanding` and `deleted` to apply
  // itself — the band's list has already had them applied and thrown away.
  const [allCategories, setAllCategories] = useState<CategoryRecord[]>([]);
  const [featuredShelf, setFeaturedShelf] = useState<FeaturedProduct[]>([]);
  const [newArrivals, setNewArrivals] = useState<NewArrivalProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [newArrivalsLoading, setNewArrivalsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { getTemplateId, isLoading: isTemplateLoading } = useTemplate();

  /**
   * The store's broad groups and the sections that merchandise them.
   *
   * Derived, never stored: the categories decide which sections exist and the
   * CMS decides how each one is configured, so a group the client opened this
   * morning has a section here without anything being deployed, and a group
   * they deleted stops having one.
   */
  const groupSections = useMemo(
    () =>
      resolveGroupSections(
        homepageContent,
        broadGroupsFor(homepageContent, allCategories),
      ),
    [homepageContent, allCategories],
  );

  // One hook for every group, rather than one hook per group — the number of
  // groups is the client's to change, and a hook called inside a map over them
  // would break the moment they did.
  const groupProducts = useHomepageGroupProducts(groupSections);

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
          setAllCategories(
            (categoriesResult.result as any[]).map((cat) => ({
              id: cat.id,
              name: cat.name,
              slug: cat.slug,
              showOnLanding: cat.showOnLanding,
              deleted: cat.deleted,
            })),
          );

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

  // ───────────────────────────────────────────────────
  // Fetch the Featured shelf.
  //
  // Hand-picked only, and that is the whole definition of the section: with
  // nothing selected there is no query to issue and the row renders nothing,
  // rather than falling back to a ranking that would just repeat Best Sellers
  // under a different heading.
  // ───────────────────────────────────────────────────
  const featuredShelfIdsKey = (
    homepageContent.featuredShelf?.productIds ?? []
  ).join(",");

  useEffect(() => {
    if (!featuredShelfIdsKey) {
      setFeaturedShelf([]);
      return;
    }

    let cancelled = false;
    const productIds = featuredShelfIdsKey.split(",");

    trpc.product.search
      .query({
        limit: productIds.length,
        includeOutOfStock: true,
        productIds,
      })
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.result) {
          setFeaturedShelf(
            orderByCmsSelection(
              result.result.items.map(mapSearchItem),
              productIds,
            ),
          );
        } else {
          setFeaturedShelf([]);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error loading featured shelf:", err);
        setFeaturedShelf([]);
      });

    return () => {
      cancelled = true;
    };
  }, [featuredShelfIdsKey]);

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
    featuredShelf,
    groupSections,
    groupProducts,
    onCtaClick: (link: string) => {
      window.location.href = link;
    },
  };

  return <Template {...templateProps} />;
}
