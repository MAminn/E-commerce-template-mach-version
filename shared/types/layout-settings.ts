/**
 * Layout Settings Types
 * CMS-driven header and footer configuration
 */

// ─── Placeholder destinations ───────────────────────────────────────────────

/**
 * Sentinel URL for a navigation/footer entry whose destination hasn't been
 * built yet. Chrome components render these as inert, visibly-pending items
 * instead of links that lead nowhere, so we never ship a misleading href.
 * Swap the url in Dashboard → Layout Settings once the real page exists.
 */
export const PLACEHOLDER_LINK_URL = "#soon";

/** True when a link's destination is a not-yet-built placeholder. */
export function isPlaceholderLink(url: string | undefined | null): boolean {
  const trimmed = (url ?? "").trim();
  return trimmed === "" || trimmed === "#" || trimmed === PLACEHOLDER_LINK_URL;
}

// ─── Navigation Link ────────────────────────────────────────────────────────

export interface NavigationLink {
  id: string;
  label: string;
  labelAr?: string;
  url: string;
  openInNewTab?: boolean;
  /** When true, link renders as a dropdown showing selected categories */
  isDropdown?: boolean;
  /** Category IDs to show in the dropdown */
  categoryIds?: string[];
}

// ─── Social Link ─────────────────────────────────────────────────────────────

export type SocialPlatform =
  | "facebook"
  | "instagram"
  | "tiktok"
  | "twitter"
  | "youtube"
  | "pinterest"
  | "linkedin";

export interface SocialLink {
  id: string;
  platform: SocialPlatform;
  url: string;
}

// ─── Footer Link Group ──────────────────────────────────────────────────────

export interface FooterLinkGroup {
  id: string;
  title: string;
  titleAr?: string;
  links: Array<{
    id: string;
    label: string;
    labelAr?: string;
    url: string;
  }>;
}

// ─── Navbar Style ────────────────────────────────────────────────────────────

export type NavbarStyle = "default" | "editorial" | "minimal";

// ─── Footer Style ────────────────────────────────────────────────────────────

export type FooterStyle = "default" | "editorial";

// ─── Header Settings ────────────────────────────────────────────────────────

// ─── Logo Size Settings ─────────────────────────────────────────────────────

export interface LogoSizeSettings {
  desktopWidth: number;
  desktopMaxHeight: number;
  mobileWidth: number;
  mobileMaxHeight: number;
}

export const DEFAULT_LOGO_SIZE: LogoSizeSettings = {
  desktopWidth: 140,
  desktopMaxHeight: 48,
  mobileWidth: 100,
  mobileMaxHeight: 36,
};

export const DEFAULT_FOOTER_LOGO_SIZE: LogoSizeSettings = {
  desktopWidth: 120,
  desktopMaxHeight: 40,
  mobileWidth: 100,
  mobileMaxHeight: 36,
};

// ─── Header Settings ────────────────────────────────────────────────────────

export interface HeaderSettings {
  logoUrl: string;
  logoSize: LogoSizeSettings;
  logoText: string;
  tagline: string;
  announcementBarEnabled: boolean;
  announcementBarText: string;
  navigationLinks: NavigationLink[];
  navbarStyle: NavbarStyle;
  /** Scrolling marquee for minimal template */
  marqueeEnabled?: boolean;
  marqueeText?: string;
  marqueeTextAr?: string;
  /** Marquee background color (hex). Defaults to white when unset. */
  marqueeBackgroundColor?: string;
  /** Marquee text color (hex). Defaults to black when unset. */
  marqueeTextColor?: string;
  /** Promo text line for product detail page (minimal template) */
  promoText?: string;
  promoTextAr?: string;
  /** Contact email shown in the info bar (minimal template) */
  contactEmail?: string;
}

// ─── Footer Settings ────────────────────────────────────────────────────────

export interface FooterSettings {
  logoUrl: string;
  logoText: string;
  logoTextAr?: string;
  logoSize: LogoSizeSettings;
  description: string;
  descriptionAr?: string;
  copyright: string;
  copyrightAr?: string;
  showNewsletter: boolean;
  footerStyle: FooterStyle;
  footerLinkGroups: FooterLinkGroup[];
  socialLinks: SocialLink[];
  /** Contact phone number shown in footer (minimal template) */
  contactPhone?: string;
  /** Contact email shown in footer (minimal template) */
  contactEmail?: string;
}

// ─── Combined Layout Settings ───────────────────────────────────────────────

/**
 * Per-locale translation overrides set by the admin via CMS.
 * Keys match the static `translations.ts` dictionary.
 */
export interface TranslationOverrides {
  en?: Record<string, string>;
  ar?: Record<string, string>;
}

export interface LayoutSettings {
  header: HeaderSettings;
  footer: FooterSettings;
  siteTitle?: string;
  faviconUrl?: string;
  /** Dedicated social-share preview image (og:image / Twitter card). Should be a 1200x630 banner — never reuse the header logo for this. */
  shareImageUrl?: string;
  translationOverrides?: TranslationOverrides;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  siteTitle: "",
  faviconUrl: "",
  shareImageUrl: "",
  translationOverrides: { en: {}, ar: {} },
  header: {
    logoUrl: "",
    logoSize: { ...DEFAULT_LOGO_SIZE },
    logoText: "",
    tagline: "",
    announcementBarEnabled: false,
    announcementBarText: "",
    // Product-first navigation, matching how the storefront actually sells:
    // broad groups and merchandising entry points, not a category taxonomy.
    // There is deliberately no category dropdown — the catalog is three broad
    // groups, and a dropdown of them is worse than the groups themselves.
    //
    // Every destination is a route that exists. The two group links are
    // pre-pointed at the slugs the production catalog is expected to use;
    // whoever creates those categories should confirm the slugs, or repoint
    // the links, in Dashboard → Layout Settings. Nothing here is read by the
    // storefront directly — these are only the values a store starts with.
    navigationLinks: [
      { id: "nav-shop", label: "Shop", url: "/shop" },
      { id: "nav-stacks", label: "Stacks", url: "/shop?category=stacks-bundles" },
      {
        id: "nav-new-drops",
        label: "New Drops",
        url: "/shop?section=newarrivals",
      },
      { id: "nav-gym-gear", label: "Gym Gear", url: "/shop?category=gym-gear" },
      { id: "nav-about", label: "About", url: "/about-us" },
    ],
    navbarStyle: "default",
    marqueeEnabled: false,
    marqueeText: "",
    marqueeTextAr: "",
    marqueeBackgroundColor: "",
    marqueeTextColor: "",
    promoText: "",
    promoTextAr: "",
    contactEmail: "",
  },
  footer: {
    logoUrl: "",
    logoText: "",
    logoSize: { ...DEFAULT_FOOTER_LOGO_SIZE },
    description:
      "Sports nutrition engineered for serious training. Tested, trusted, and built to fuel the next level.",
    copyright: "",
    showNewsletter: true,
    footerStyle: "default",
    // Four groups, matching the commercial depth of a mature supplement
    // storefront. Only routes that exist are linked; anything not built yet
    // carries PLACEHOLDER_LINK_URL and renders as an inert "soon" label rather
    // than a link that goes nowhere. Swap those urls in Layout Settings once
    // the pages ship.
    footerLinkGroups: [
      {
        id: "shop",
        title: "Shop",
        links: [
          { id: "shop-all", label: "Shop All", url: "/shop" },
          {
            id: "stacks",
            label: "Stacks & Bundles",
            url: "/shop?category=stacks-bundles",
          },
          {
            id: "new-drops",
            label: "New Drops",
            url: "/shop?section=newarrivals",
          },
          { id: "gym-gear", label: "Gym Gear", url: "/shop?category=gym-gear" },
          { id: "offers", label: "Offers", url: "/shop?section=offers" },
        ],
      },
      {
        id: "company",
        title: "Company",
        links: [
          { id: "about", label: "About Mach", url: "/about-us" },
          { id: "contact", label: "Contact", url: "/contact" },
        ],
      },
      {
        id: "support",
        title: "Help",
        links: [
          {
            id: "shipping",
            label: "Shipping & Returns",
            url: "/return-policy",
          },
          { id: "faq", label: "FAQ", url: PLACEHOLDER_LINK_URL },
        ],
      },
      {
        id: "account",
        title: "Account",
        links: [
          { id: "my-account", label: "My Account", url: "/account" },
          { id: "orders", label: "Orders", url: "/orders" },
          { id: "cart", label: "Cart", url: "/cart" },
        ],
      },
    ],
    socialLinks: [
      { id: "facebook", platform: "facebook", url: "#" },
      { id: "instagram", platform: "instagram", url: "#" },
      { id: "tiktok", platform: "tiktok", url: "#" },
    ],
  },
};

// ─── Template-scoped defaults ───────────────────────────────────────────────

/**
 * Chrome (navbar/footer style) that each landing template expects when the
 * merchant has never saved layout settings for it.
 *
 * This exists so a template can ship with its own header/footer architecture
 * without changing the *global* default — templates not listed here keep the
 * "default" chrome exactly as before, and an explicit admin choice always wins
 * because a stored row is merged on top of these values.
 */
const TEMPLATE_CHROME_DEFAULTS: Record<
  string,
  { navbarStyle: NavbarStyle; footerStyle: FooterStyle }
> = {
  "landing-editorial": { navbarStyle: "editorial", footerStyle: "editorial" },
};

/**
 * Base layout settings for a given landing template.
 *
 * Use this instead of DEFAULT_LAYOUT_SETTINGS wherever defaults are resolved
 * for a specific template (SSR injection, tRPC read, client fallback).
 */
export function getDefaultLayoutSettings(templateId?: string): LayoutSettings {
  const chrome = templateId ? TEMPLATE_CHROME_DEFAULTS[templateId] : undefined;
  if (!chrome) return DEFAULT_LAYOUT_SETTINGS;

  return {
    ...DEFAULT_LAYOUT_SETTINGS,
    header: {
      ...DEFAULT_LAYOUT_SETTINGS.header,
      navbarStyle: chrome.navbarStyle,
    },
    footer: {
      ...DEFAULT_LAYOUT_SETTINGS.footer,
      footerStyle: chrome.footerStyle,
    },
  };
}
