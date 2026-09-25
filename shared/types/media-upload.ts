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
 * The largest video the CMS will try to send, in bytes. Applies to every CMS
 * video slot, because they all upload through `uploadMediaFile`.
 *
 * Not the server's own ceiling (`upload-media` says 40MB) but the one the
 * transport imposes first. The file travels inside a tRPC mutation, and
 * SuperJSON encodes a `Uint8Array` as a JSON array of numbers: each byte
 * becomes one to three digits plus a comma, ~3.57 characters for compressed
 * video and never more than 4. The request limit is 100MiB (server.ts, and
 * the tRPC plugin's `maxBodySize`), so:
 *
 *  - 25MiB is the largest file that fits whatever its bytes are (100 / 4);
 *  - a typical video fits up to ~28MB, depending on its bytes;
 *  - anything from ~29MB is refused by Fastify with 413 before the procedure
 *    runs. Measured against the real endpoint: 28MB → 200, 29/30/35/40MB →
 *    413 FST_ERR_CTP_BODY_TOO_LARGE. The server's 40MB is unreachable.
 *
 * Checked before the file is read into memory, so the owner is told the real
 * reason instead of a transport error.
 */
export const MEDIA_UPLOAD_VIDEO_MAX_BYTES = 25 * 1024 * 1024;

/** An admin-facing refusal for an oversize video, or null when it fits. */
export function oversizeVideoMessage(file: {
  type: string;
  size: number;
}): string | null {
  if (!file.type.toLowerCase().startsWith("video/")) return null;
  if (file.size <= MEDIA_UPLOAD_VIDEO_MAX_BYTES) return null;
  const mb = (bytes: number) => Math.ceil(bytes / (1024 * 1024));
  return `Video is ${mb(file.size)}MB. Videos must be ${mb(MEDIA_UPLOAD_VIDEO_MAX_BYTES)}MB or smaller — export at 1080p or compress it, then upload again.`;
}
