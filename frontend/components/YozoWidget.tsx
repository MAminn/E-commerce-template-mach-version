import { useEffect } from "react";
import { usePageContext } from "vike-react/usePageContext";
import {
  hasYozoStarted,
  injectYozoLoader,
  isYozoEligiblePath,
  removeYozoLoader,
} from "#root/frontend/yozo/yozo-widget";

/**
 * Loads the Yozo AI widget on public storefront routes, for every visitor —
 * independent of the cookie-consent state. Renders nothing; SSR emits no Yozo
 * markup, so there is nothing for hydration to disagree with.
 *
 * Mounted for every route rather than only on the storefront, because it also
 * has to notice when a document that already ran Yozo is client-routed into
 * `/dashboard` or a template preview (browser back/forward, or the `/login`
 * guard's redirect — links are already full loads, see
 * lib/admin-navigation.ts). Yozo documents no teardown, and poking at its
 * internals is off the table, so that case reloads the document: the fresh
 * page starts without Yozo.
 */
export function YozoWidget() {
  const { urlPathname } = usePageContext();
  const eligible = isYozoEligiblePath(urlPathname);

  useEffect(() => {
    if (typeof document === "undefined") return;

    if (eligible) {
      injectYozoLoader(document);
      return;
    }

    if (!hasYozoStarted(document)) return;

    removeYozoLoader(document);
    window.location.reload();
  }, [eligible]);

  return null;
}
