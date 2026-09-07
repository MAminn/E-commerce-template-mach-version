import { createContext, useContext } from "react";

/**
 * Navbar display mode:
 *
 * "overlay"  — Transparent at top, fixed over content, transitions to solid
 *              on scroll. Used on pages with hero sections (Landing, Shop).
 *
 * "solid"    — Solid background from the start, sticky so it occupies layout
 *              space. Content is automatically pushed below. Used on pages
 *              without hero sections (Product, Cart, Checkout, etc.).
 */
export type NavbarMode = "overlay" | "solid";

export const NavbarModeContext = createContext<NavbarMode>("overlay");

export function useNavbarMode(): NavbarMode {
  return useContext(NavbarModeContext);
}

// ─── Route → Mode mapping ──────────────────────────────────────────────

/**
 * Overlay routes: pages that have a full-bleed hero and expect the navbar
 * to float transparently over it.
 *
 * Everything else gets solid mode automatically.
 */
const OVERLAY_ROUTES: ((path: string) => boolean)[] = [
  // Landing / homepage — the only route that opens on a full-height hero.
  (p) => p === "/",
  // /shop and /categories/* are deliberately NOT overlay routes. The Mach
  // storefront is product-first: those pages open on a heading and a product
  // count, not a hero, so a transparent navbar would float white type over
  // paper. The shop banner is still available from the CMS — it simply sits
  // below a solid navbar, which is right for a banner rather than a
  // full-height hero.
];

/**
 * Determine navbar mode from the current URL pathname.
 * Solid is the safe default — only explicitly listed routes get overlay.
 */
export function getNavbarMode(pathname: string): NavbarMode {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return OVERLAY_ROUTES.some((match) => match(normalized))
    ? "overlay"
    : "solid";
}
