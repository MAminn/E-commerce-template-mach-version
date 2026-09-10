import Navbar from "#root/components/globals/Navbar.jsx";
import { MachNavbar } from "#root/components/template-system/mach/MachNavbar";
import { MinimalNavbar } from "#root/components/template-system/minimal/MinimalNavbar";
import { MinimalFooter } from "#root/components/template-system/minimal/MinimalFooter";
import { MinimalMobileBottomNav } from "#root/components/template-system/minimal/MinimalMobileBottomNav";
import { MinimalComingSoonPage } from "#root/components/template-system/minimal/MinimalComingSoonPage";
import { MinimalI18nProvider } from "#root/lib/i18n/MinimalI18nContext";
import { Footer } from "#root/components/globals/Footer";
import { useContext, useEffect, useRef, useState, memo } from "react";
import "./style.css";
import { toast, Toaster } from "sonner";
import { CartToastContainer } from "#root/components/ui/cart-toast";
import { EntryPopup } from "#root/components/EntryPopup";
import { StickyCartBar } from "#root/components/ui/StickyCartBar";
import { MachCartToastContainer } from "#root/components/template-system/mach/MachCartFeedback";
import { MachSocialProofToast } from "#root/components/template-system/mach/MachSocialProofToast";
import type { ClientSession } from "#root/backend/auth/shared/entities.js";
import { usePageContext } from "vike-react/usePageContext";
import { AuthContext } from "#root/context/AuthContext.js";
import { CartProvider } from "#root/lib/context/CartContext";
import {
  TemplateProvider,
  useTemplate,
} from "#root/frontend/contexts/TemplateContext";
import { TrackingProvider } from "#root/frontend/contexts/TrackingContext";
import { Toaster as ShadcnToaster } from "#root/components/ui/toaster";
import {
  NavbarModeContext,
  getNavbarMode,
} from "#root/components/globals/NavbarContext";
import { LayoutSettingsContext } from "#root/frontend/contexts/LayoutSettingsContext";
import type { LayoutSettings } from "#root/shared/types/layout-settings";
import { getDefaultLayoutSettings } from "#root/shared/types/layout-settings";
import { getStoreOwnerId } from "#root/shared/config/store";
import { isSupplementStore } from "#root/shared/config/branding";
import { trpc } from "#root/shared/trpc/client.js";
import { authClient } from "#root/lib/auth-client.js";

/**
 * Conditionally render the global footer.
 * When the editorial landing template is active on the homepage,
 * EditorialChrome provides its own footer — skip the global one so
 * there's no double-footer flash during SSR/hydration.
 */
function GlobalFooter() {
  const { getTemplateId } = useTemplate();
  const { urlPathname } = usePageContext();
  const isEditorialLandingPage =
    urlPathname === "/" && getTemplateId("landing") === "landing-editorial";
  if (isEditorialLandingPage) return null;

  const landingTemplate = getTemplateId("landing");
  if (landingTemplate === "landing-minimal") {
    return (
      <div id='global-footer'>
        <MinimalFooter />
      </div>
    );
  }

  return (
    <div id='global-footer'>
      <Footer />
    </div>
  );
}

// Memoized Content component to prevent unnecessary re-renders
const Content = memo(({ children }: { children: React.ReactNode }) => {
  const pageContext = usePageContext();
  const [session, setSession] = useState<ClientSession | null>(
    pageContext.clientSession ?? null,
  );

  // PRIMARY: Sync session from SSR page context on navigation
  useEffect(() => {
    if (pageContext.clientSession) {
      setSession(pageContext.clientSession);
    }
  }, [pageContext]);

  // FALLBACK: If SSR didn't provide a session (proxy hiccup, CDN cache, etc.),
  // ask the server directly — the httpOnly cookie is still sent with fetch.
  useEffect(() => {
    if (session) return; // already have a session, skip
    let cancelled = false;

    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data?.success && data.result) {
          // Ensure expiresAt is a Date object on the client
          const restored: ClientSession = {
            ...data.result,
            expiresAt:
              data.result.expiresAt instanceof Date
                ? data.result.expiresAt
                : new Date(data.result.expiresAt),
          };
          setSession(restored);
        }
      })
      .catch(() => {
        /* silent — user is simply not logged in */
      });

    return () => {
      cancelled = true;
    };
  }, []); // runs once on mount

  const logout = async () => {
    try {
      await authClient.signOut();
    } catch (err) {
      console.error("Logout error:", err);
    }
    setSession(null);
    window.location.href = "/";
  };

  const isDashboardRoute = pageContext.urlPathname.startsWith("/dashboard");
  const isChromelessRoute = pageContext.urlPathname === "/links";
  const navbarMode = getNavbarMode(pageContext.urlPathname);

  return (
    <AuthContext.Provider value={{ session, logout }}>
      <CartProvider>
        <TemplateProvider>
          <LayoutShell
            isDashboardRoute={isDashboardRoute || isChromelessRoute}
            navbarMode={navbarMode}>
            {children}
          </LayoutShell>
        </TemplateProvider>
      </CartProvider>
    </AuthContext.Provider>
  );
});

/**
 * Inner shell that lives inside TemplateProvider so it can
 * use useTemplate() to fetch template-scoped layout settings.
 */
function LayoutShell({
  children,
  isDashboardRoute,
  navbarMode,
}: {
  children: React.ReactNode;
  isDashboardRoute: boolean;
  navbarMode: ReturnType<typeof getNavbarMode>;
}) {
  const { getTemplateId } = useTemplate();
  const pageContext = usePageContext();
  const ssrLayoutSettings = pageContext.layoutSettingsData as
    | LayoutSettings
    | undefined;

  const activeLandingTemplateId = getTemplateId("landing") ?? undefined;

  // Initialise from SSR data if available — prevents flicker. Without it, fall
  // back to the active template's own chrome defaults rather than the global
  // ones, so an editorial/minimal storefront doesn't flash the default navbar.
  const [layoutSettings, setLayoutSettings] = useState<LayoutSettings>(
    ssrLayoutSettings ?? getDefaultLayoutSettings(activeLandingTemplateId),
  );

  // Fetch CMS layout settings (template-scoped) — only if SSR didn't provide them
  useEffect(() => {
    if (ssrLayoutSettings) return; // SSR already provided, skip client fetch
    trpc.layout.getSettings
      .query({
        merchantId: getStoreOwnerId(),
        templateId: activeLandingTemplateId,
      })
      .then((res) => {
        if (res.success && res.result) {
          setLayoutSettings(res.result);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch layout settings:", err);
      });
  }, [activeLandingTemplateId, ssrLayoutSettings]);

  const isMinimal = layoutSettings.header.navbarStyle === "minimal";

  /**
   * Mach suppresses the inherited `StickyCartBar`.
   *
   * That component is a bottom-anchored amber/emerald gradient pill. It is the
   * add-to-cart feedback for the templates it was built for and stays mounted
   * for every one of them; on Mach it is the only accent colour on a storefront
   * whose interface is defined by having none, and on a phone it floats on top
   * of the Mach product page's own sticky purchase bar. `MachCartToastContainer`
   * takes its place here, alongside the navbar's live bag count and the
   * in-place confirmation on the button that was pressed.
   *
   * Keyed off the store's vertical rather than off a template id: the vertical
   * is a compile-time constant (shared/config/branding.ts), so no admin
   * template switch can hand another storefront this branch, and a fork
   * re-targeted at another vertical gets the inherited bar back untouched.
   *
   * Narrowed by `!isMinimal` so this only applies where the Mach chrome is
   * actually on screen. Switching this store's navbar to "minimal" renders the
   * minimal template's own navigation and bottom nav, and its desktop cart
   * pill below is part of that template — Mach must not reach in and remove it.
   */
  const isMachStorefront = isSupplementStore() && !isMinimal;

  // ── Coming-soon gate (minimal template only) ──────────────────────────────
  const { session } = useContext(AuthContext);
  const isAdmin = session?.role === "admin" || session?.role === "superadmin";
  const [comingSoonMode, setComingSoonMode] = useState(false);
  const BYPASS_PATHS = ["/login", "/register", "/api", "/dashboard"];

  useEffect(() => {
    if (!isMinimal) return;
    trpc.settings.getComingSoonMode
      .query()
      .then((res) => {
        if (res.success) setComingSoonMode(res.result);
      })
      .catch(() => {});
  }, [isMinimal]);

  const shouldShowComingSoon =
    isMinimal &&
    !isDashboardRoute &&
    comingSoonMode &&
    !isAdmin &&
    !BYPASS_PATHS.some((p) => pageContext.urlPathname.startsWith(p));

  const renderNavbar = () => {
    switch (layoutSettings.header.navbarStyle) {
      // "editorial" is the stored navbarStyle for this storefront; it now
      // resolves to the Mach navigation. The value is left alone so existing
      // layout_settings rows keep working.
      case "editorial":
        return <MachNavbar />;
      case "minimal":
        return <MinimalNavbar />;
      default:
        return <Navbar lang='en' />;
    }
  };

  // If coming-soon mode is active for a non-admin, show the coming-soon page
  if (shouldShowComingSoon) {
    return isMinimal ? (
      <MinimalI18nProvider overrides={layoutSettings.translationOverrides}>
        <LayoutSettingsContext.Provider value={layoutSettings}>
          <MinimalComingSoonPage />
          <Toaster />
          <ShadcnToaster />
        </LayoutSettingsContext.Provider>
      </MinimalI18nProvider>
    ) : null;
  }

  const inner = (
    <LayoutSettingsContext.Provider value={layoutSettings}>
      <NavbarModeContext.Provider value={navbarMode}>
        <TrackingProvider>
          <main
            id='page-content'
            className={`bg-background h-full text-foreground w-full font-poppins${!isDashboardRoute ? " storefront-shell" : ""}${isMinimal && !isDashboardRoute ? " minimal-template pb-20 lg:pb-0" : ""}`}>
            {!isDashboardRoute && (
              <GlobalNavbarChrome navbarMode={navbarMode}>
                {renderNavbar()}
              </GlobalNavbarChrome>
            )}
            {isDashboardRoute ? (
              <div dir='ltr' style={{ direction: "ltr" }}>
                {children}
              </div>
            ) : (
              children
            )}
            {!isDashboardRoute && <GlobalFooter />}
            {!isDashboardRoute && <CartToastContainer />}
            {!isDashboardRoute && <EntryPopup />}
            {/* Mach's own add-to-cart confirmation. Replaces StickyCartBar for
                this storefront — see the suppression note below. */}
            {!isDashboardRoute && isMachStorefront && <MachCartToastContainer />}
            {/* CMS-controlled recent-order toast. Same `isMachStorefront`
                gate as the cart confirmation above — it is built against the
                Mach card language and the Mach product page's sticky purchase
                bar, so no other template inherits it. The component keeps its
                own route exclusion list (checkout, cart, auth, account…), so
                mounting it here does not mean showing it everywhere. */}
            {!isDashboardRoute && isMachStorefront && <MachSocialProofToast />}
            {/* Minimal template: mobile relies on the bottom nav's "Offers" tab
                instead, but desktop still gets this pill — CTA uses the
                component's own default (/shop, "SHOP MORE") so users chasing
                a reward threshold land on the catalogue, not a dead end. */}
            {!isDashboardRoute && !isMinimal && !isMachStorefront && (
              <StickyCartBar raiseForBottomNav={isMinimal} />
            )}
            {!isDashboardRoute && isMinimal && <StickyCartBar desktopOnly />}
            {!isDashboardRoute && isMinimal && <MinimalMobileBottomNav />}
            {/* Bottom-anchored toasts can visually collide with the fixed
                mobile bottom nav on the minimal template — keep them up top there. */}
            <Toaster position={isMinimal ? "top-center" : undefined} />
            <ShadcnToaster />
            {/* Phase 3 — page-transition overlay (CSS-only, SSR-inert) */}
            <div
              id='page-transition-overlay'
              aria-hidden='true'
              className='page-transition-overlay'
            />
          </main>
        </TrackingProvider>
      </NavbarModeContext.Provider>
    </LayoutSettingsContext.Provider>
  );

  // Read SSR locale from pageContext to prevent EN→AR flicker
  const ssrLocale = pageContext.ssrLocale as "en" | "ar" | undefined;

  // Wrap in MinimalI18nProvider only when the minimal navbar/template is active
  if (isMinimal) {
    return (
      <MinimalI18nProvider
        overrides={layoutSettings.translationOverrides}
        ssrLocale={ssrLocale}>
        {inner}
      </MinimalI18nProvider>
    );
  }
  return inner;
}

// Display name for the memoized component
Content.displayName = "Content";

/**
 * GlobalNavbarChrome
 *
 * Single fixed wrapper for the announcement banner + navbar so they stack as
 * normal-flow siblings (no overlap regardless of how many lines the banner
 * wraps to). A ResizeObserver tracks the chrome's actual height and applies a
 * matching spacer below — only in solid mode. In overlay mode (homepage with
 * hero), the chrome floats over the hero and no spacer is rendered.
 */
function GlobalNavbarChrome({
  navbarMode,
  children,
}: {
  navbarMode: ReturnType<typeof getNavbarMode>;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const isOverlay = navbarMode === "overlay";

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;

    const update = () => setHeight(el.getBoundingClientRect().height);
    update();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    window.addEventListener("resize", update, { passive: true });
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <>
      <div
        ref={ref}
        id='global-navbar'
        className='fixed inset-x-0 top-0 z-[10000]'>
        {/* Slot for page-level promo/announcement banners (portal target).
            Pages render their banner here so it stacks above the navbar
            and the chrome's measured height includes it automatically. */}
        <div id='chrome-banner-slot' />
        {children}
      </div>
      {/* Spacer — only in solid mode so page content isn't hidden behind the
          fixed chrome. Auto-adjusts as banner wraps to 1/2/3 lines. */}
      {!isOverlay && <div aria-hidden='true' style={{ height }} />}
    </>
  );
}

export default function LayoutDefault({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Content>{children}</Content>;
}
