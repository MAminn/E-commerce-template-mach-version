import { isAdminPath } from "#root/lib/admin-navigation";

// ─── Yozo AI storefront widget ──────────────────────────────────────────────
//
// The browser half of the Yozo integration is this one script, exactly as the
// Yozo dashboard supplies it. It needs no configuration from us: the loader
// identifies the shop by `location.hostname`, which is why it only renders on
// the domain the Yozo account is bound to (machsupplements.com) and stays inert
// on localhost. Neither YOZO_SHOP_ID nor YOZO_API_SECRET belongs anywhere in
// client code — the secret is for signing server events, which are NOT
// implemented: BLOCKER_YOZO_EVENT_API_SPEC_REQUIRED (no official Yozo event /
// signature specification is available yet; do not reverse-engineer the
// widget's own endpoints in its place).
//
// Yozo is the storefront's AI assistant and is available to every visitor:
// it is deliberately NOT gated on the cookie-consent state (unlike the
// pixels, which still are). Only the route decides whether it loads.

/** Provider-supplied URL. Do not change the version without Yozo's say-so. */
export const YOZO_WIDGET_SRC =
  "https://agents.yozo.ai/widgets/yozo-widgets.js?v=1791373399744";

/** Marks the tag we inject, so it is found again instead of duplicated. */
export const YOZO_LOADER_ATTRIBUTE = "data-mach-yozo-loader";

/**
 * The loader injects its real bundle tagged with this attribute (and checks
 * for it itself before injecting). Read only, as evidence the runtime has
 * started in this document — never used to manipulate Yozo's state.
 */
const YOZO_BUNDLE_SELECTOR = "script[data-yozo-widgets]";

/** Public storefront only: never the admin app, never template previews. */
export function isYozoEligiblePath(pathname: string): boolean {
  if (isAdminPath(pathname)) return false;
  if (pathname === "/template-preview" || pathname.startsWith("/template-preview/")) {
    return false;
  }
  return true;
}

function findLoaderTag(doc: Document): HTMLScriptElement | null {
  return doc.querySelector<HTMLScriptElement>(`script[${YOZO_LOADER_ATTRIBUTE}]`);
}

/** Whether Yozo code has been (or is being) loaded into this document. */
export function hasYozoStarted(doc: Document): boolean {
  return Boolean(findLoaderTag(doc) || doc.querySelector(YOZO_BUNDLE_SELECTOR));
}

/**
 * Append the provider script once per document. Async, so it never blocks
 * parsing or hydration; a failed load is swallowed, because an unreachable
 * provider must leave the storefront exactly as it was.
 */
export function injectYozoLoader(doc: Document): void {
  if (findLoaderTag(doc)) return;
  try {
    const script = doc.createElement("script");
    script.src = YOZO_WIDGET_SRC;
    script.async = true;
    script.setAttribute(YOZO_LOADER_ATTRIBUTE, "");
    script.addEventListener("error", () => {
      // Provider down or blocked — nothing on the storefront depends on it.
    });
    doc.head.appendChild(script);
  } catch {
    // Injection itself failing is equally non-fatal.
  }
}

/** Remove the tag we added. Does not (and cannot) unload executed code. */
export function removeYozoLoader(doc: Document): void {
  findLoaderTag(doc)?.remove();
}
