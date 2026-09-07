import { useEffect, type ReactNode } from "react";
import { MachFooter } from "./MachFooter";

/**
 * Wraps Mach storefront pages.
 *
 * 1. Sets `data-mach-chrome="true"` on `<html>` for the lifetime of the page,
 *    which a global CSS rule uses to hide `#global-footer` so the site footer
 *    and the Mach footer never stack.
 * 2. Renders the Mach footer below the page content.
 *
 * The navbar is not rendered here — it is chosen globally from
 * `layoutSettings.header.navbarStyle` in LayoutDefault, so it stays consistent
 * across every route rather than only on templated pages.
 *
 * SSR-safe: the attribute is only touched inside an effect.
 */
export function MachChrome({
  children,
  /** True when the page already renders its own newsletter section. */
  hasPageNewsletter = false,
}: {
  children: ReactNode;
  hasPageNewsletter?: boolean;
}) {
  useEffect(() => {
    document.documentElement.dataset.machChrome = "true";
    return () => {
      delete document.documentElement.dataset.machChrome;
    };
  }, []);

  return (
    <>
      {children}
      <MachFooter suppressNewsletter={hasPageNewsletter} />
    </>
  );
}
