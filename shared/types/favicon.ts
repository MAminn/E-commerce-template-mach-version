/**
 * Resolving the browser-tab icon from CMS layout settings.
 *
 * Pulled out of `pages/+Head.tsx` so the one decision that matters — which
 * href is rendered, and what MIME type is declared for it — is a pure function
 * with tests around it rather than a nested ternary inside a head component.
 */

/**
 * Extension → MIME type for the formats that can reach `faviconUrl`.
 *
 * `webp` is in here because it has to be: the layout-image uploader ran every
 * raster favicon through sharp and wrote a `.webp`, so stores that set a
 * favicon before that changed have `.webp` URLs persisted in their layout
 * settings, and those still have to render with a truthful type.
 */
const FAVICON_MIME_TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  avif: "image/avif",
};

/**
 * Lowercased file extension of a URL, ignoring any query string or fragment.
 *
 * `favicon-abc.png?v=2` is a PNG. The previous `endsWith(".png")` check said it
 * was not, and fell through to a default.
 */
export function faviconExtension(url: string): string | null {
  if (url.startsWith("data:")) return null;
  const withoutQuery = url.split(/[?#]/)[0] ?? "";
  const lastSegment = withoutQuery.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot <= 0 || dot === lastSegment.length - 1) return null;
  return lastSegment.slice(dot + 1).toLowerCase();
}

/**
 * MIME type carried inside a `data:` URI.
 *
 * The bundled default favicon reaches the head as one of these: Vite inlines
 * `assets/favicon.svg` because it is under the asset size limit, so the href is
 * `data:image/svg+xml;base64,…` and there is no file extension to read. The
 * URI states its own type — use that rather than dropping the declaration.
 */
function dataUriMimeType(url: string): string | undefined {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)[;,]/i.exec(url);
  return match?.[1]?.toLowerCase();
}

export interface ResolvedFavicon {
  href: string;
  /**
   * Undefined when the extension isn't one we recognise.
   *
   * Omitting `type` lets the browser sniff the bytes, which is right. Declaring
   * a type we are guessing at is how a `.webp` upload ended up shipping as
   * `type="image/png"` — a mismatch against the `Content-Type: image/webp` the
   * server actually sends for it.
   */
  type?: string;
  /** True when no CMS favicon is set and the bundled default is in use. */
  isDefault: boolean;
}

/**
 * Picks the favicon for a request.
 *
 * `faviconUrl` comes from template-scoped layout settings; `defaultHref` is the
 * bundled `assets/favicon.svg`, which stays the fallback whenever the CMS field
 * is empty.
 */
export function resolveFavicon(
  faviconUrl: string | undefined | null,
  defaultHref: string,
): ResolvedFavicon {
  const configured = (faviconUrl ?? "").trim();

  const href = configured || defaultHref;
  const extension = faviconExtension(href);

  return {
    href,
    type: extension
      ? FAVICON_MIME_TYPES[extension]
      : dataUriMimeType(href),
    isDefault: !configured,
  };
}
