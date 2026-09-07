import { layoutSettings } from "#root/shared/database/drizzle/schema";
import { eq, and } from "drizzle-orm";
import type { DatabaseClient } from "#root/shared/database/drizzle/db";
import type { LayoutSettings } from "#root/shared/types/layout-settings";
import {
  DEFAULT_LOGO_SIZE,
  DEFAULT_FOOTER_LOGO_SIZE,
  getDefaultLayoutSettings,
} from "#root/shared/types/layout-settings";

/**
 * Direct database query for SSR layout-settings injection.
 * Accepts the request-scoped `DatabaseClient` (not the singleton)
 * so it works in the server render path without Effect.
 */
export async function getLayoutSettingsRaw(
  db: DatabaseClient,
  merchantId: string,
  templateId?: string,
): Promise<LayoutSettings> {
  // Template-scoped base: a template that ships its own chrome (editorial,
  // minimal) gets it by default, while a stored row still overrides everything.
  const defaults = getDefaultLayoutSettings(templateId);

  try {
    const resolvedTemplateId = templateId || "default";

    const result = await db
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
      return mergeWithDefaults(
        result[0].content as unknown as LayoutSettings,
        defaults,
      );
    }

    // Fallback to "default" row
    if (resolvedTemplateId !== "default") {
      const fallback = await db
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
        return mergeWithDefaults(
          fallback[0].content as unknown as LayoutSettings,
          defaults,
        );
      }
    }

    return defaults;
  } catch {
    return defaults;
  }
}

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
      logoSize: { ...DEFAULT_LOGO_SIZE, ...stored.header?.logoSize },
      navigationLinks:
        stored.header?.navigationLinks ??
        base.header.navigationLinks,
    },
    footer: {
      ...base.footer,
      ...stored.footer,
      logoSize: { ...DEFAULT_FOOTER_LOGO_SIZE, ...stored.footer?.logoSize },
      footerLinkGroups:
        stored.footer?.footerLinkGroups ??
        base.footer.footerLinkGroups,
      socialLinks:
        stored.footer?.socialLinks ??
        base.footer.socialLinks,
    },
  };
}
