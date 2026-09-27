import { and, eq, inArray } from "drizzle-orm";
import type { DatabaseClient } from "#root/shared/database/drizzle/db";
import {
  promoCodeCategories,
  promoCodeProducts,
} from "#root/shared/database/drizzle/schema";

/**
 * Which of these products a restricted promo code applies to: products linked
 * to the code directly, plus products whose own category is linked. A product
 * matching both is still one entry. Categories are matched exactly (they have
 * no hierarchy).
 *
 * The single eligibility rule for both cart validation and order creation —
 * callers pass product rows read from the database, never client data.
 */
export async function resolvePromoEligibleProductIds(
  db: Pick<DatabaseClient, "select">,
  promoCodeId: string,
  products: readonly { id: string; categoryId: string | null }[],
): Promise<Set<string>> {
  const productIds = [...new Set(products.map((p) => p.id))];
  if (productIds.length === 0) return new Set();

  const categoryIds = [
    ...new Set(
      products
        .map((p) => p.categoryId)
        .filter((id): id is string => id !== null),
    ),
  ];

  const [linkedProducts, linkedCategories] = await Promise.all([
    db
      .select({ productId: promoCodeProducts.productId })
      .from(promoCodeProducts)
      .where(
        and(
          eq(promoCodeProducts.promoCodeId, promoCodeId),
          inArray(promoCodeProducts.productId, productIds),
        ),
      ),
    categoryIds.length > 0
      ? db
          .select({ categoryId: promoCodeCategories.categoryId })
          .from(promoCodeCategories)
          .where(
            and(
              eq(promoCodeCategories.promoCodeId, promoCodeId),
              inArray(promoCodeCategories.categoryId, categoryIds),
            ),
          )
      : Promise.resolve([]),
  ]);

  const productSet = new Set(linkedProducts.map((r) => r.productId));
  const categorySet = new Set(linkedCategories.map((r) => r.categoryId));

  return new Set(
    products
      .filter(
        (p) =>
          productSet.has(p.id) ||
          (p.categoryId !== null && categorySet.has(p.categoryId)),
      )
      .map((p) => p.id),
  );
}
