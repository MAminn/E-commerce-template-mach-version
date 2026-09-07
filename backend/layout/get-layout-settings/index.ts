import { db } from "#root/shared/database/drizzle/db";
import { layoutSettings } from "#root/shared/database/drizzle/schema";
import { eq, and } from "drizzle-orm";
import type { LayoutSettings } from "#root/shared/types/layout-settings";
import {
  DEFAULT_LOGO_SIZE,
  DEFAULT_FOOTER_LOGO_SIZE,
  getDefaultLayoutSettings,
} from "#root/shared/types/layout-settings";

/**
 * Fetches layout settings (header/footer) for a specific merchant and template.
 * Falls back chain: template-specific → "default" row → hardcoded defaults.
 */
export async function getLayoutSettings(
  merchantId: string,
  templateId?: string,
): Promise<LayoutSettings> {
  // Template-scoped base: a template that ships its own chrome (editorial,
  // minimal) gets it by default, while a stored row still overrides everything.
  const defaults = getDefaultLayoutSettings(templateId);

  try {
    const database = db();
    const resolvedTemplateId = templateId || "default";

    // 1. Try template-specific content
    const result = await database
      .select()
      .from(layoutSettings)
      .where(
        and(
          eq(layoutSettings.merchantId, merchantId),
          eq(layoutSettings.templateId, resolvedTemplateId),
        ),
      )
      .limit(1);

    if (result.length > 0 && result[0]?.content) {
      const stored = result[0].content as unknown as LayoutSettings;
      return mergeWithDefaults(stored, defaults);
    }

    // 2. Fallback to legacy "default" row for backward compatibility
    if (resolvedTemplateId !== "default") {
      const fallback = await database
        .select()
        .from(layoutSettings)
        .where(
          and(
            eq(layoutSettings.merchantId, merchantId),
            eq(layoutSettings.templateId, "default"),
          ),
        )
        .limit(1);

      if (fallback.length > 0 && fallback[0]?.content) {
        const stored = fallback[0].content as unknown as LayoutSettings;
        return mergeWithDefaults(stored, defaults);
      }
    }

    // 3. Hardcoded defaults
    return defaults;
  } catch (error) {
    console.error("Error fetching layout settings:", error);
    return defaults;
  }
}

/**
 * Merges stored settings with defaults to ensure all required fields exist.
 * Prevents errors if the schema evolves or data is incomplete.
 */
function mergeWithDefaults(
  stored: Partial<LayoutSettings>,
  base: LayoutSettings,
): LayoutSettings {
  return {
    siteTitle: stored.siteTitle ?? base.siteTitle,
    faviconUrl: stored.faviconUrl ?? base.faviconUrl,
    shareImageUrl: stored.shareImageUrl ?? base.shareImageUrl,
    translationOverrides: stored.translationOverrides ?? base.translationOverrides,
    header: {
      ...base.header,
      ...stored.header,
      logoSize: {
        ...DEFAULT_LOGO_SIZE,
        ...stored.header?.logoSize,
      },
      navigationLinks:
        stored.header?.navigationLinks ??
        base.header.navigationLinks,
    },
    footer: {
      ...base.footer,
      ...stored.footer,
      logoSize: {
        ...DEFAULT_FOOTER_LOGO_SIZE,
        ...stored.footer?.logoSize,
      },
      footerLinkGroups:
        stored.footer?.footerLinkGroups ??
        base.footer.footerLinkGroups,
      socialLinks:
        stored.footer?.socialLinks ??
        base.footer.socialLinks,
    },
  };
}
