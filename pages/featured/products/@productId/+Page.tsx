"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { navigate } from "vike/client/router";
import { trpc } from "#root/shared/trpc/client";
import { getTemplateComponent } from "#root/components/template-system/templateConfig";
import { useTemplate } from "#root/frontend/contexts/TemplateContext";
import { useLayoutSettings } from "#root/frontend/contexts/LayoutSettingsContext";
import { useCart } from "#root/lib/context/CartContext";
import { useTracking } from "#root/frontend/contexts/TrackingContext";
import { TrackingEventName } from "#root/shared/types/pixel-tracking";
import { STORE_CURRENCY, isSupplementStore } from "#root/shared/config/branding";
import type { ProductPageProduct } from "#root/components/template-system/productPage/ProductPageModernSplit";
import type { FeaturedProduct } from "#root/components/template-system/home/HomeFeaturedProducts";
import type { ProductPageEditorialContent } from "#root/components/template-system/productPage/ProductPageEditorial";
import type { ProductReviewItem } from "#root/components/template-system/mach/product/ProductReviews";

/** A group of products belonging to a single category type */
export interface CategoryProductGroup {
  categoryType: string;
  categoryName: string;
  categoryId: string;
  products: FeaturedProduct[];
}

/**
 * Maps the flat supplement label fields onto the product page's generic
 * `specifications` list. Only rows with a value are emitted, so a product with
 * no supplement information produces an empty array and the Specifications
 * accordion stays hidden exactly as it does today.
 */
function buildSpecifications(product: {
  sku?: string | null;
  supplementInfo?: {
    netWeight?: string;
    servingSize?: string;
    servingsPerContainer?: string;
  } | null;
}): { label: string; value: string }[] {
  const info = product.supplementInfo;
  const rows: { label: string; value: string }[] = [
    { label: "SKU", value: product.sku ?? "" },
    { label: "Net Weight", value: info?.netWeight ?? "" },
    { label: "Serving Size", value: info?.servingSize ?? "" },
    { label: "Servings Per Container", value: info?.servingsPerContainer ?? "" },
  ];
  return rows.filter((r) => r.value.trim().length > 0);
}

export default function ProductDetailPage() {
  const pageContext = usePageContext();
  const productId = pageContext.routeParams?.productId as string;
  const { getTemplateId } = useTemplate();
  const layoutSettings = useLayoutSettings();
  const { addItem, items } = useCart();
  const { trackEvent } = useTracking();
  const hasTrackedView = useRef<string | null>(null);

  const [productData, setProductData] = useState<ProductPageProduct | null>(
    null,
  );
  const [relatedProducts, setRelatedProducts] = useState<FeaturedProduct[]>([]);
  const [categoryGroups, setCategoryGroups] = useState<CategoryProductGroup[]>(
    [],
  );
  const [allProducts, setAllProducts] = useState<FeaturedProduct[]>([]);
  const [crossSellProducts, setCrossSellProducts] = useState<FeaturedProduct[]>(
    [],
  );
  const [reviews, setReviews] = useState<ProductReviewItem[]>([]);
  const [pageContent, setPageContent] = useState<ProductPageEditorialContent>(
    {},
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProductData = useCallback(async () => {
    if (!productId) {
      setError("Product ID is required");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Fetch product details
      const productResponse = await trpc.product.getById.query({ productId });

      if (!productResponse.success) {
        setError(productResponse.error || "Failed to fetch product");
        setIsLoading(false);
        return;
      }

      const product = productResponse.result;

      // Fetch reviews — use the resolved real product id, not the route
      // param, since that may be a slug and getReviews requires a UUID.
      const reviewsResponse = await trpc.product.getReviews.query({
        productId: product.id,
      });
      const reviewsData = reviewsResponse.success
        ? reviewsResponse.result
        : null;

      // ── Helpers ──
      const mapViewToFeatured = (items: any[]): FeaturedProduct[] =>
        items.map((rp: any) => ({
          id: rp.product.id,
          slug: rp.product.slug,
          name: rp.product.name,
          price: Number(rp.product.price),
          discountPrice: rp.product.discountPrice
            ? Number(rp.product.discountPrice)
            : null,
          imageUrl: rp.file?.diskname
            ? `/uploads/${rp.file.diskname}`
            : undefined,
          images: rp.file?.diskname
            ? [{ url: `/uploads/${rp.file.diskname}`, isPrimary: true }]
            : [],
          categoryName: rp.category?.name || "",
          stock: rp.product.stock || 0,
          available: (rp.product.stock || 0) > 0,
        }));

      const mapSearchToFeatured = (items: any[]): FeaturedProduct[] =>
        items.map((item: any) => ({
          id: item.id,
          slug: item.slug,
          name: item.name,
          price: Number(item.price),
          discountPrice: item.discountPrice ? Number(item.discountPrice) : null,
          imageUrl: item.imageUrl ? `/uploads/${item.imageUrl}` : undefined,
          images: item.imageUrl
            ? [{ url: `/uploads/${item.imageUrl}`, isPrimary: true }]
            : [],
          categoryName: item.categoryName || "",
          stock: item.stock || 0,
          available: (item.stock || 0) > 0,
          // `product.search` rows carry it; the backend's curated related /
          // add-on lists do not, and those cards then render without a
          // quick-add rather than assuming the product has no options.
          variantCount:
            typeof item.variantCount === "number" ? item.variantCount : undefined,
        }));

      // ── Fetch category groups (for inline carousels) ──
      const groups: CategoryProductGroup[] = [];
      try {
        const mainCats = await trpc.category.viewMain.query();
        if (mainCats.success && mainCats.result) {
          const cats = Array.isArray(mainCats.result) ? mainCats.result : [];
          // Fetch products for each main category in parallel
          const groupPromises = cats.map(async (cat: any) => {
            try {
              const res = await trpc.product.view.query({
                categoryId: cat.id,
                limit: 12,
              });
              if (res.success && res.result?.products?.length) {
                return {
                  categoryType: cat.type || cat.name,
                  categoryName: cat.name,
                  categoryId: cat.id,
                  products: mapViewToFeatured(res.result.products),
                };
              }
            } catch {
              /* skip */
            }
            return null;
          });
          const resolved = await Promise.all(groupPromises);
          for (const g of resolved) {
            if (g && g.products.length > 0) groups.push(g);
          }
        }
      } catch {
        /* ignore */
      }

      // ── Fetch ALL products for the bottom carousel ──
      let allProds: FeaturedProduct[] = [];
      try {
        const searchRes = await trpc.product.search.query({
          limit: 30,
          includeOutOfStock: false,
        });
        if (searchRes.success && searchRes.result?.items?.length) {
          allProds = mapSearchToFeatured(searchRes.result.items);
        }
      } catch {
        /* ignore */
      }

      // ── Related products ────────────────────────────────────────────
      // Priority: the admin's manually curated list (already resolved live and
      // in CMS order by the backend), otherwise other products sharing any of
      // this product's categories, queried server-side so deleted/hidden rows
      // are excluded. The current product is always filtered out.
      const curated = mapSearchToFeatured(
        (product.curatedRelatedProducts ?? []) as any[],
      );

      let mappedRelatedProducts: FeaturedProduct[] = curated;

      if (mappedRelatedProducts.length === 0) {
        const ownCategoryIds = (product.categories ?? [])
          .map((c: { id: string }) => c.id)
          .filter(Boolean);

        if (ownCategoryIds.length > 0) {
          try {
            const sameCat = await trpc.product.search.query({
              categoryIds: ownCategoryIds,
              limit: 12,
              includeOutOfStock: false,
            });
            if (sameCat.success && sameCat.result?.items?.length) {
              mappedRelatedProducts = mapSearchToFeatured(
                sameCat.result.items,
              ).filter((p) => p.id !== product.id);
            }
          } catch {
            /* fall through to the catalogue-wide list below */
          }
        }

        // Only if the category yields nothing at all do we widen, so the
        // section is never empty purely because of thin category data.
        if (mappedRelatedProducts.length === 0) {
          mappedRelatedProducts = allProds.filter((p) => p.id !== product.id);
        }
      }

      // Curated add-ons, resolved live by the backend from stored product IDs.
      const addOns = mapSearchToFeatured(
        (product.bestLayeredWith ?? []) as any[],
      );

      // Extract reviews and their statistics
      const reviewStats = {
        averageRating: reviewsData?.averageRating || 0,
        totalReviews: reviewsData?.totalReviews || 0,
      };

      // Map product data to ProductPageProduct interface
      const mappedProduct: ProductPageProduct = {
        id: product.id,
        slug: product.slug,
        name: product.name,
        price: Number(product.price),
        discountPrice: product.discountPrice
          ? Number(product.discountPrice)
          : null,
        stock: product.stock || 0,
        description: product.description ?? "No description available.",
        longDescription: product.supplementInfo?.longDescription || undefined,
        inspiredBy: product.inspiredBy || undefined,
        imageUrl: product.images?.[0]?.url ?? undefined,
        images: product.images ?? [],
        categoryName: product.categoryName ?? null,
        features: [],
        // Simple key/value label data reuses the Editorial template's existing
        // Specifications accordion. Supplement Facts is deliberately NOT
        // flattened in here — it needs three columns plus indentation, which
        // this two-column {label,value} shape cannot represent. It stays
        // stored on the product until its own panel is built.
        specifications: buildSpecifications(product),
        available: (product.stock || 0) > 0,
        rating: reviewStats.averageRating,
        reviewCount: reviewStats.totalReviews,
        variants: product.variants ?? [],
        fragranceInfo: product.fragranceInfo ?? null,
        supplementInfo: product.supplementInfo ?? null,
        bestLayeredWith: product.bestLayeredWith ?? [],
      };

      setProductData(mappedProduct);
      setRelatedProducts(mappedRelatedProducts);
      setCrossSellProducts(addOns);
      setReviews((reviewsData?.reviews ?? []) as ProductReviewItem[]);
      setCategoryGroups(groups);
      setAllProducts(allProds);
      setIsLoading(false);
      setError(null);

      // Fire product_viewed event once per product
      if (hasTrackedView.current !== productId) {
        hasTrackedView.current = productId;
        trackEvent(TrackingEventName.PRODUCT_VIEWED, {
          ecommerce: {
            currency: STORE_CURRENCY,
            value: Number(mappedProduct.discountPrice ?? mappedProduct.price),
            items: [
              {
                itemId: mappedProduct.id,
                itemName: mappedProduct.name,
                price: Number(
                  mappedProduct.discountPrice ?? mappedProduct.price,
                ),
                category: mappedProduct.categoryName ?? undefined,
              },
            ],
          },
        });
      }
    } catch (err) {
      console.error("Error fetching product data:", err);
      setError("Failed to load product data");
      setIsLoading(false);
    }
  }, [productId, trackEvent]);

  useEffect(() => {
    fetchProductData();
  }, [fetchProductData]);

  // Store-wide product-page copy (headings, shipping & returns). Client-owned
  // in store settings — nothing visible here is hard-coded in the template.
  useEffect(() => {
    let cancelled = false;
    trpc.settings.getProductPageContent
      .query()
      .then((res) => {
        if (cancelled || !res.success || !res.result) return;
        const c = res.result;
        setPageContent({
          shippingText: c.shippingText,
          returnsText: c.returnsText,
          crossSellHeading: c.crossSellHeading,
          relatedProductsHeading: c.relatedProductsHeading,
          detailsSectionHeading: c.detailsSectionHeading,
          shippingSectionHeading: c.shippingSectionHeading,
        });
      })
      .catch(() => {
        /* copy is an enhancement — never block the page */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A supplement store always honours the Product Page template chosen in the
  // admin. The navbar-style override below is a legacy pairing that lets a
  // header setting silently reassign the whole product template — and the
  // template it forces (product-minimal) renders fragrance-specific content.
  // Legacy non-supplement deployments keep the old behaviour unchanged.
  const isMinimal =
    !isSupplementStore() && layoutSettings.header.navbarStyle === "minimal";
  const activeTemplateId = isMinimal
    ? "product-minimal"
    : (getTemplateId("productPage") ?? "product-perce");
  const TemplateEntry = getTemplateComponent("productPage", activeTemplateId);

  if (!TemplateEntry) {
    return <div>Product page template not found.</div>;
  }

  /**
   * Single add-to-cart path shared by Add to Cart and Buy It Now.
   *
   * Quantity comes from the product page's selector; `addItem` performs the
   * stock check and returns false when it cannot satisfy the request, so both
   * buttons respect stock identically. Variant selections are passed straight
   * through as the cart line's options.
   */
  const addProductToCart = (
    product: ProductPageProduct,
    selectedOptions?: Record<string, string>,
    quantity?: number,
  ): boolean => {
    const qty = Math.max(1, Math.floor(Number(quantity) || 1));
    const unitPrice = Number(product.discountPrice ?? product.price);

    const success = addItem(
      {
        id: product.id,
        name: product.name,
        price: unitPrice,
        stock: product.stock,
        imageUrl: product.imageUrl,
        categoryName: product.categoryName ?? undefined,
        available: product.available,
      },
      qty,
      selectedOptions || {},
    );

    if (success) {
      trackEvent(TrackingEventName.PRODUCT_ADDED_TO_CART, {
        ecommerce: {
          currency: STORE_CURRENCY,
          value: unitPrice * qty,
          items: [
            {
              itemId: product.id,
              itemName: product.name,
              price: unitPrice,
              quantity: qty,
              category: product.categoryName ?? undefined,
            },
          ],
        },
      });
    }

    return success;
  };

  const Template = TemplateEntry.component;

  if (error) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='text-center'>
          <h2 className='text-2xl font-bold text-red-600 mb-2'>Error</h2>
          <p className='text-gray-600'>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <Template
      product={productData ?? undefined}
      relatedProducts={relatedProducts}
      categoryGroups={categoryGroups}
      allProducts={allProducts}
      isLoading={isLoading}
      crossSellProducts={crossSellProducts}
      reviews={reviews}
      content={pageContent}
      onAddToCart={(
        product: ProductPageProduct,
        selectedOptions?: Record<string, string>,
        quantity?: number,
      ) =>
        // Returned so a template can confirm only a real add — `addItem`
        // answers false when stock cannot cover the request.
        addProductToCart(product, selectedOptions, quantity)
      }
      onBuyNow={(
        product: ProductPageProduct,
        selectedOptions?: Record<string, string>,
        quantity?: number,
      ) => {
        // Reuses the same cart mechanism (stock checks, variant keying and
        // quantity merging all included), then hands off to the existing
        // checkout route — no parallel checkout path.
        if (addProductToCart(product, selectedOptions, quantity)) {
          navigate("/checkout");
        }
      }}
      onAddToWishlist={(product: ProductPageProduct) =>
        console.log("Add to wishlist", product.id)
      }
      onImageClick={(url: string, index: number) =>
        console.log("Image clicked:", url, index)
      }
    />
  );
}
