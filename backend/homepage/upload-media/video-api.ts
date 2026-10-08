import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  MEDIA_UPLOAD_VIDEO_ENDPOINT,
  MEDIA_UPLOAD_VIDEO_HEADER,
  MEDIA_UPLOAD_VIDEO_MAX_BYTES,
  normalizeMediaUploadPrefix,
  videoTooLargeMessage,
} from "#root/shared/types/media-upload";
import {
  HOMEPAGE_UPLOADS_DIR,
  isVideoMimeType,
  storedMediaFilename,
} from "./index";

/**
 * CMS video uploads, streamed.
 *
 * Every other homepage upload goes through `homepage.uploadMedia`, where the
 * file is a `Uint8Array` inside a tRPC mutation. SuperJSON spells that as a
 * JSON array of numbers — up to four characters per byte — inside a 100MiB
 * request, which capped video at 25MB. This route takes the file as a plain
 * `multipart/form-data` body instead and pipes it straight to disk, so a
 * 100MB video never sits in memory and the limit is the real one.
 *
 * Same rules as the tRPC path: admins only, the same video types, the same
 * directory and naming, the same `{ success, data: { url } }` result. Images
 * and PDFs do not come here and keep their own limits.
 */

/** Room for the multipart boundary and part headers around the file. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/** Enough of the file to recognise its container. */
const SIGNATURE_BYTES = 12;

/** Top-level ISO-BMFF boxes an MP4/MOV can open with. */
const ISO_BMFF_BOXES = new Set(["ftyp", "moov", "mdat", "free", "skip", "wide", "pnot"]);

class UploadRefusal extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const NOT_A_VIDEO =
  "That file is not a valid MP4, WebM or MOV video. Export it again and upload the new file.";

/**
 * Whether the first bytes are the container the declared type promises.
 *
 * The part's Content-Type is whatever the browser guessed from the extension,
 * so a renamed file would otherwise be stored and served as a video.
 */
export function hasVideoSignature(mimeType: string, head: Uint8Array): boolean {
  if (head.length < 8) return false;
  if (mimeType.toLowerCase() === "video/webm") {
    // EBML header magic.
    return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  }
  // MP4 and MOV are both ISO-BMFF: a 4-byte size, then the box type.
  const box = String.fromCharCode(head[4]!, head[5]!, head[6]!, head[7]!);
  return ISO_BMFF_BOXES.has(box);
}

/** Passes the stream through, failing it if it does not open like a video. */
function videoSignatureGuard(mimeType: string): Transform {
  let head = Buffer.alloc(0);
  let checked = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      if (!checked) {
        head = Buffer.concat([head, chunk]).subarray(0, SIGNATURE_BYTES);
        if (head.length >= SIGNATURE_BYTES) {
          checked = true;
          if (!hasVideoSignature(mimeType, head)) {
            return done(new UploadRefusal(400, NOT_A_VIDEO));
          }
        }
      }
      done(null, chunk);
    },
    flush(done) {
      // A file shorter than the signature (including an empty one).
      if (!checked && !hasVideoSignature(mimeType, head)) {
        return done(new UploadRefusal(400, NOT_A_VIDEO));
      }
      done();
    },
  });
}

function refuse(reply: FastifyReply, statusCode: number, error: string) {
  return reply.code(statusCode).send({ success: false as const, error });
}

function isAdmin(request: FastifyRequest): boolean {
  const role = request.clientSession?.role;
  return role === "admin" || role === "superadmin";
}

export interface HomepageVideoUploadOptions {
  /** Defaults to the homepage uploads directory; tests point it elsewhere. */
  uploadsDir?: string;
}

export const homepageVideoUploadApiPlugin = async (
  app: FastifyInstance,
  { uploadsDir = HOMEPAGE_UPLOADS_DIR }: HomepageVideoUploadOptions = {},
) => {
  app.post(MEDIA_UPLOAD_VIDEO_ENDPOINT, async (request, reply) => {
    // Everything that can be decided from the headers is decided before a
    // byte of the body is read.
    if (!request.clientSession) {
      return refuse(reply, 401, "Please sign in again to upload media.");
    }
    if (!isAdmin(request)) {
      return refuse(reply, 403, "Unauthorized. Only admins can upload homepage media.");
    }
    if (request.headers[MEDIA_UPLOAD_VIDEO_HEADER] !== "1") {
      return refuse(reply, 403, "Upload refused.");
    }
    const declaredLength = Number(request.headers["content-length"]);
    if (declaredLength > MEDIA_UPLOAD_VIDEO_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
      return refuse(reply, 413, videoTooLargeMessage());
    }

    let part: Awaited<ReturnType<FastifyRequest["file"]>>;
    try {
      part = await request.file({
        // Inclusive: busboy truncates only past `fileSize` bytes.
        limits: { fileSize: MEDIA_UPLOAD_VIDEO_MAX_BYTES, files: 1 },
        // Truncation is checked below, after the partial file is removed.
        throwFileSizeLimit: false,
      });
    } catch {
      return refuse(reply, 400, "Upload a single video file.");
    }
    if (!part) {
      return refuse(reply, 400, "Upload a single video file.");
    }

    const mimeType = part.mimetype.toLowerCase();
    if (!isVideoMimeType(mimeType)) {
      part.file.resume();
      return refuse(reply, 400, "Unsupported video type. Allowed: MP4, WebM, MOV.");
    }

    const { prefix } = request.query as { prefix?: string };
    const filename = storedMediaFilename(mimeType, normalizeMediaUploadPrefix(prefix));
    const finalPath = `${uploadsDir}/${filename}`;
    // Written under a different name so a half-received file is never at the
    // URL the CMS will save.
    const partialPath = `${finalPath}.part`;

    try {
      await mkdir(uploadsDir, { recursive: true });
      await pipeline(part.file, videoSignatureGuard(mimeType), createWriteStream(partialPath));

      if (part.file.truncated) {
        await unlink(partialPath).catch(() => {});
        return refuse(reply, 413, videoTooLargeMessage());
      }

      await rename(partialPath, finalPath);
    } catch (error) {
      await unlink(partialPath).catch(() => {});
      if (error instanceof UploadRefusal) {
        return refuse(reply, error.statusCode, error.message);
      }
      request.log.error({ err: error }, "Homepage video upload failed");
      return refuse(reply, 500, "Failed to save the video. Please try again.");
    }

    return reply.send({
      success: true as const,
      data: { url: `/uploads/homepage/${filename}`, filename, kind: "video" as const },
    });
  });
};
