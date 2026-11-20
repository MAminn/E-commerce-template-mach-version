import { getLayoutSettings } from "#root/backend/layout/get-layout-settings/index";
import { getTemplateSelectionRaw } from "#root/backend/settings/get-template-selection-raw";
import { getEmailAutomationSettingsRaw } from "#root/backend/email-automations/settings-service";
import { db } from "#root/shared/database/drizzle/db";
import { getStoreOwnerId } from "#root/shared/config/store";
import { STORE_NAME, STORE_CURRENCY } from "#root/shared/config/branding";
import { getPublicOrigin, toAbsoluteUrl } from "#root/shared/config/site-url";

export interface EmailBranding {
  storeName: string;
  logoUrl: string | undefined;
  contactEmail: string | undefined;
  currency: string;
  isMinimal: boolean;
  socialLinks: Array<{ platform: string; url: string }>;
  /**
   * Where customers should write about an order: the storefront's contact
   * email, else EMAIL_REPLY_TO. Undefined when neither is set (the order
   * email then just says "reply to this email").
   */
  supportEmail: string | undefined;
  /** Public storefront origin (PUBLIC_ORIGIN / BASE_URL), e.g. https://machsupplements.com */
  websiteUrl: string;
}

function envSupportEmail(): string | undefined {
  const value = (process.env.EMAIL_REPLY_TO || "").trim();
  return value.includes("@") ? value : undefined;
}

/**
 * Resolves branding values for email templates from layout settings.
 * Returns store name (from siteTitle or STORE_NAME env), logo URL, contact
 * email, currency, and whether the minimal template is active.
 */
export async function getEmailBranding(): Promise<EmailBranding> {
  try {
    // Must match whatever the storefront is actually rendering (server/server.ts
    // and server/vike-handler.ts both resolve this the same way) — hardcoding
    // "landing-minimal" here pulled a different, possibly blank/stale row
    // whenever the admin had a different landing template active, which is
    // why the email logo could differ from (or 404 against) the real site header.
    const templateSelection = await getTemplateSelectionRaw(db());
    const activeLandingTemplate = templateSelection.landing || "landing-minimal";
    const settings = await getLayoutSettings(getStoreOwnerId(), activeLandingTemplate);
    const isMinimal = settings.header.navbarStyle === "minimal";
    const storeName = settings.siteTitle || STORE_NAME || "Store";

    // Gmail, Outlook.com, and Yahoo all strip `data:` URI images out of HTML
    // emails (a known anti-phishing measure — they refuse to render an image
    // that can't be scanned/cached), leaving a broken-image icon where the
    // logo should be. So this must always resolve to a real fetchable URL —
    // relative uploads become absolute against PUBLIC_ORIGIN/BASE_URL, never
    // base64-embedded.
    // Admin can set a dedicated email logo (Marketing Emails > Automation
    // Settings) that takes priority over the site header logo — falls back
    // to the header logo below when unset, so nothing breaks for stores
    // that never touch this field.
    const automationSettings = await getEmailAutomationSettingsRaw();
    const rawLogoUrl = automationSettings.emailLogoUrl || settings.header.logoUrl;

    let logoUrl: string | undefined;
    if (rawLogoUrl && !rawLogoUrl.startsWith("data:")) {
      // Cache-bust: Gmail's image proxy fetched this exact URL (unchanged
      // since it's the same uploaded file) while it was still blocked by the
      // old same-origin CORP header, and caches that failure by URL. Adding
      // a query param forces every mail client to treat it as a URL it's
      // never seen, guaranteeing a fresh fetch against the now-fixed header.
      logoUrl = `${toAbsoluteUrl(rawLogoUrl)}?cb=corp-fix-20260811`;
    }

    return {
      storeName,
      logoUrl,
      contactEmail: settings.header.contactEmail || undefined,
      currency: STORE_CURRENCY,
      isMinimal,
      socialLinks: (settings.footer.socialLinks ?? []).filter(
        (s) => s.url && s.url !== "#",
      ),
      supportEmail: settings.header.contactEmail || envSupportEmail(),
      websiteUrl: getPublicOrigin(),
    };
  } catch {
    return {
      storeName: STORE_NAME || "Store",
      logoUrl: undefined,
      contactEmail: undefined,
      currency: STORE_CURRENCY,
      isMinimal: false,
      socialLinks: [],
      supportEmail: envSupportEmail(),
      websiteUrl: getPublicOrigin(),
    };
  }
}
