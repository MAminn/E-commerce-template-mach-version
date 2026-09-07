import { db, type DatabaseClient } from "#root/shared/database/drizzle/db";
import { homepageContent } from "#root/shared/database/drizzle/schema";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  DEFAULT_SHOP_CONTENT,
  SHOP_CONTENT_TEMPLATE_ID,
  mergeShopContentWithDefaults,
  type ShopContent,
} from "#root/shared/types/shop-content";

/**
 * Shop page CMS content.
 *
 * Deliberately its own service pair rather than an extension of the homepage
 * content API: the shapes are unrelated and `HomepageContentSchema` strips
 * unknown keys, so shop fields pushed through it would be silently dropped.
 *
 * Storage reuses the existing `homepage_content` table, which is a generic
 * (merchant_id, template_id) → jsonb store. The row is keyed by
 * `template_id = "sorting-mach"`, kept separate from the landing row. The
 * table's only unique index is the composite (merchant_id, template_id), so a
 * second row per merchant is safe — verified against the live schema.
 *
 * No new table, no migration.
 */

/**
 * @param database Optional client so SSR (`+data.ts`) can pass the request's
 * db without relying on the global singleton. Same single query either way —
 * the storefront and the SSR path share this one reader, never two.
 */
export async function getShopContent(
  merchantId: string,
  database: DatabaseClient = db(),
): Promise<ShopContent> {
  try {
    const rows = await database
      .select({ content: homepageContent.content })
      .from(homepageContent)
      .where(
        and(
          eq(homepageContent.merchantId, merchantId),
          eq(homepageContent.templateId, SHOP_CONTENT_TEMPLATE_ID),
        ),
      )
      .limit(1);

    return mergeShopContentWithDefaults(
      rows[0]?.content as Partial<ShopContent> | undefined,
    );
  } catch (error) {
    // Shop copy is an enhancement — a read failure must never break browsing.
    console.error("[ShopContent] read failed:", error);
    return DEFAULT_SHOP_CONTENT;
  }
}

export async function updateShopContent(
  merchantId: string,
  content: ShopContent,
): Promise<ShopContent> {
  const database = db();
  const now = new Date();

  const updated = await database
    .update(homepageContent)
    .set({ content: content as any, updatedAt: now })
    .where(
      and(
        eq(homepageContent.merchantId, merchantId),
        eq(homepageContent.templateId, SHOP_CONTENT_TEMPLATE_ID),
      ),
    )
    .returning({ content: homepageContent.content });

  if (updated.length > 0) {
    return mergeShopContentWithDefaults(
      updated[0]?.content as Partial<ShopContent>,
    );
  }

  const inserted = await database
    .insert(homepageContent)
    .values({
      id: uuidv7(),
      merchantId,
      templateId: SHOP_CONTENT_TEMPLATE_ID,
      content: content as any,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ content: homepageContent.content });

  return mergeShopContentWithDefaults(
    inserted[0]?.content as Partial<ShopContent>,
  );
}
