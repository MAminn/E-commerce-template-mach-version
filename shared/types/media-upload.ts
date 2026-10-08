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

/**
 * The largest video the CMS accepts, in bytes — inclusive, so a file of exactly
 * this size is accepted and one byte more is not. Applies to every CMS video
 * slot, because they all upload through `uploadMediaFile`.
 *
 * Videos do not travel through tRPC. They used to, and that capped them at
 * 25MB: SuperJSON encodes a `Uint8Array` as a JSON array of numbers (up to
 * four characters per byte) inside a 100MiB request, so anything from ~29MB
 * was refused with 413 before the procedure ran. They now go as a plain
 * multipart body to `MEDIA_UPLOAD_VIDEO_ENDPOINT`, streamed to disk, and this
 * number is enforced there (busboy's `fileSize`) and checked here before the
 * file is read, so the owner is told the real reason instead of a transport
 * error. Images and PDFs keep their own, smaller server-side limits.
 */
export const MEDIA_UPLOAD_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

/** Where `uploadMediaFile` sends videos, as `multipart/form-data`. */
export const MEDIA_UPLOAD_VIDEO_ENDPOINT = "/api/admin/homepage/media/video";

/**
 * Header the video endpoint requires.
 *
 * A multipart POST is a "simple" request a cross-site form can send with the
 * admin's cookie attached; a custom header cannot be added without a CORS
 * preflight this server never grants. The tRPC path gets the same protection
 * from its JSON content type.
 */
export const MEDIA_UPLOAD_VIDEO_HEADER = "x-mach-cms-upload";

/**
 * Above this, an uploaded video is accepted but the admin is warned.
 *
 * The hero plays with `autoplay` + `preload="auto"` and loops, so every
 * visitor's browser downloads the whole file; a well-compressed 1080p loop is
 * a few MB. Advice only — nothing is refused or re-encoded.
 */
export const LARGE_STOREFRONT_VIDEO_BYTES = 20 * 1024 * 1024;

const wholeMb = (bytes: number) => Math.ceil(bytes / (1024 * 1024));

/** An admin-facing refusal for an oversize video, or null when it fits. */
export function oversizeVideoMessage(file: {
  type: string;
  size: number;
}): string | null {
  if (!file.type.toLowerCase().startsWith("video/")) return null;
  if (file.size <= MEDIA_UPLOAD_VIDEO_MAX_BYTES) return null;
  return videoTooLargeMessage(file.size);
}

/**
 * The refusal itself, shared with the server so both sides say the same
 * thing. `size` is omitted when the server stopped reading at the limit and
 * never learned the real one.
 */
export function videoTooLargeMessage(size?: number): string {
  const limit = `${wholeMb(MEDIA_UPLOAD_VIDEO_MAX_BYTES)}MB`;
  const subject =
    size === undefined ? `Video is over ${limit}.` : `Video is ${wholeMb(size)}MB.`;
  return `${subject} Videos must be ${limit} or smaller — export at 1080p or compress it, then upload again.`;
}

/** A warning for a video that uploaded but will be heavy on the storefront. */
export function largeVideoAdvisory(file: {
  type: string;
  size: number;
}): string | null {
  if (!file.type.toLowerCase().startsWith("video/")) return null;
  if (file.size <= LARGE_STOREFRONT_VIDEO_BYTES) return null;
  return `Uploaded, but this video is ${wholeMb(file.size)}MB and visitors download all of it when it plays. A compressed 1080p export under ${wholeMb(LARGE_STOREFRONT_VIDEO_BYTES)}MB — and a smaller Mobile version — will load much faster.`;
}
