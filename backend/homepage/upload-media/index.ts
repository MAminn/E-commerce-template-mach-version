import { Effect } from "effect";
import { writeFile, mkdir } from "node:fs/promises";
import { v7 } from "uuid";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { MEDIA_UPLOAD_VIDEO_MAX_BYTES } from "#root/shared/types/media-upload";

/**
 * Generic homepage CMS media upload.
 *
 * `upload-hero-image` stays exactly as it was — it is a sharp-only image
 * pipeline that crops to a fixed hero ratio, and the existing admin hero
 * controls depend on that behaviour. This is the separate, general path every
 * *new* CMS media slot uses: campaign banners, category artwork, Why-Mach
 * visuals, factory shots, hero video, and certificate documents.
 *
 * Routing by kind:
 *   image  -> sharp, aspect preserved, capped at 2400px wide, re-encoded webp
 *   video  -> stored as-is (no transcode; we are not shipping ffmpeg for this)
 *   document -> stored as-is, for client-supplied certificate PDFs
 *
 * Everything lands in the same `uploads/homepage/` directory the hero images
 * already use, so it is served by the existing static handler and swept by the
 * same backup/deploy story. No new storage system.
 */

export type UploadMediaKind = "image" | "video" | "document";

export interface UploadHomepageMediaInput {
  buffer: Uint8Array;
  mimeType: string;
  /** Filename prefix so uploads are identifiable on disk, e.g. "campaign". */
  prefix?: string;
}

export interface UploadHomepageMediaResult {
  url: string;
  filename: string;
  kind: UploadMediaKind;
}

export const IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
];
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const DOCUMENT_TYPES = ["application/pdf"];

/**
 * Per-kind ceilings. Video is the outlier — a short loop still runs large.
 *
 * The CMS no longer sends video through this function: it streams it to
 * `video-api.ts`, which enforces the same shared number without buffering.
 * Video stays accepted here at that number so the two paths cannot disagree,
 * although the tRPC transport refuses anything past ~28MB before this runs.
 */
export const MAX_BYTES: Record<UploadMediaKind, number> = {
  image: 10 * 1024 * 1024,
  video: MEDIA_UPLOAD_VIDEO_MAX_BYTES,
  document: 10 * 1024 * 1024,
};

/** Where every homepage CMS upload lands; served under `/uploads/homepage/`. */
export const HOMEPAGE_UPLOADS_DIR = "./uploads/homepage";

/** The on-disk name for a stored-as-is upload (video, PDF). */
export function storedMediaFilename(
  mimeType: string,
  prefix: string,
  fileId: string = v7(),
): string {
  const extension = EXTENSION_BY_MIME[mimeType.toLowerCase()] ?? "bin";
  return `${safeMediaPrefix(prefix)}-${fileId}.${extension}`;
}

function safeMediaPrefix(prefix: string): string {
  return prefix.replace(/[^a-z0-9-]/gi, "").slice(0, 24) || "media";
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
};

function classify(mimeType: string): UploadMediaKind | null {
  const type = mimeType.toLowerCase();
  if (IMAGE_TYPES.includes(type)) return "image";
  if (VIDEO_TYPES.includes(type)) return "video";
  if (DOCUMENT_TYPES.includes(type)) return "document";
  return null;
}

export function isVideoMimeType(mimeType: string): boolean {
  return VIDEO_TYPES.includes(mimeType.toLowerCase());
}

function humanMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

export const uploadHomepageMedia = ({
  buffer,
  mimeType,
  prefix = "media",
}: UploadHomepageMediaInput): Effect.Effect<
  UploadHomepageMediaResult,
  Error
> => {
  return Effect.gen(function* () {
    const kind = classify(mimeType);
    if (!kind) {
      return yield* Effect.fail(
        new Error(
          "Unsupported file type. Allowed: JPG, PNG, WebP, AVIF, MP4, WebM, MOV, PDF.",
        ),
      );
    }

    const limit = MAX_BYTES[kind];
    if (buffer.length > limit) {
      return yield* Effect.fail(
        new Error(
          `File too large. Maximum size for ${kind} uploads is ${humanMb(limit)}.`,
        ),
      );
    }

    const uploadsDir = HOMEPAGE_UPLOADS_DIR;
    if (!existsSync(uploadsDir)) {
      yield* Effect.tryPromise({
        try: () => mkdir(uploadsDir, { recursive: true }),
        catch: (err) => new Error(`Failed to create uploads directory: ${err}`),
      });
    }

    const fileId = v7();
    const safePrefix = safeMediaPrefix(prefix);

    if (kind === "image") {
      // Aspect is preserved deliberately: campaign and category slots are
      // cropped by CSS at render time using the slot's focal point, so
      // baking a crop in here would remove control the client needs.
      const filename = `${safePrefix}-${fileId}.webp`;
      const filePath = `${uploadsDir}/${filename}`;
      yield* Effect.tryPromise({
        try: () =>
          sharp(Buffer.from(buffer))
            .resize({ width: 2400, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 88, effort: 5 })
            .toFile(filePath),
        catch: (err) => new Error(`Failed to process image: ${err}`),
      });
      return {
        url: `/uploads/homepage/${filename}`,
        filename,
        kind,
      };
    }

    const filename = storedMediaFilename(mimeType, safePrefix, fileId);
    const filePath = `${uploadsDir}/${filename}`;
    yield* Effect.tryPromise({
      try: () => writeFile(filePath, Buffer.from(buffer)),
      catch: (err) => new Error(`Failed to save file: ${err}`),
    });

    return {
      url: `/uploads/homepage/${filename}`,
      filename,
      kind,
    };
  });
};
