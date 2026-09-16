/**
 * The filename prefix contract for CMS media uploads.
 *
 * `homepage.uploadMedia` takes a prefix so uploads stay identifiable on disk
 * ("hero-…", "campaign-…"), and its input schema caps that prefix at 24
 * characters. Every prefix in the CMS used to be a short literal written by
 * hand, so the cap was invisible — until a prefix started being *built* from
 * client data (a section background is named after the group it sits behind).
 * A group called "Stacks & Bundles" produces a 25-character prefix, the
 * mutation rejects the input before the procedure runs, and the upload fails
 * with nothing wrong with the file.
 *
 * So the cap lives here, imported by the schema that enforces it and by the
 * client that has to respect it, and `normalizeMediaUploadPrefix` is the one
 * way a prefix is built. The rule is not restated anywhere: a caller cannot
 * construct a prefix the server will refuse, and the limit cannot be raised on
 * one side without the other seeing it.
 */

/** Longest prefix `homepage.uploadMedia` accepts. */
export const MEDIA_UPLOAD_PREFIX_MAX_LENGTH = 24;

/** What an upload is named when the caller has nothing better to offer. */
export const DEFAULT_MEDIA_UPLOAD_PREFIX = "media";

/**
 * Turns anything a caller wants to name an upload after into a prefix the
 * mutation will accept.
 *
 * Mirrors what the upload service already does to whatever reaches it —
 * keep `[a-z0-9-]`, cap the length — so the name on disk is the same either
 * way; the point of doing it here as well is that the *request* is then valid,
 * rather than being rejected on the way in.
 *
 * A prefix that sanitises away to nothing (a group named in Arabic, say, which
 * this store has) falls back rather than producing a filename that starts with
 * a dash or a bare UUID.
 */
export function normalizeMediaUploadPrefix(
  raw: string | null | undefined,
  fallback: string = DEFAULT_MEDIA_UPLOAD_PREFIX,
): string {
  const cleaned = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MEDIA_UPLOAD_PREFIX_MAX_LENGTH)
    // A slice can land on a trailing dash; "campaign-" reads as a mistake.
    .replace(/-+$/g, "");

  return cleaned || fallback;
}
