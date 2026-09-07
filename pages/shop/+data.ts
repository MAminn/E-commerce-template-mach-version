import type { PageContext } from "vike/types";
import { getShopContent } from "#root/backend/shop-content/service";
import {
  DEFAULT_SHOP_CONTENT,
  type ShopContent,
} from "#root/shared/types/shop-content";
import { getStoreOwnerId } from "#root/shared/config/store";

export type Data = {
  shopContent: ShopContent;
};

/**
 * Loads the Mach shop CMS content during SSR so the hero, heading and intro
 * are present in the first paint instead of appearing after hydration.
 *
 * Uses the same `getShopContent` reader the admin and the storefront use — the
 * client does not fetch it again once this has supplied it.
 */
export const data = async (ctx: PageContext): Promise<Data> => {
  try {
    return { shopContent: await getShopContent(getStoreOwnerId(), ctx.db) };
  } catch {
    // Shop copy is an enhancement — never fail the page over it.
    return { shopContent: DEFAULT_SHOP_CONTENT };
  }
};
