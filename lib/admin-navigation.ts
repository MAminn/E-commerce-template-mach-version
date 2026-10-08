/**
 * Entry into the admin app (`/dashboard`) from anywhere else is a full
 * document load, never a client-routed transition.
 *
 * The storefront runs third-party scripts the dashboard must not inherit —
 * the Yozo widget (frontend/yozo) has no documented teardown, so once it has
 * run in a document the only way to be rid of it is to leave that document.
 * Client routing would carry it straight into the admin UI.
 *
 * Vike's client router skips any link with `rel="external"` and lets the
 * browser navigate normally (vike/dist/.../isLinkSkipped.js), which is the
 * supported opt-out. Navigation *within* the dashboard keeps client routing.
 */

/** Pathname-only view of an href: drops `?query` and `#hash`. */
function toPathname(href: string): string {
  const end = href.search(/[?#]/);
  return end === -1 ? href : href.slice(0, end);
}

/** True for `/dashboard` and anything below it (not `/dashboardx`). */
export function isAdminPath(pathnameOrHref: string): boolean {
  const pathname = toPathname(pathnameOrHref);
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

/**
 * The `rel` a link needs so that crossing from the storefront into the admin
 * app reloads the document. `undefined` for every other link, including
 * dashboard → dashboard, so admin navigation stays client-routed.
 */
export function adminEntryRel(
  href: string,
  currentPathname: string,
): "external" | undefined {
  return isAdminPath(href) && !isAdminPath(currentPathname)
    ? "external"
    : undefined;
}
