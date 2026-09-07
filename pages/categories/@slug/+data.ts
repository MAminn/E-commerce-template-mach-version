import type { PageContext } from "vike/types";
import { getShopContent } from "#root/backend/shop-content/service";
import {
  getCategoryBySlugRaw,
  type CategoryBySlug,
} from "#root/backend/categories/get-category-by-slug/raw";
import {
  DEFAULT_SHOP_CONTENT,
  type ShopContent,
} from "#root/shared/types/shop-content";
import { getStoreOwnerId } from "#root/shared/config/store";

export type Data = {
  shopContent: ShopContent;
  /** Null for an unknown slug — the page falls back to client resolution. */
  category: CategoryBySlug | null;
};

/**
 * Resolves both the shop CMS content and the category itself during SSR, so the
 * first paint already carries the category heading and breadcrumb rather than
 * filling them in after hydration.
 *
 * Both lookups are best-effort: a failure returns defaults/null and the page
 * behaves exactly as it did before, resolving the category from the client-side
 * category list.
 */
export const data = async (ctx: PageContext): Promise<Data> => {
  const slug = (ctx.routeParams?.slug as string | undefined) ?? "";

  const [shopContent, category] = await Promise.all([
    getShopContent(getStoreOwnerId(), ctx.db).catch(
      () => DEFAULT_SHOP_CONTENT,
    ),
    getCategoryBySlugRaw(ctx.db, slug),
  ]);

  return { shopContent, category };
};
