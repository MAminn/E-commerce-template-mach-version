import {
  DEFAULT_HOMEPAGE_CONTENT,
  type HomepageUgcContent,
  type UgcVideoItem,
} from "./homepage-content";

/**
 * The UGC / "Judge Me" section's rules, written once.
 *
 * The merge layer, Homepage Admin, Section Order's status badge and the
 * storefront all need to agree on two questions — what a stored `ugc` blob
 * means, and whether the section puts anything on the page — so both answers
 * live here as pure functions rather than being restated in four places.
 */

/**
 * What the UGC video picker offers.
 *
 * Narrower than the shared upload endpoint, which also takes QuickTime. A
 * `.mov` straight off a phone is usually HEVC, which Chrome and Firefox on
 * most desktops and Android devices cannot decode — the owner would see it
 * play in their own Safari and a black frame everywhere else. MP4 (H.264) and
 * WebM play in every current browser.
 */
export const UGC_VIDEO_ACCEPT = "video/mp4,video/webm";

/** Filename prefixes, so UGC uploads stay identifiable on disk. */
export const UGC_VIDEO_UPLOAD_PREFIX = "ugc";
export const UGC_POSTER_UPLOAD_PREFIX = "ugc-poster";

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * A stored `ugc` blob, whatever its vintage, as the current shape.
 *
 * Picks the known fields rather than spreading the blob, so the keys of the
 * old reserved stub (`title`, `subtitle`, `reviewIds`) do not ride along into
 * Homepage Admin state. Defaults fill whatever the blob predates — a store
 * that saved the stub gets the "JUDGE ME" heading, not an empty one — while a
 * heading the owner deliberately cleared stays cleared.
 */
export function normalizeUgcContent(
  stored: Partial<HomepageUgcContent> | Record<string, unknown> | undefined,
): HomepageUgcContent {
  const base = DEFAULT_HOMEPAGE_CONTENT.ugc as HomepageUgcContent;
  const raw = (stored ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(raw.items) ? raw.items : [];

  const items: UgcVideoItem[] = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const id = text(item.id);
    if (!id) continue;
    items.push({
      id,
      videoUrl: text(item.videoUrl) ?? "",
      posterUrl: text(item.posterUrl),
      creatorName: text(item.creatorName),
      creatorHandle: text(item.creatorHandle),
      caption: text(item.caption),
    });
  }

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    eyebrow: text(raw.eyebrow) ?? base.eyebrow,
    heading: text(raw.heading) ?? base.heading,
    subheading: text(raw.subheading) ?? base.subheading,
    items,
  };
}

/**
 * The videos the storefront can actually play, in CMS order.
 *
 * A row the owner added but has not uploaded into yet is part of their draft,
 * not part of the page: it stays in Homepage Admin and is skipped here.
 */
export function renderableUgcItems(
  content: HomepageUgcContent | undefined,
): UgcVideoItem[] {
  return (content?.items ?? []).filter((item) =>
    Boolean(item?.videoUrl?.trim()),
  );
}

/**
 * Whether the section puts anything on the page.
 *
 * Switched on *and* at least one playable video. Everything else — switched
 * off, switched on with nothing uploaded — renders nothing at all, never an
 * empty band or a "coming soon".
 */
export function ugcSectionRenders(
  content: HomepageUgcContent | undefined,
): boolean {
  return Boolean(content?.enabled) && renderableUgcItems(content).length > 0;
}

/**
 * A creator handle as the storefront shows it: one leading "@", or nothing.
 *
 * Owners paste handles both ways ("@mach.athlete", "mach.athlete"); storing
 * what they typed and normalising at render means neither shows "@@".
 */
export function formatUgcHandle(raw: string | undefined): string {
  const handle = (raw ?? "").trim().replace(/^@+/, "").trim();
  return handle ? `@${handle}` : "";
}

/** A new, empty row for Homepage Admin. */
export function createUgcItem(id: string): UgcVideoItem {
  return {
    id,
    videoUrl: "",
    posterUrl: "",
    creatorName: "",
    creatorHandle: "",
    caption: "",
  };
}

/** Applies a partial edit to one row, by id. */
export function patchUgcItem(
  items: UgcVideoItem[],
  id: string,
  patch: Partial<UgcVideoItem>,
): UgcVideoItem[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

/** Removes one row, by id. */
export function removeUgcItem(
  items: UgcVideoItem[],
  id: string,
): UgcVideoItem[] {
  return items.filter((item) => item.id !== id);
}

/** Moves one row up (-1) or down (+1); a move past either end is a no-op. */
export function moveUgcItem(
  items: UgcVideoItem[],
  id: string,
  delta: -1 | 1,
): UgcVideoItem[] {
  const index = items.findIndex((item) => item.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as UgcVideoItem);
  return next;
}
