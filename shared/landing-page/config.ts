import type {
  MediaSlot,
  TextAlign,
  TextTheme,
  TextVerticalAlign,
} from "#root/shared/types/homepage-content";

/**
 * Landing 2 — the one fixed marketing landing page.
 *
 * There is exactly one page, at one URL, built once in code. Nothing here
 * creates, names or routes pages: the dashboard edits the content of this
 * page and nothing else. The content lives in
 * `store_settings.landing_page_config`; a NULL or partial row inherits the
 * defaults below, so new fields never need a data migration.
 *
 * Products are stored as an ordered list of existing catalogue ids, never as
 * copies. Name, photos, price, discount and stock are read from the catalogue
 * on every request, so the page cannot drift from it.
 */

/** The page's permanent public URL. Not configurable, by design. */
export const LANDING_PAGE_PATH = "/landing-2";

/** Where the page's content is managed. */
export const LANDING_PAGE_DASHBOARD_PATH = "/dashboard/landing-2";

/**
 * Streamed hero-video uploads for this page. The homepage CMS route is
 * admin-only; this one runs the same handler with the editor roles below.
 */
export const LANDING_MEDIA_VIDEO_ENDPOINT = "/api/landing-2/media/video";

/**
 * Roles that may edit this page's content.
 *
 * `media_buyer` exists for this page alone. Every other admin gate in the
 * codebase allow-lists `admin`/`superadmin` explicitly, so this role is
 * refused everywhere this list is not consulted.
 */
export const LANDING_PAGE_EDITOR_ROLES = [
  "admin",
  "superadmin",
  "media_buyer",
] as const;

export function canEditLandingPage(role: string | null | undefined): boolean {
  return (LANDING_PAGE_EDITOR_ROLES as readonly string[]).includes(role ?? "");
}

/** Where a signed-in account lands after login, or null for the storefront. */
export function dashboardHomeForRole(
  role: string | null | undefined,
): string | null {
  if (role === "admin" || role === "superadmin") return "/dashboard";
  if (role === "media_buyer") return LANDING_PAGE_DASHBOARD_PATH;
  return null;
}

export const LANDING_TITLE_MAX_LENGTH = 120;
export const LANDING_SUBTITLE_MAX_LENGTH = 300;
export const LANDING_CTA_TEXT_MAX_LENGTH = 40;
export const LANDING_LINK_MAX_LENGTH = 500;
export const LANDING_PRODUCTS_TITLE_MAX_LENGTH = 80;
export const LANDING_ALT_MAX_LENGTH = 200;
/** Enough for any campaign; small enough that the page stays fast. */
export const LANDING_MAX_PRODUCTS = 24;

/** The anchor the products section carries, and the CTA's default target. */
export const LANDING_PRODUCTS_ANCHOR = "products";

export interface LandingPageHero {
  /** Image or video background — the same slot every Mach visual uses. */
  media: MediaSlot;
  title: string;
  subtitle: string;
  /** Empty text = no button. */
  ctaText: string;
  ctaLink: string;
  align: TextAlign;
  verticalAlign: TextVerticalAlign;
  textTheme: TextTheme;
  /** Scrim strength over the media, 0-100. */
  overlayOpacity: number;
}

export interface LandingPageSettings {
  hero: LandingPageHero;
  /** Optional heading above the products. Empty = no heading. */
  productsTitle: string;
  /** Existing catalogue product ids, in display order. */
  productIds: string[];
}

export const DEFAULT_LANDING_PAGE_SETTINGS: LandingPageSettings = {
  hero: {
    media: {
      kind: "image",
      desktopUrl: "",
      mobileUrl: "",
      posterUrl: "",
      alt: "",
    },
    title: "Shop the collection",
    subtitle: "",
    ctaText: "Shop now",
    ctaLink: `#${LANDING_PRODUCTS_ANCHOR}`,
    align: "left",
    verticalAlign: "bottom",
    textTheme: "light",
    overlayOpacity: 45,
  },
  productsTitle: "",
  productIds: [],
};

/* ------------------------------------------------------------------ */
/*  Normalisation — whatever is stored becomes a complete value        */
/* ------------------------------------------------------------------ */

const ALIGNS: readonly TextAlign[] = ["left", "center", "right"];
const V_ALIGNS: readonly TextVerticalAlign[] = ["top", "middle", "bottom"];
const THEMES: readonly TextTheme[] = ["light", "dark"];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function clampPercent(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Unique, well-formed ids in their original order, capped. */
export function normalizeProductIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const id = raw.trim().toLowerCase();
    if (!UUID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length === LANDING_MAX_PRODUCTS) break;
  }
  return ids;
}

function normalizeMedia(value: unknown): MediaSlot {
  const fallback = DEFAULT_LANDING_PAGE_SETTINGS.hero.media;
  if (!value || typeof value !== "object") return { ...fallback };
  const v = value as Record<string, unknown>;
  const focal = v.focalPoint as { x?: unknown; y?: unknown } | undefined;
  return {
    kind: v.kind === "video" ? "video" : "image",
    desktopUrl: str(v.desktopUrl, ""),
    mobileUrl: str(v.mobileUrl, ""),
    posterUrl: str(v.posterUrl, ""),
    alt: str(v.alt, ""),
    ...(focal && typeof focal === "object"
      ? {
          focalPoint: {
            x: clampPercent(focal.x, 50),
            y: clampPercent(focal.y, 50),
          },
        }
      : {}),
  };
}

/** The stored row (null, partial or from an older shape) as a full value. */
export function normalizeLandingPageSettings(
  stored: unknown,
): LandingPageSettings {
  const d = DEFAULT_LANDING_PAGE_SETTINGS;
  if (!stored || typeof stored !== "object") {
    return structuredClone(d);
  }
  const s = stored as Record<string, unknown>;
  const h = (s.hero && typeof s.hero === "object" ? s.hero : {}) as Record<
    string,
    unknown
  >;
  return {
    hero: {
      media: normalizeMedia(h.media),
      title: str(h.title, d.hero.title),
      subtitle: str(h.subtitle, d.hero.subtitle),
      ctaText: str(h.ctaText, d.hero.ctaText),
      ctaLink: str(h.ctaLink, d.hero.ctaLink),
      align: oneOf(h.align, ALIGNS, d.hero.align),
      verticalAlign: oneOf(h.verticalAlign, V_ALIGNS, d.hero.verticalAlign),
      textTheme: oneOf(h.textTheme, THEMES, d.hero.textTheme),
      overlayOpacity: clampPercent(h.overlayOpacity, d.hero.overlayOpacity),
    },
    productsTitle: str(s.productsTitle, d.productsTitle),
    productIds: normalizeProductIds(s.productIds),
  };
}

/* ------------------------------------------------------------------ */
/*  Validation — what a save may contain                               */
/* ------------------------------------------------------------------ */

/**
 * Where the hero button may point: an anchor on this page, a path on this
 * site, or an http(s) address. Anything else — `javascript:`, `data:`,
 * protocol-relative `//host` — is refused, because the page is edited by an
 * account with less trust than an admin and the link is rendered as an href.
 */
export function isSafeLandingLink(raw: string): boolean {
  const link = raw.trim();
  if (link === "") return true;
  if (/\s/.test(link)) return false;
  if (link.startsWith("#")) return link.length > 1;
  if (link.startsWith("/")) return !link.startsWith("//") && !link.includes("\\");
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Where hero media may come from: this site's uploads (or any path on it), or
 * an https address. Same reasoning as links — the value lands in `src`.
 */
export function isSafeLandingMediaUrl(raw: string): boolean {
  const value = raw.trim();
  if (value === "") return true;
  if (/\s/.test(value)) return false;
  if (value.startsWith("/")) {
    return !value.startsWith("//") && !value.includes("\\");
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export type LandingPageField =
  | "title"
  | "subtitle"
  | "ctaText"
  | "ctaLink"
  | "media"
  | "productsTitle"
  | "productIds";

export type LandingPageValidation =
  | { ok: true; settings: LandingPageSettings }
  | { ok: false; errors: Partial<Record<LandingPageField, string>> };

/**
 * Strict check for a save. Returns the canonical value to store (trimmed,
 * ids de-duplicated) or one plain-language message per failing field — the
 * same messages the dashboard shows inline.
 */
export function validateLandingPageSettings(
  input: LandingPageSettings,
): LandingPageValidation {
  const errors: Partial<Record<LandingPageField, string>> = {};
  const hero = input.hero;

  const title = hero.title.trim();
  const subtitle = hero.subtitle.trim();
  const ctaText = hero.ctaText.trim();
  const ctaLink = hero.ctaLink.trim();
  const productsTitle = input.productsTitle.trim();

  if (!title) errors.title = "Enter a headline.";
  else if (title.length > LANDING_TITLE_MAX_LENGTH) {
    errors.title = `Keep the headline under ${LANDING_TITLE_MAX_LENGTH} characters.`;
  }
  if (subtitle.length > LANDING_SUBTITLE_MAX_LENGTH) {
    errors.subtitle = `Keep the subtitle under ${LANDING_SUBTITLE_MAX_LENGTH} characters.`;
  }
  if (ctaText.length > LANDING_CTA_TEXT_MAX_LENGTH) {
    errors.ctaText = `Keep the button text under ${LANDING_CTA_TEXT_MAX_LENGTH} characters.`;
  }
  if (ctaText && !ctaLink) {
    errors.ctaLink = "Add where the button goes, or clear the button text.";
  } else if (
    ctaLink.length > LANDING_LINK_MAX_LENGTH ||
    !isSafeLandingLink(ctaLink)
  ) {
    errors.ctaLink =
      "Use #products, a path on this site (e.g. /shop), or a full https:// address.";
  }
  if (productsTitle.length > LANDING_PRODUCTS_TITLE_MAX_LENGTH) {
    errors.productsTitle = `Keep the heading under ${LANDING_PRODUCTS_TITLE_MAX_LENGTH} characters.`;
  }

  const media = normalizeMedia(hero.media);
  const urls = [media.desktopUrl, media.mobileUrl ?? "", media.posterUrl ?? ""];
  if (
    urls.some(
      (u) => u.length > LANDING_LINK_MAX_LENGTH || !isSafeLandingMediaUrl(u),
    )
  ) {
    errors.media = "Upload the file, or paste a full https:// address.";
  } else if ((media.alt ?? "").length > LANDING_ALT_MAX_LENGTH) {
    errors.media = `Keep the alt text under ${LANDING_ALT_MAX_LENGTH} characters.`;
  }

  if (input.productIds.length > LANDING_MAX_PRODUCTS) {
    errors.productIds = `Pick at most ${LANDING_MAX_PRODUCTS} products.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    settings: {
      hero: {
        media: {
          ...media,
          desktopUrl: media.desktopUrl.trim(),
          mobileUrl: (media.mobileUrl ?? "").trim(),
          posterUrl: (media.posterUrl ?? "").trim(),
          alt: (media.alt ?? "").trim(),
        },
        title,
        subtitle,
        ctaText,
        ctaLink: ctaText ? ctaLink : "",
        align: oneOf(hero.align, ALIGNS, "left"),
        verticalAlign: oneOf(hero.verticalAlign, V_ALIGNS, "bottom"),
        textTheme: oneOf(hero.textTheme, THEMES, "light"),
        overlayOpacity: clampPercent(hero.overlayOpacity, 45),
      },
      productsTitle,
      productIds: normalizeProductIds(input.productIds),
    },
  };
}

/**
 * Selected products in the order the media buyer chose. The catalogue query
 * returns its own order; ids that no longer resolve (deleted, hidden) drop out.
 */
export function orderBySelection<T extends { id: string }>(
  items: readonly T[],
  ids: readonly string[],
): T[] {
  const byId = new Map(items.map((item) => [item.id.toLowerCase(), item]));
  return ids
    .map((id) => byId.get(id.toLowerCase()))
    .filter((item): item is T => Boolean(item));
}
