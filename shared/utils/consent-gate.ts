import type {
  ConsentCategories,
  ConsentMethodType,
  ConsentState,
  PixelConfig,
} from "#root/shared/types/pixel-tracking";

// ─── Why this module exists ─────────────────────────────────────────────────
//
// Everything a BROWSER needs to know about consent lives here, and nothing
// else. `backend/pixel-tracking/consent/service.ts` used to hold these same
// helpers next to its database functions, and importing it from a React
// context dragged `drizzle-orm` → `pg` into the client bundle, where the first
// module to touch `Buffer` throws and hydration never runs. That is invisible
// to unit tests and fatal in a real browser. Keep this file free of imports
// other than types.

/**
 * The single place that decides whether a pixel configuration may fire.
 *
 * Browser and server both import this, so a visitor who rejected marketing
 * cannot have their events quietly relayed server-side: the beacon endpoint
 * reads the same cookie and applies the same rule to the same configuration.
 * Two copies of this logic would drift, and the drift would be invisible —
 * the browser would look compliant while the Conversions API kept sending.
 */
export function isConfigAllowedByConsent(
  config: Pick<PixelConfig, "consentRequired" | "consentCategory">,
  consent: ConsentState | null,
): boolean {
  // `consentRequired: false` means the merchant took this pixel out of the
  // banner's scope entirely, so it runs regardless.
  if (!config.consentRequired) return true;

  // No decision yet (or an expired one) is not permission.
  if (!consent) return false;

  switch (config.consentCategory) {
    case "analytics":
      return consent.categories.analytics;
    case "marketing":
      return consent.categories.marketing;
    default:
      // An unset or "custom" category needs an explicit decision plus
      // marketing consent, which is the stricter reading.
      return consent.given && consent.categories.marketing;
  }
}

/** Cookie name holding the visitor's consent decision. */
export const CONSENT_COOKIE = "_tracking_consent";
/** Alias kept for the backend service's public API. */
export const CONSENT_COOKIE_NAME = CONSENT_COOKIE;

/** Consent is valid for 12 months from the date it was given. */
const CONSENT_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Default consent state — only functional tracking is allowed.
 * This is the state before the user interacts with the consent banner.
 */
export function getDefaultConsentState(): ConsentState {
  return {
    given: false,
    categories: {
      functional: true,
      analytics: false,
      marketing: false,
    },
    method: "implied",
    expiresAt: null,
  };
}

/**
 * Build a ConsentState where all categories are accepted.
 */
export function buildAcceptAllConsent(method: ConsentMethodType): ConsentState {
  return {
    given: true,
    categories: {
      functional: true,
      analytics: true,
      marketing: true,
    },
    method,
    expiresAt: new Date(Date.now() + CONSENT_VALIDITY_MS),
  };
}

/**
 * Build a ConsentState where only functional is allowed (reject marketing & analytics).
 */
export function buildRejectAllConsent(method: ConsentMethodType): ConsentState {
  return {
    given: true, // User has made a choice, even if it's to reject
    categories: {
      functional: true,
      analytics: false,
      marketing: false,
    },
    method,
    expiresAt: new Date(Date.now() + CONSENT_VALIDITY_MS),
  };
}

/**
 * Check whether a consent state has expired.
 */
export function isConsentExpired(state: ConsentState): boolean {
  if (!state.expiresAt) return false; // No expiry = not expired
  return new Date() > new Date(state.expiresAt);
}

/**
 * Determines which pixel platforms should fire based on consent categories.
 */
export function getAllowedPlatforms(
  categories: ConsentCategories,
): { analytics: boolean; marketing: boolean } {
  return {
    analytics: categories.analytics,
    marketing: categories.marketing,
  };
}

/**
 * Serialize consent state for cookie storage.
 */
export function serializeConsentCookie(state: ConsentState): string {
  return JSON.stringify({
    g: state.given ? 1 : 0,
    a: state.categories.analytics ? 1 : 0,
    m: state.categories.marketing ? 1 : 0,
    mt: state.method,
    ex: state.expiresAt ? new Date(state.expiresAt).getTime() : null,
  });
}

/**
 * Deserialize consent state from cookie (no expiry check — see
 * `parseConsentCookieValue` for the gating variant).
 */
export function deserializeConsentCookie(
  cookieValue: string,
): ConsentState | null {
  try {
    const data = JSON.parse(cookieValue);
    return {
      given: data.g === 1,
      categories: {
        functional: true, // Always true
        analytics: data.a === 1,
        marketing: data.m === 1,
      },
      method: data.mt || "implied",
      expiresAt: data.ex ? new Date(data.ex) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Parse the consent cookie value for GATING: an expired decision is no
 * decision. Shape is `{ g, a, m, mt, ex }` — see `serializeConsentCookie`.
 */
export function parseConsentCookieValue(
  raw: string | undefined | null,
): ConsentState | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const data = JSON.parse(decoded) as {
      g?: number;
      a?: number;
      m?: number;
      mt?: string;
      ex?: number | null;
    };
    const expiresAt = data.ex ? new Date(data.ex) : null;
    if (expiresAt && expiresAt.getTime() < Date.now()) return null; // expired
    return {
      given: data.g === 1,
      categories: {
        functional: true,
        analytics: data.a === 1,
        marketing: data.m === 1,
      },
      method: (data.mt as ConsentState["method"]) || "implied",
      expiresAt,
    };
  } catch {
    return null;
  }
}
