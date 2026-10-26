import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { query } from "#root/shared/database/drizzle/db";
import {
  file,
  product,
  storeSettings,
} from "#root/shared/database/drizzle/schema";
import { ServerError } from "#root/shared/error/server";
import {
  normalizeLandingPageSettings,
  orderBySelection,
  validateLandingPageSettings,
  type LandingPageSettings,
} from "#root/shared/landing-page/config";
import { searchProducts } from "#root/backend/products/search-products/service";

/**
 * The fixed /landing-2 page's content, in `store_settings.landing_page_config`.
 * Mirrors backend/whatsapp/service.ts. There is one row and one page; nothing
 * here creates or names pages.
 */

export const getLandingPageSettings = () =>
  Effect.gen(function* ($) {
    const rows = yield* $(
      query(async (db) =>
        db
          .select({ landingPageConfig: storeSettings.landingPageConfig })
          .from(storeSettings)
          .where(eq(storeSettings.key, "default"))
          .limit(1),
      ),
    );
    return normalizeLandingPageSettings(rows[0]?.landingPageConfig);
  });

/** What the dashboard lists for each selected id, including ones gone stale. */
export interface LandingSelectedProduct {
  id: string;
  name: string;
  price: string;
  discountPrice: string | null;
  stock: number;
  imageUrl: string | null;
  /** Hidden from the storefront — the page skips it until it is shown again. */
  hidden: boolean;
}

/**
 * Catalogue rows for the selected ids, straight from `product`, so a product
 * hidden since it was picked still shows up in the editor (flagged) instead of
 * silently vanishing from the list. Deleted ids are omitted; the editor marks
 * them as missing.
 */
const getSelectedProducts = (ids: readonly string[]) =>
  query(async (db) => {
    if (ids.length === 0) return [];
    const rows = await db
      .select({
        id: product.id,
        name: product.name,
        price: product.price,
        discountPrice: product.discountPrice,
        stock: product.stock,
        imageUrl: file.diskname,
        hidden: product.hidden,
        deleted: product.deleted,
      })
      .from(product)
      .leftJoin(file, eq(product.imageId, file.id))
      .where(inArray(product.id, [...ids]));
    return orderBySelection(
      rows.filter((r) => !r.deleted),
      ids,
    ).map(
      ({ deleted: _deleted, ...row }): LandingSelectedProduct => ({
        ...row,
        hidden: row.hidden ?? false,
      }),
    );
  });

/** Dashboard read: the settings plus a status line for every picked product. */
export const getLandingPageEditorState = () =>
  Effect.gen(function* ($) {
    const settings = yield* $(getLandingPageSettings());
    const selectedProducts = yield* $(getSelectedProducts(settings.productIds));
    return { settings, selectedProducts };
  });

export const updateLandingPageSettings = (input: LandingPageSettings) =>
  Effect.gen(function* ($) {
    const validation = validateLandingPageSettings(input);
    if (!validation.ok) {
      const firstError = Object.values(validation.errors)[0];
      return yield* $(
        Effect.fail(
          new ServerError({
            tag: "InvalidLandingPageSettings",
            statusCode: 400,
            clientMessage: firstError ?? "Invalid landing page settings",
          }),
        ),
      );
    }
    const config = validation.settings;

    // Only real, undeleted catalogue products may be referenced. Hidden ones
    // are allowed — they were valid when picked and come back on their own if
    // the product is shown again.
    const known = yield* $(getSelectedProducts(config.productIds));
    if (known.length !== config.productIds.length) {
      return yield* $(
        Effect.fail(
          new ServerError({
            tag: "UnknownLandingPageProducts",
            statusCode: 400,
            clientMessage:
              "Some selected products no longer exist. Remove them and save again.",
          }),
        ),
      );
    }

    const updated = yield* $(
      query(async (db) =>
        db
          .update(storeSettings)
          .set({ landingPageConfig: config, updatedAt: new Date() })
          .where(eq(storeSettings.key, "default"))
          .returning({ landingPageConfig: storeSettings.landingPageConfig }),
      ),
    );
    const [row] = updated;
    if (row) {
      return normalizeLandingPageSettings(row.landingPageConfig);
    }

    // No settings row yet (fresh install) — create it carrying just this config.
    const inserted = yield* $(
      query(async (db) =>
        db
          .insert(storeSettings)
          .values({ key: "default", landingPageConfig: config })
          .returning({ landingPageConfig: storeSettings.landingPageConfig }),
      ),
    );
    if (!inserted[0]) {
      return yield* $(
        Effect.fail(
          new ServerError({
            tag: "FailedToUpdateLandingPageSettings",
            statusCode: 500,
            clientMessage: "Failed to save the landing page",
          }),
        ),
      );
    }
    return normalizeLandingPageSettings(inserted[0].landingPageConfig);
  });

/**
 * The public page: settings plus the selected products as the storefront's
 * own catalogue query returns them (deleted and hidden rows excluded, live
 * price/discount/stock/images), in the media buyer's order.
 *
 * Out-of-stock products stay in — the card shows them as sold out rather than
 * the page quietly reshuffling.
 */
export const getLandingPageView = () =>
  Effect.gen(function* ($) {
    const settings = yield* $(getLandingPageSettings());
    if (settings.productIds.length === 0) {
      return { settings, products: [] };
    }
    const found = yield* $(
      searchProducts({
        productIds: settings.productIds,
        limit: settings.productIds.length,
        offset: 0,
        includeOutOfStock: true,
      }),
    );
    return {
      settings,
      products: orderBySelection(found.items, settings.productIds),
    };
  });
