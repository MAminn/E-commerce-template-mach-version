import { useEffect } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { useConsent } from "#root/frontend/contexts/ConsentContext";
import { readConsentCookie } from "#root/frontend/contexts/TrackingContext";
import {
  hasYozoStarted,
  injectYozoLoader,
  isYozoAllowedByConsent,
  isYozoEligiblePath,
  removeYozoLoader,
} from "#root/frontend/yozo/yozo-widget";

/**
 * Loads the Yozo AI widget on public storefront routes once the visitor has
 * granted marketing consent. Renders nothing; SSR emits no Yozo markup, so
 * there is nothing for hydration to disagree with.
 *
 * Mounted for every route (inside ConsentProvider) rather than only on the
 * storefront, because it also has to notice when a document that already ran
 * Yozo ends up somewhere Yozo may not be:
 *
 * - client-routed into `/dashboard` or a template preview (browser
 *   back/forward, or the `/login` guard's redirect — links are already full
 *   loads, see lib/admin-navigation.ts), or
 * - consent withdrawn in the same session.
 *
 * Yozo documents no teardown, and poking at its internals is off the table,
 * so both cases reload the document: the fresh page starts without Yozo, and
 * the withdrawn decision is already persisted in the consent cookie.
 */
export function YozoWidget() {
  const { urlPathname } = usePageContext();
  const { consent } = useConsent();
  const eligible = isYozoEligiblePath(urlPathname);
  const allowed = isYozoAllowedByConsent(consent);

  useEffect(() => {
    if (typeof document === "undefined") return;

    if (eligible && allowed) {
      injectYozoLoader(document);
      return;
    }

    if (!hasYozoStarted(document)) return;

    // A ConsentProvider remount briefly reports the default (no-marketing)
    // state before it re-reads the cookie. Only a persisted withdrawal counts,
    // or a remount would reload the page for nothing.
    const withdrawn = !isYozoAllowedByConsent(readConsentCookie());
    if (eligible && !withdrawn) return;

    removeYozoLoader(document);
    window.location.reload();
  }, [eligible, allowed]);

  return null;
}
