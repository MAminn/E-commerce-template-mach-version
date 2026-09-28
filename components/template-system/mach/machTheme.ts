/**
 * The Mach storefront's page-level theme.
 *
 * Mach is dark by default: every surface that has no media of its own sits on
 * the ink ground. The switch lives in one place — the storefront `<main>` in
 * LayoutDefault carries `MACH_THEME_CLASS`, and `layouts/style.css` re-points
 * the shared shadcn tokens (`--background`, `--card`, `--border`, `--input`…)
 * inside that scope. That is what turns the inherited page shell, the cart and
 * checkout forms and every `bg-background` / `bg-card` surface dark without a
 * per-component override.
 *
 * Only the Mach chrome gets it. "editorial" is the stored navbarStyle this
 * storefront has always used and it resolves to `MachNavbar`, so it is the
 * signal that the Mach template is the one on screen. Any other navbar style —
 * the default or the minimal template — keeps the light tokens, and the
 * dashboard never carries the class at all.
 */

export const MACH_THEME_CLASS = "mach-theme-dark";

/** Mirrored onto `<html>` after mount, for portals and the overscroll area. */
export const MACH_THEME_ATTRIBUTE = "machTheme";

export function isMachDarkTheme({
  navbarStyle,
  isDashboardRoute,
}: {
  navbarStyle: string | undefined;
  isDashboardRoute: boolean;
}): boolean {
  return !isDashboardRoute && navbarStyle === "editorial";
}
