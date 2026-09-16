import { trpc } from "#root/shared/trpc/client";
import {
  DEFAULT_MEDIA_UPLOAD_PREFIX,
  normalizeMediaUploadPrefix,
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
 */

export interface MediaUploadSuccess {
  ok: true;
  url: string;
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
