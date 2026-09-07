import { query } from "#root/shared/database/drizzle/db";
import { storeSettings } from "#root/shared/database/drizzle/schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

/**
 * Global, client-editable copy for the product page.
 *
 * Lives in the existing `store_settings.product_page_content` JSONB column, so
 * new headings can be added without a migration. Nothing here is per-product:
 * it is store-wide content the client owns, so no product-page copy needs to
 * be hard-coded in a React component.
 */
export type ProductPageContent = {
  shippingText?: string;
  shippingTextAr?: string;
  returnsText?: string;
  returnsTextAr?: string;
  faqs?: Array<{ question: string; questionAr?: string; answer: string; answerAr?: string }>;
  /** Heading above the curated add-ons strip, e.g. "Make Every Scoop Easier". */
  crossSellHeading?: string;
  crossSellHeadingAr?: string;
  /** Heading above the related-products grid, e.g. "Shop the Full Collection". */
  relatedProductsHeading?: string;
  relatedProductsHeadingAr?: string;
  /** Heading above the supplement/product details panel, e.g. "Details". */
  detailsSectionHeading?: string;
  detailsSectionHeadingAr?: string;
  /** Heading for the shipping & returns accordion. */
  shippingSectionHeading?: string;
  shippingSectionHeadingAr?: string;
};

/**
 * Get the admin-controlled Shipping / Returns / FAQs text shown on the
 * product page. Returns an empty object if nothing has been configured yet
 * (the product page falls back to its own defaults in that case).
 */
export const getProductPageContent = () =>
  Effect.gen(function* ($) {
    const rows = yield* $(
      query(async (db) =>
        db
          .select({ productPageContent: storeSettings.productPageContent })
          .from(storeSettings)
          .where(eq(storeSettings.key, "default"))
          .limit(1),
      ),
    );

    return (rows[0]?.productPageContent ?? {}) as ProductPageContent;
  });
