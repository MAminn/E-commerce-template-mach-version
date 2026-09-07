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
import { trpc } from "#root/shared/trpc/client";
import { EASE_OUT } from "../motion/motionPresets";
import { useLayoutSettings } from "#root/frontend/contexts/LayoutSettingsContext";
import { isPlaceholderLink } from "#root/shared/types/layout-settings";
import type { NavigationLink } from "#root/shared/types/layout-settings";
import { useNavbarMode } from "#root/components/globals/NavbarContext";
import { HeaderLogo } from "#root/components/globals/HeaderLogo";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface CategoryOption {
  id: string;
  name: string;
  slug: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

/**
 * Mach navigation.
 *
 * Commercial depth modelled on the reference supplement stores: real category
 * navigation rather than a single "shop" entry, with search / account / bag
 * always reachable.
 *
 * Every label and destination comes from Layout Settings — including the
 * category dropdowns, where a nav link flagged `isDropdown` pulls its children
 * from the category system. There is no hard-coded fallback nav: if the client
 * empties the navigation, the bar renders without links rather than silently
 * re-introducing labels they deleted.
 *
 * Transparent over the hero, solid on scroll. Both states sit on dark ground,
 * so the palette is white-on-black throughout with no mid-scroll inversion.
 */
export function MachNavbar() {
  const prefersReduced = useReducedMotion() ?? false;
  const mode = useNavbarMode();
  const isSolid = mode === "solid";
  const [isScrolled, setIsScrolled] = useState(isSolid);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [openMobileGroup, setOpenMobileGroup] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);

  const { session, logout } = useContext(AuthContext);
  const { totalItems } = useCart();
  const layoutSettings = useLayoutSettings();

  // Categories back the dropdown entries. The category system stays
  // authoritative for names and slugs; the CMS only decides which links exist.
  useEffect(() => {
    trpc.category.view
      .query()
      .then((res) => {
        if (res.success && Array.isArray(res.result)) {
          setCategories(
            (res.result as CategoryOption[]).map((c) => ({
              id: c.id,
              name: c.name,
              slug: c.slug,
            })),
          );
        }
      })
      .catch(() => {
        /* silent — dropdown entries just render as plain links */
      });
  }, []);

  const navLinks = layoutSettings.header.navigationLinks.filter(
    (l) => !isPlaceholderLink(l.url) || l.isDropdown,
  );

  const announcementEnabled = layoutSettings.header.announcementBarEnabled;
  const announcementText = layoutSettings.header.announcementBarText;

  /* ---- Scroll detection ----
   * Stay transparent over the hero; flip to solid once ~80% of the viewport
   * (roughly the hero height) has been scrolled past.
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

  const handleCloseSheet = () => setIsSheetOpen(false);

  const linkCls = "!text-white/75 hover:!text-white";
  const iconCls = "!text-white/75 hover:!text-white hover:bg-transparent";
  const sheetLinkCls =
    "flex items-center justify-between py-3.5 text-[12px] font-semibold uppercase tracking-[0.18em] text-white/70 transition-colors hover:text-white";

  /** Resolves the category children for a dropdown nav entry. */
  const dropdownItems = (link: NavigationLink): CategoryOption[] => {
    if (!link.categoryIds || link.categoryIds.length === 0) return categories;
    const byId = new Map(categories.map((c) => [c.id, c]));
    return link.categoryIds
      .map((id) => byId.get(id))
      .filter((c): c is CategoryOption => Boolean(c));
  };

  return (
    <>
      {/* Announcement bar — inverted block, no accent hue */}
      {announcementEnabled && announcementText && (
        <div className="w-full select-none bg-white px-6 py-2 text-center text-[10px] font-bold uppercase tracking-[0.28em] text-[var(--mach-ink)]">
          {announcementText}
        </div>
      )}

      <motion.nav
        aria-label="Main navigation"
        className={`w-full py-4 transition-[backdrop-filter] duration-500 lg:py-5 ${
          isScrolled ? "backdrop-blur-xl" : "backdrop-blur-0"
        }`}
        animate={{
          backgroundColor: isScrolled ? "rgba(0,0,0,0.94)" : "rgba(0,0,0,0)",
          borderBottomColor: isScrolled
            ? "rgba(255,255,255,0.12)"
            : "rgba(255,255,255,0)",
        }}
        transition={
          prefersReduced ? { duration: 0 } : { duration: 0.5, ease: EASE_OUT }
        }
        style={{ borderBottomWidth: 1, borderBottomStyle: "solid" }}>
        {/* Two layouts, one markup.
            Mobile is a three-column grid — hamburger, centred wordmark, icons.
            Desktop is a flex row with the wordmark on the LEFT: "Mach
            Supplements" is a long wordmark, and centring it between a
            five-item nav and the icon cluster puts the two on a collision
            course at ordinary widths. Left-aligning removes that whole class
            of bug and gives the nav the room a supplement store's navigation
            actually needs. */}
        <div className="mx-auto grid max-w-480 grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 sm:px-6 lg:px-12 xl:flex xl:gap-10 xl:px-16 2xl:gap-14 min-h-14">
          {/* ─── Hamburger — up to the desktop breakpoint ─── */}
          <div className="flex min-w-0 items-center justify-start gap-8 xl:hidden">
            {/* Mobile hamburger */}
            <div className="xl:hidden">
              <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className={`p-1 transition-colors duration-300 ${iconCls}`}
                    aria-label="Open menu">
                    <Menu size={22} strokeWidth={2} />
                  </button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-80 max-w-[85vw] border-r border-white/10 bg-[var(--mach-ink)] p-0 text-white">
                  <div className="flex h-full flex-col">
                    <div className="flex w-full justify-center border-b border-white/10 px-7 py-7">
                      <HeaderLogo
                        variant="mobile"
                        onClick={handleCloseSheet}
                        textClassName="text-lg font-black tracking-[0.22em] text-white uppercase"
                      />
                    </div>

                    <div className="flex-1 overflow-y-auto px-7 py-6">
                      {navLinks.map((link) => {
                        if (link.isDropdown) {
                          const items = dropdownItems(link);
                          const isOpen = openMobileGroup === link.id;
                          return (
                            <div key={link.id}>
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenMobileGroup(isOpen ? null : link.id)
                                }
                                aria-expanded={isOpen}
                                className={`${sheetLinkCls} w-full`}>
                                <span>{link.label}</span>
                                <ChevronDown
                                  className={`h-4 w-4 transition-transform duration-300 ${
                                    isOpen ? "rotate-180" : ""
                                  }`}
                                />
                              </button>
                              {isOpen && items.length > 0 && (
                                <div className="mb-3 mt-1 flex flex-col gap-3 border-l border-white/10 pl-5">
                                  {items.map((c) => (
                                    <Link
                                      key={c.id}
                                      href={`/categories/${c.slug}`}
                                      onClick={handleCloseSheet}
                                      className="py-0.5 text-[11px] uppercase tracking-[0.16em] text-white/50 transition-colors hover:text-white">
                                      {c.name}
                                    </Link>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        }

                        if (isPlaceholderLink(link.url)) return null;
                        return (
                          <Link
                            key={link.id}
                            href={link.url}
                            onClick={handleCloseSheet}
                            className={sheetLinkCls}>
                            <span>{link.label}</span>
                          </Link>
                        );
                      })}

                      <Link
                        href="/search"
                        onClick={handleCloseSheet}
                        className={`${sheetLinkCls} mt-2 border-t border-white/10 pt-5`}>
                        <span className="flex items-center gap-3">
                          <Search className="h-4 w-4" /> Search
                        </span>
                      </Link>

                      {session && (
                        <div className="mt-5 space-y-5 border-t border-white/10 pt-6">
                          <Link
                            href="/account"
                            className="flex items-center gap-2.5 text-[11px] uppercase tracking-[0.18em] text-white/50 transition-colors hover:text-white"
                            onClick={handleCloseSheet}>
                            <User className="h-3.5 w-3.5" /> My Account
                          </Link>
                          <Link
                            href="/account?tab=orders"
                            className="flex items-center gap-2.5 text-[11px] uppercase tracking-[0.18em] text-white/50 transition-colors hover:text-white"
                            onClick={handleCloseSheet}>
                            <Package className="h-3.5 w-3.5" /> Orders
                          </Link>
                          <Link
                            href="/account?tab=wishlist"
                            className="flex items-center gap-2.5 text-[11px] uppercase tracking-[0.18em] text-white/50 transition-colors hover:text-white"
                            onClick={handleCloseSheet}>
                            <Heart className="h-3.5 w-3.5" /> Wishlist
                          </Link>
                          {(session.role === "admin" ||
                            session.role === "superadmin") && (
                            <Link
                              href="/dashboard"
                              className="flex items-center gap-2.5 text-[11px] uppercase tracking-[0.18em] text-white/50 transition-colors hover:text-white"
                              onClick={handleCloseSheet}>
                              <LayoutDashboard className="h-3.5 w-3.5" />{" "}
                              Dashboard
                            </Link>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              logout();
                              handleCloseSheet();
                            }}
                            className="flex items-center gap-2.5 text-[11px] uppercase tracking-[0.18em] text-red-400 transition-colors hover:text-red-300">
                            <LogOut className="h-3.5 w-3.5" /> Sign Out
                          </button>
                        </div>
                      )}
                    </div>

                    <SheetTitle className="sr-only">Navigation menu</SheetTitle>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>

          {/* ─── Logo: centred on mobile, leading the row on desktop ─── */}
          <div className="flex min-w-0 justify-center px-2 xl:order-first xl:shrink-0 xl:justify-start xl:px-0">
            <HeaderLogo
              variant="desktop"
              textClassName="block text-center text-[12px] min-[420px]:text-[14px] sm:text-[17px] lg:text-[19px] font-black leading-none tracking-[0.06em] sm:tracking-[0.13em] lg:tracking-[0.14em] uppercase !text-white sm:whitespace-nowrap xl:text-left"
            />
          </div>

          {/* ─── Desktop nav ───
              Takes the remaining space between the wordmark and the icons.
              Only from `xl`: below ~1280px a long wordmark plus five labels
              plus the icon cluster genuinely does not fit on one line, so
              tablets get the drawer instead of a cramped or clipped bar.
              Labels never wrap — a two-line nav item beside a single-line
              wordmark reads as broken rather than dense. */}
          <nav className="hidden min-w-0 xl:flex xl:flex-1 xl:items-center xl:gap-7 2xl:gap-9">
            {navLinks.map((link) => {
              if (link.isDropdown) {
                const items = dropdownItems(link);
                return (
                  <div key={link.id} className="group relative">
                    <button
                      type="button"
                      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors duration-300 xl:text-[11px] xl:tracking-[0.18em] ${linkCls}`}>
                      {link.label}
                      <ChevronDown className="h-3 w-3 transition-transform duration-300 group-hover:rotate-180" />
                    </button>
                    {items.length > 0 && (
                      <div className="invisible absolute left-0 top-full z-50 min-w-56 border border-white/10 bg-[var(--mach-ink)] pt-0 opacity-0 shadow-2xl transition-[opacity,visibility] duration-200 group-hover:visible group-hover:opacity-100">
                        <div className="py-2">
                          {items.map((c) => (
                            <Link
                              key={c.id}
                              href={`/categories/${c.slug}`}
                              className="block px-5 py-2.5 text-[11px] uppercase tracking-[0.16em] text-white/60 transition-colors hover:bg-white/5 hover:text-white">
                              {c.name}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              if (isPlaceholderLink(link.url)) return null;
              return (
                <Link
                  key={link.id}
                  href={link.url}
                  className={`shrink-0 whitespace-nowrap rounded-sm text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-transparent xl:text-[11px] xl:tracking-[0.18em] ${linkCls}`}>
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* ─── Right: search · account · bag ─── */}
          <div className="flex min-w-0 items-center justify-end gap-3 sm:gap-4 xl:shrink-0">
            <Link
              href="/search"
              className={`hidden p-1 transition-colors duration-300 sm:block ${iconCls}`}
              aria-label="Search products">
              <Search size={18} strokeWidth={2} />
            </Link>

            {session ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="hidden h-7 w-7 items-center justify-center rounded-full bg-white p-1 text-[11px] font-bold text-[var(--mach-ink)] transition-colors duration-300 xl:flex"
                    aria-label="Account menu">
                    {session.name ? (
                      session.name.charAt(0).toUpperCase()
                    ) : (
                      <User size={14} />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="z-10001 w-52">
                  <div className="border-b border-stone-100 px-3 py-2">
                    <p className="truncate text-sm font-medium text-stone-900">
                      {session.name || "Account"}
                    </p>
                    <p className="truncate text-xs text-stone-400">
                      {session.email}
                    </p>
                  </div>
                  <DropdownMenuItem asChild>
                    <Link
                      href="/account"
                      className="flex cursor-pointer items-center gap-2.5">
                      <User className="h-4 w-4 text-stone-500" /> My Account
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      href="/account?tab=orders"
                      className="flex cursor-pointer items-center gap-2.5">
                      <Package className="h-4 w-4 text-stone-500" /> Orders
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      href="/account?tab=wishlist"
                      className="flex cursor-pointer items-center gap-2.5">
                      <Heart className="h-4 w-4 text-stone-500" /> Wishlist
                    </Link>
                  </DropdownMenuItem>
                  {(session.role === "admin" ||
                    session.role === "superadmin") && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link
                          href="/dashboard"
                          className="flex cursor-pointer items-center gap-2.5">
                          <LayoutDashboard className="h-4 w-4 text-stone-500" />{" "}
                          Dashboard
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={logout}
                    className="flex cursor-pointer items-center gap-2.5 text-red-600 focus:text-red-600">
                    <LogOut className="h-4 w-4" /> Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link
                href="/login"
                className={`hidden p-1 transition-colors duration-300 xl:block ${iconCls}`}
                aria-label="Sign in">
                <User size={18} strokeWidth={2} />
              </Link>
            )}

            <Link
              href="/cart"
              className={`relative p-1 transition-colors duration-300 ${iconCls}`}
              aria-label="Shopping bag">
              <ShoppingBag size={18} strokeWidth={2} />
              {totalItems > 0 && (
                <span className="absolute -right-1.5 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[9px] font-bold leading-none text-[var(--mach-ink)]">
                  {totalItems}
                </span>
              )}
            </Link>

            {session ? (
              <Link
                href="/account"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white p-0.5 text-[11px] font-bold text-[var(--mach-ink)] xl:hidden"
                aria-label="Account">
                {session.name ? (
                  session.name.charAt(0).toUpperCase()
                ) : (
                  <User size={14} />
                )}
              </Link>
            ) : (
              <Link
                href="/login"
                className={`p-1 transition-colors duration-300 xl:hidden ${iconCls}`}
                aria-label="Sign in">
                <User size={18} strokeWidth={2} />
              </Link>
            )}
          </div>
        </div>
      </motion.nav>
    </>
  );
}
