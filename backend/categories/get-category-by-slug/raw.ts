import { formatCategoryName } from "#root/shared/utils/format";
import { category, file } from "#root/shared/database/drizzle/schema";
import { and, eq } from "drizzle-orm";
import type { DatabaseClient } from "#root/shared/database/drizzle/db";

/**
 * Direct database lookup of one category by slug, for SSR.
 *
 * Accepts a DatabaseClient rather than using the global `query()` helper, the
 * same convention as `backend/homepage/get-homepage-content/raw.ts`, so it can
 * run inside a page's `+data.ts`.
 *
 * This is not a duplicate of `viewCategories` — that one lists every category
 * with product counts for the browsing chips; this resolves a single slug so
 * the category page can render its heading and breadcrumb on the first paint
 * instead of after hydration.
 *
 * Returns null for an unknown or deleted slug; the caller decides what to show.
 */

export interface CategoryBySlug {
  id: string;
  /** Raw stored name. */
  name: string;
  /** Display name with any internal prefix stripped. */
  displayName: string;
  slug: string;
  /** Bare diskname of the category image, or null. Normalise before use. */
  imageUrl: string | null;
}

export async function getCategoryBySlugRaw(
  database: DatabaseClient,
  slug: string,
): Promise<CategoryBySlug | null> {
  if (!slug) return null;

  try {
    const rows = await database
      .select({
        id: category.id,
        name: category.name,
        slug: category.slug,
        imageUrl: file.diskname,
      })
      .from(category)
      .leftJoin(file, eq(category.imageId, file.id))
      .where(and(eq(category.slug, slug), eq(category.deleted, false)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      displayName: formatCategoryName(row.name),
      slug: row.slug,
      imageUrl: row.imageUrl ?? null,
    };
  } catch (error) {
    // SSR must not fail over this — the client list still resolves the
    // category, exactly as it did before this lookup existed.
    console.error("[Category] SSR slug lookup failed:", error);
    return null;
  }
}
