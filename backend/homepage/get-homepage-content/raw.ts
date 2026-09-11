import { homepageContent } from "#root/shared/database/drizzle/schema";
import { eq, and } from "drizzle-orm";
import type { DatabaseClient } from "#root/shared/database/drizzle/db";
import type { HomepageContent } from "#root/shared/types/homepage-content";
import { DEFAULT_HOMEPAGE_CONTENT } from "#root/shared/types/homepage-content";
import { mergeHomepageContentWithDefaults } from "../merge-homepage-content";

/**
 * Direct database query for SSR homepage content injection.
 * Accepts a DatabaseClient so it can be used in both Fastify and Hono SSR handlers
 * without relying on the global db() singleton.
 *
 * Same fallback chain as getHomepageContent:
 *   template-specific → legacy "default" row → hardcoded defaults
 */
export async function getHomepageContentRaw(
  database: DatabaseClient,
  merchantId: string,
  templateId?: string,
): Promise<HomepageContent> {
  try {
    const resolvedTemplateId = templateId || "default";

    // Find content for the specific template
    const result = await database
      .select()
      .from(homepageContent)
      .where(
        and(
          eq(homepageContent.merchantId, merchantId),
          eq(homepageContent.templateId, resolvedTemplateId),
        ),
      )
      .limit(1)
      .execute();

    if (result.length > 0 && result[0]?.content) {
      const storedContent = result[0].content as unknown as HomepageContent;
      return mergeHomepageContentWithDefaults(storedContent, resolvedTemplateId);
    }

    // If no template-specific content and this isn't already "default",
    // try the legacy "default" row for backward compatibility
    if (resolvedTemplateId !== "default") {
      const fallback = await database
        .select()
        .from(homepageContent)
        .where(
          and(
            eq(homepageContent.merchantId, merchantId),
            eq(homepageContent.templateId, "default"),
          ),
        )
        .limit(1)
        .execute();

      if (fallback.length > 0 && fallback[0]?.content) {
        const storedContent = fallback[0].content as unknown as HomepageContent;
        return mergeHomepageContentWithDefaults(storedContent, resolvedTemplateId);
      }
    }

    return DEFAULT_HOMEPAGE_CONTENT;
  } catch {
    // SSR CMS injection is an enhancement — failures must not break page rendering
    return DEFAULT_HOMEPAGE_CONTENT;
  }
}
