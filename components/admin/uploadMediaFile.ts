import { trpc } from "#root/shared/trpc/client";
import {
  DEFAULT_MEDIA_UPLOAD_PREFIX,
  MEDIA_UPLOAD_VIDEO_ENDPOINT,
  MEDIA_UPLOAD_VIDEO_HEADER,
  largeVideoAdvisory,
  normalizeMediaUploadPrefix,
  oversizeVideoMessage,
} from "#root/shared/types/media-upload";

/**
 * The one way the CMS uploads a file.
 *
 * `MediaSlotField` (hero, campaign banners, certificates, factory) and
 * `MediaUploadField` (section backgrounds) both call this, so there is a
 * single implementation of "chosen file → `homepage.uploadMedia` → URL"
 * rather than two that look the same and differ where it matters. They already
 * differed in exactly one place — the prefix — and that one place is what made
 * section background uploads fail while every existing slot kept working.
 *
 * Two things it guarantees that a hand-written call site cannot:
 *
 *  1. **The request is valid before it is sent.** The prefix is normalised
 *     through the shared contract, so a prefix built from client data — a
 *     group name, a shelf name — cannot exceed what the mutation accepts.
 *  2. **A failure says something.** The mutation reports refusals it can
 *     explain (unsupported type, file too large) in its result; anything
 *     thrown is a transport or validation fault, which used to collapse into
 *     one generic message with the real reason only in the console.
 *
 * Videos are the one exception to "through the mutation": they are streamed
 * as multipart to their own endpoint, because tRPC's encoding of a byte array
 * capped them at 25MB. Callers see the same outcome either way.
 */

export interface MediaUploadSuccess {
  ok: true;
  url: string;
  /** Uploaded fine, but worth a word to the admin (a very heavy video). */
  notice?: string;
}

export interface MediaUploadFailure {
  ok: false;
  /** Safe to show an admin: one sentence, no stack, no filesystem path. */
  message: string;
}

export type MediaUploadOutcome = MediaUploadSuccess | MediaUploadFailure;

/** What the mutation is sent, as a pure function of the file and the prefix. */
export function mediaUploadPayload(
  file: { name: string; type: string },
  // The exact array type the mutation's input declares: a view over a plain
  // `ArrayBuffer`, which is what `File.arrayBuffer()` yields. The looser
  // `Uint8Array` would also admit a `SharedArrayBuffer` view, which the wire
  // schema does not take.
  buffer: Uint8Array<ArrayBuffer>,
  prefix: string | undefined,
): {
  file: { name: string; type: string; buffer: Uint8Array<ArrayBuffer> };
  prefix: string;
} {
  return {
    file: { name: file.name, type: file.type, buffer },
    prefix: normalizeMediaUploadPrefix(prefix, DEFAULT_MEDIA_UPLOAD_PREFIX),
  };
}

/**
 * A message from a thrown error, or nothing.
 *
 * Deliberately conservative. A server's own sentence — "File too large.
 * Maximum size for image uploads is 10MB." — is exactly what an admin needs;
 * a stack frame, a path from the server's disk, or a serialised validation
 * blob is noise at best and an information leak at worst. So a message is
 * passed through only when it reads like a sentence written for a person.
 */
export function safeUploadErrorMessage(error: unknown): string | null {
  const raw = error instanceof Error ? error.message : "";
  const line = raw.split("\n")[0]?.trim() ?? "";
  if (!line || line.length > 160) return null;
  // Structured payloads (tRPC serialises Zod issues as JSON), stack frames and
  // anything carrying a path are never shown.
  if (/^[[{]/.test(line)) return null;
  if (/\bat\s+\S+\s+\(/.test(line)) return null;
  if (/[\\/]|node_modules|:\d+:\d+/.test(line)) return null;
  return line;
}

/**
 * Uploads one file and reports what happened.
 *
 * Returns `null` when there is no file — a change event can fire with an empty
 * selection (the picker was cancelled), and that is not a failure to report.
 */
export async function uploadMediaFile(
  file: File | undefined | null,
  prefix: string | undefined,
): Promise<MediaUploadOutcome | null> {
  if (!file) return null;

  // Refused before the file is sent, with the same limit the server enforces.
  const oversize = oversizeVideoMessage(file);
  if (oversize) return { ok: false, message: oversize };

  if (file.type.toLowerCase().startsWith("video/")) {
    const outcome = await uploadVideoFile(file, prefix);
    const notice = largeVideoAdvisory(file);
    return outcome.ok && notice ? { ...outcome, notice } : outcome;
  }

  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const result = await trpc.homepage.uploadMedia.mutate(
      mediaUploadPayload(file, buffer, prefix),
    );

    if (result.success && result.data) {
      return { ok: true, url: result.data.url };
    }
    return { ok: false, message: result.error || "Upload failed" };
  } catch (error) {
    // The whole error stays in the console for a developer; the admin gets the
    // part of it that was written for them, or a plain fallback.
    console.error("Media upload error:", error);
    return {
      ok: false,
      message: safeUploadErrorMessage(error) ?? "Error uploading file",
    };
  }
}

/**
 * Streams a video to the multipart endpoint.
 *
 * The browser sends the `File` itself — it is never read into a buffer here —
 * and the server writes it to disk as it arrives.
 */
async function uploadVideoFile(
  file: File,
  prefix: string | undefined,
): Promise<MediaUploadOutcome> {
  const body = new FormData();
  body.append("file", file, file.name);
  const query = new URLSearchParams({
    prefix: normalizeMediaUploadPrefix(prefix, DEFAULT_MEDIA_UPLOAD_PREFIX),
  });

  try {
    const response = await fetch(`${MEDIA_UPLOAD_VIDEO_ENDPOINT}?${query}`, {
      method: "POST",
      body,
      credentials: "same-origin",
      headers: { [MEDIA_UPLOAD_VIDEO_HEADER]: "1" },
    });
    const result = (await response.json().catch(() => null)) as {
      success?: boolean;
      data?: { url?: string };
      error?: string;
    } | null;

    if (response.ok && result?.success && result.data?.url) {
      return { ok: true, url: result.data.url };
    }
    return {
      ok: false,
      message:
        safeUploadErrorMessage(new Error(result?.error ?? "")) ??
        `Upload failed (${response.status})`,
    };
  } catch (error) {
    console.error("Media upload error:", error);
    return { ok: false, message: "Error uploading file" };
  }
}
