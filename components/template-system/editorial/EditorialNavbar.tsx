import { useContext, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Menu,
  Search,
  ShoppingBag,
  User,
  Package,
  Heart,
  LogOut,
  LayoutDashboard,
  ChevronDown,
  Tag,
  Sparkles,
  Flame,
} from "lucide-react";
import { Link } from "#root/components/utils/Link";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
} from "#root/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#root/components/ui/dropdown-menu";
import { AuthContext } from "#root/context/AuthContext.js";
import { useCart } from "#root/lib/context/CartContext";
import { STORE_NAME } from "#root/shared/config/branding";
import { trpc } from "#root/shared/trpc/client";
import { EASE_OUT } from "../motion/motionPresets";
import { useLayoutSettings } from "#root/frontend/contexts/LayoutSettingsContext";
import { isPlaceholderLink } from "#root/shared/types/layout-settings";
import { useNavbarMode } from "#root/components/globals/NavbarContext";
import { HeaderLogo } from "#root/components/globals/HeaderLogo";

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** Fallback nav when the CMS has no navigation links configured. */
const DEFAULT_NAV_LINKS = [
  { label: "Shop", href: "/shop" },
  { label: "Categories", href: "/#categories" },
  { label: "Best Sellers", href: "/shop?section=featured" },
  { label: "About", href: "/#about" },
] as const;

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

/**
 * Editorial Navbar — Mach Supplements chrome.
 *
 * Keeps the editorial architecture (transparent over the hero, solid on
 * scroll, three-column desktop grid with a centred wordmark) but carries a
 * sports-performance treatment: near-black solid state, heavier uppercase
 * type, and the volt accent reserved for the cart count and active states.
 *
 * - Desktop: nav links · centred logo · search / account / bag
 * - Mobile: hamburger → dark Sheet drawer with the same destinations
 * - Auth + cart behaviour is unchanged from the previous implementation
 */
export function EditorialNavbar() {
  const prefersReduced = useReducedMotion() ?? false;
  const mode = useNavbarMode();
  const isSolid = mode === "solid";
  const [isScrolled, setIsScrolled] = useState(isSolid);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [categories, setCategories] = useState<
    { id: string; name: string; slug: string }[]
  >([]);

  const { session, logout } = useContext(AuthContext);
  const { totalItems } = useCart();
  const layoutSettings = useLayoutSettings();

  // Fetch categories for the mobile sheet drop-down
  useEffect(() => {
    trpc.category.view
      .query()
      .then((res) => {
        if (res.success && Array.isArray(res.result)) {
          setCategories(
            (res.result as { id: string; name: string; slug: string }[]).map(
              (c) => ({ id: c.id, name: c.name, slug: c.slug }),
            ),
          );
        }
      })
      .catch(() => {
        /* silent — sheet falls back to just Offers / New Arrivals */
      });
  }, []);

  // Build navigation links from CMS settings, with static fallback. Entries
  // still pointing at a placeholder destination are dropped rather than
  // rendered as links that go nowhere.
  const cmsNavLinks = layoutSettings.header.navigationLinks.filter(
    (l) => !isPlaceholderLink(l.url),
  );
  const NAV_LINKS =
    cmsNavLinks.length > 0
      ? cmsNavLinks.map((l) => ({ label: l.label, href: l.url }))
      : DEFAULT_NAV_LINKS;

  const announcementEnabled = layoutSettings.header.announcementBarEnabled;
  const announcementText = layoutSettings.header.announcementBarText;

  /* ---- Scroll detection ----
   * Stay transparent over the hero; only flip to solid once ~80% of the
   * viewport (≈ hero height) has been scrolled past.
   */
  useEffect(() => {
    if (isSolid) {
      setIsScrolled(true);
      return;
    }

    if (typeof window === "undefined") return;

    const computeThreshold = () => window.innerHeight * 0.8;
    let threshold = computeThreshold();

    const update = () => setIsScrolled(window.scrollY > threshold);
    update();

    const handleScroll = () => update();
    const handleResize = () => {
      threshold = computeThreshold();
      update();
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [isSolid]);

  /* ---- Sheet ---- */
  const handleCloseSheet = () => setIsSheetOpen(false);

  /* ---- Link styles ----
   * Both states sit on a dark ground (transparent-over-hero, or solid ink),
   * so the palette stays white-on-black throughout — no mid-scroll inversion.
   */
  const linkCls = isScrolled
    ? "!text-white/75 hover:!text-white"
    : "!text-white/80 hover:!text-white";

  const iconCls = isScrolled
    ? "!text-white/75 hover:!text-white hover:bg-transparent"
    : "!text-white/80 hover:!text-white hover:bg-transparent";

  const sheetLinkCls =
    "flex items-center gap-3 py-3.5 text-[12px] tracking-[0.18em] uppercase font-semibold text-white/70 hover:text-[var(--mach-accent)] transition-colors";

  return (
    <>
      {/* Announcement bar — flat accent band, high contrast */}
      {announcementEnabled && announcementText && (
        <div className='w-full bg-[var(--mach-accent)] text-[var(--mach-on-accent)] text-center py-2 px-6 text-[10px] tracking-[0.28em] uppercase font-bold select-none'>
          {announcementText}
        </div>
      )}
      <motion.nav
        aria-label='Editorial navigation'
        className={`w-full py-4 lg:py-5 transition-[backdrop-filter] duration-500 ${isScrolled ? "backdrop-blur-xl" : "backdrop-blur-0"}`}
        animate={{
          backgroundColor: isScrolled ? "rgba(11,11,12,0.94)" : "rgba(11,11,12,0)",
          borderBottomColor: isScrolled
            ? "rgba(255,255,255,0.10)"
            : "rgba(255,255,255,0)",
        }}
        transition={
          prefersReduced ? { duration: 0 } : { duration: 0.5, ease: EASE_OUT }
        }
        style={{ borderBottomWidth: 1, borderBottomStyle: "solid" }}>
        <div className='px-5 sm:px-6 lg:px-12 xl:px-16 grid grid-cols-[1fr_auto_1fr] items-center gap-3 min-h-14 max-w-480 mx-auto'>
          {/* ─── Left: Navigation ─── */}
          <div className='flex min-w-0 items-center gap-8 justify-start'>
            {/* Mobile hamburger */}
            <div className='lg:hidden'>
              <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetTrigger asChild>
                  <button
                    type='button'
                    className={`p-1 transition-colors duration-300 ${iconCls}`}
                    aria-label='Open menu'>
                    <Menu size={22} strokeWidth={2} />
                  </button>
                </SheetTrigger>
                <SheetContent
                  side='left'
                  className='w-80 max-w-[85vw] bg-[var(--mach-ink)] border-r border-white/10 p-0 text-white'>
                  <div className='flex flex-col h-full'>
                    <div className='px-7 py-7 border-b border-white/10 w-full flex justify-center'>
                      <HeaderLogo
                        variant='mobile'
                        onClick={handleCloseSheet}
                        textClassName='text-lg font-black tracking-[0.22em] text-white uppercase'
                      />
                    </div>

                    <div className='px-7 py-8 flex-1 overflow-y-auto'>
                      {/* Primary nav — mirrors the desktop links */}
                      {NAV_LINKS.filter(
                        (l) => !l.href.startsWith("/#categories"),
                      ).map((link) => (
                        <Link
                          key={`${link.label}-${link.href}`}
                          href={link.href}
                          onClick={handleCloseSheet}
                          className={sheetLinkCls}>
                          {/* Leading slot keeps CMS links aligned with the
                              icon-led items below. */}
                          <span
                            aria-hidden='true'
                            className='flex w-4 justify-center'>
                            <span className='h-1 w-1 rounded-full bg-[var(--mach-accent)]' />
                          </span>
                          {link.label}
                        </Link>
                      ))}

                      {/* Categories — collapsible drop-down */}
                      <div className='mt-1'>
                        <button
                          type='button'
                          onClick={() => setIsCategoriesOpen((prev) => !prev)}
                          aria-expanded={isCategoriesOpen}
                          className='w-full flex items-center justify-between py-3.5 text-[12px] tracking-[0.18em] uppercase font-semibold text-white/70 hover:text-[var(--mach-accent)] transition-colors'>
                          <span className='flex items-center gap-3'>
                            <Tag className='w-4 h-4' /> Categories
                          </span>
                          <ChevronDown
                            className={`w-4 h-4 transition-transform duration-300 ${isCategoriesOpen ? "rotate-180" : ""}`}
                          />
                        </button>
                        {isCategoriesOpen && (
                          <div className='mt-1 mb-3 pl-6 flex flex-col gap-3 border-l border-white/10'>
                            {categories.length === 0 ? (
                              <span className='text-[11px] text-white/30 tracking-[0.14em] uppercase py-1'>
                                Categories coming soon
                              </span>
                            ) : (
                              categories.map((c) => (
                                <Link
                                  key={c.id}
                                  href={`/categories/${c.slug}`}
                                  onClick={handleCloseSheet}
                                  className='text-[11px] tracking-[0.16em] uppercase text-white/50 hover:text-white transition-colors py-0.5'>
                                  {c.name}
                                </Link>
                              ))
                            )}
                          </div>
                        )}
                      </div>

                      {/* Offers */}
                      <Link
                        href='/shop?section=offers'
                        onClick={handleCloseSheet}
                        className={sheetLinkCls}>
                        <Flame className='w-4 h-4' /> Offers
                      </Link>

                      {/* New Arrivals */}
                      <Link
                        href='/shop?section=newarrivals'
                        onClick={handleCloseSheet}
                        className={sheetLinkCls}>
                        <Sparkles className='w-4 h-4' /> New Drops
                      </Link>

                      {/* Search — mobile entry point */}
                      <Link
                        href='/search'
                        onClick={handleCloseSheet}
                        className={`${sheetLinkCls} mb-6`}>
                        <Search className='w-4 h-4' /> Search
                      </Link>

                      {session && (
                        <div className='border-t border-white/10 pt-7 mb-6 space-y-5'>
                          <Link
                            href='/account'
                            className='flex items-center gap-2.5 text-[11px] tracking-[0.18em] uppercase text-white/50 hover:text-white transition-colors'
                            onClick={handleCloseSheet}>
                            <User className='w-3.5 h-3.5' /> My Account
                          </Link>
                          <Link
                            href='/account?tab=orders'
                            className='flex items-center gap-2.5 text-[11px] tracking-[0.18em] uppercase text-white/50 hover:text-white transition-colors'
                            onClick={handleCloseSheet}>
                            <Package className='w-3.5 h-3.5' /> Orders
                          </Link>
                          <Link
                            href='/account?tab=wishlist'
                            className='flex items-center gap-2.5 text-[11px] tracking-[0.18em] uppercase text-white/50 hover:text-white transition-colors'
                            onClick={handleCloseSheet}>
                            <Heart className='w-3.5 h-3.5' /> Wishlist
                          </Link>
                          {(session.role === "admin" ||
                            session.role === "superadmin") && (
                            <Link
                              href='/dashboard'
                              className='flex items-center gap-2.5 text-[11px] tracking-[0.18em] uppercase text-white/50 hover:text-white transition-colors'
                              onClick={handleCloseSheet}>
                              <LayoutDashboard className='w-3.5 h-3.5' />{" "}
                              Dashboard
                            </Link>
                          )}
                          <button
                            onClick={() => {
                              logout();
                              handleCloseSheet();
                            }}
                            className='flex items-center gap-2.5 text-[11px] tracking-[0.18em] uppercase text-red-400 hover:text-red-300 transition-colors'
                            type='button'>
                            <LogOut className='w-3.5 h-3.5' /> Sign Out
                          </button>
                        </div>
                      )}
                    </div>

                    <SheetTitle className='sr-only'>Navigation menu</SheetTitle>
                    <div className='mt-auto border-t border-white/10 px-7 py-5'>
                      <p className='text-[9px] text-white/25 tracking-[0.28em] uppercase font-semibold'>
                        {STORE_NAME}
                      </p>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            {/* Desktop nav links */}
            <nav className='hidden lg:flex gap-8 xl:gap-10'>
              {NAV_LINKS.map((link) => (
                <Link
                  key={`${link.label}-${link.href}`}
                  href={link.href}
                  className={`text-[11px] tracking-[0.18em] uppercase font-semibold transition-colors duration-300 ${linkCls} focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--mach-accent)] focus-visible:ring-offset-4 focus-visible:ring-offset-transparent rounded-sm`}>
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* ─── Center: Logo ─── */}
          <div className='flex min-w-0 justify-center px-2'>
            <HeaderLogo
              variant='desktop'
              textClassName='block text-center text-[12px] min-[420px]:text-[14px] sm:text-[17px] lg:text-[20px] xl:text-[22px] font-black leading-none tracking-[0.06em] sm:tracking-[0.13em] lg:tracking-[0.18em] uppercase !text-white sm:whitespace-nowrap'
            />
          </div>

          {/* ─── Right: Icons (Search · Account · Bag) ─── */}
          <div className='flex min-w-0 items-center gap-3 sm:gap-4 justify-end'>
            {/* Search */}
            <Link
              href='/search'
              className={`p-1 transition-colors duration-300 hidden sm:block ${iconCls}`}
              aria-label='Search products'>
              <Search size={18} strokeWidth={2} />
            </Link>

            {/* Account icon — dropdown for logged-in users */}
            {session ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type='button'
                    className='p-1 transition-colors duration-300 hidden lg:flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-bold bg-[var(--mach-accent)] text-[var(--mach-on-accent)]'
                    aria-label='Account menu'>
                    {session.name ? (
                      session.name.charAt(0).toUpperCase()
                    ) : (
                      <User size={14} />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-52 z-[10001]'>
                  <div className='px-3 py-2 border-b border-stone-100'>
                    <p className='text-sm font-medium text-stone-900 truncate'>
                      {session.name || "Account"}
                    </p>
                    <p className='text-xs text-stone-400 truncate'>
                      {session.email}
                    </p>
                  </div>
                  <DropdownMenuItem asChild>
                    <Link
                      href='/account'
                      className='flex items-center gap-2.5 cursor-pointer'>
                      <User className='w-4 h-4 text-stone-500' /> My Account
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      href='/account?tab=orders'
                      className='flex items-center gap-2.5 cursor-pointer'>
                      <Package className='w-4 h-4 text-stone-500' /> Orders
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      href='/account?tab=wishlist'
                      className='flex items-center gap-2.5 cursor-pointer'>
                      <Heart className='w-4 h-4 text-stone-500' /> Wishlist
                    </Link>
                  </DropdownMenuItem>
                  {(session.role === "admin" ||
                    session.role === "superadmin") && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link
                          href='/dashboard'
                          className='flex items-center gap-2.5 cursor-pointer'>
                          <LayoutDashboard className='w-4 h-4 text-stone-500' />{" "}
                          Dashboard
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={logout}
                    className='flex items-center gap-2.5 cursor-pointer text-red-600 focus:text-red-600'>
                    <LogOut className='w-4 h-4' /> Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link
                href='/login'
                className={`p-1 transition-colors duration-300 hidden lg:block ${iconCls}`}
                aria-label='Sign in'>
                <User size={18} strokeWidth={2} />
              </Link>
            )}

            {/* Cart */}
            <Link
              href='/cart'
              className={`p-1 relative transition-colors duration-300 ${iconCls}`}
              aria-label='Shopping bag'>
              <ShoppingBag size={18} strokeWidth={2} />
              {totalItems > 0 && (
                <span className='absolute -top-1 -right-1.5 inline-flex items-center justify-center min-w-4 h-4 px-1 text-[9px] font-bold leading-none rounded-full bg-[var(--mach-accent)] text-[var(--mach-on-accent)]'>
                  {totalItems}
                </span>
              )}
            </Link>

            {/* Mobile user icon */}
            {session ? (
              <Link
                href='/account'
                className='p-0.5 lg:hidden flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-bold bg-[var(--mach-accent)] text-[var(--mach-on-accent)]'
                aria-label='Account'>
                {session.name ? (
                  session.name.charAt(0).toUpperCase()
                ) : (
                  <User size={14} />
                )}
              </Link>
            ) : (
              <Link
                href='/login'
                className={`p-1 lg:hidden transition-colors duration-300 ${iconCls}`}
                aria-label='Sign in'>
                <User size={18} strokeWidth={2} />
              </Link>
            )}
          </div>
        </div>
      </motion.nav>
    </>
  );
}
