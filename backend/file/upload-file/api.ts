import { runBackendEffect } from "#root/shared/backend/effect";
import type { FastifyInstance } from "fastify";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { v7 } from "uuid";
import { createFile } from "./createFile";
import { DatabaseClientService } from "#root/shared/database/drizzle/db";
import { Effect, pipe } from "effect";
import { imageOptimizationService } from "#root/shared/backend/image-optimization";
import path from "node:path";
import fs from "node:fs";
import { ServerError } from "#root/shared/error/server";

// Function to clean up temporary files older than a specified time
export const cleanupTempFiles = async (
  maxAgeMs = 3600000, // Default: 1 hour
  uploadsDir = "./uploads",
) => {
  try {
    // Ensure uploads directory exists
    if (!fs.existsSync(uploadsDir)) {
      return;
    }

    const now = Date.now();
    const files = await fs.promises.readdir(uploadsDir);

    for (const file of files) {
      if (file.startsWith("temp_")) {
        try {
          const filePath = path.join(uploadsDir, file);
          const stats = await fs.promises.stat(filePath);

          // Check if file is older than maxAgeMs
          if (now - stats.mtime.getTime() > maxAgeMs) {
            await fs.promises.unlink(filePath);
            console.log(`Cleaned up stale temporary file: ${filePath}`);
          }
        } catch (err) {
          console.warn(`Failed to clean up temp file: ${file}`, err);
        }
      }
    }
  } catch (err) {
    console.error("Error in temporary file cleanup:", err);
  }
};

/**
 * What `POST /file` takes: images, which are always re-encoded by sharp, so
 * the bytes that reach `uploads/` are never the bytes that were sent. SVG is
 * rasterised to WebP, not stored as SVG.
 *
 * Its only callers are the dashboard's category image controls
 * (`CategoryImageUpload`, `FileUploadInput`). The endpoint used to also store
 * any other file verbatim under the extension the client supplied — `.html`,
 * `.js`, `.exe` — publicly reachable under `/uploads/`, with no sign-in
 * required. Nothing used that, and it is gone.
 */
export const FILE_UPLOAD_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/svg+xml",
];

/** Inclusive. Matches the 20MB `FileUploadInput` has always told admins. */
export const FILE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

export interface UploadFileApiOptions {
  /** Defaults to `./uploads`; tests point it elsewhere. */
  uploadsDir?: string;
}

export const uploadFileApiPlugin = (
  app: FastifyInstance,
  { uploadsDir = "./uploads" }: UploadFileApiOptions = {},
) => {
  // Set up periodic cleanup - run every 30 minutes
  const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes
  const cleanupTimer = setInterval(() => {
    cleanupTempFiles(undefined, uploadsDir).catch((err) => {
      console.error("Background temp file cleanup failed:", err);
    });
  }, CLEANUP_INTERVAL);
  app.addHook("onClose", async () => clearInterval(cleanupTimer));

  // Run initial cleanup on startup
  cleanupTempFiles(undefined, uploadsDir).catch((err) => {
    console.error("Initial temp file cleanup failed:", err);
  });

  app.post("/file", async (req, res) => {
    // Same rule as `trpc.file.upload`: only admins upload store files.
    const session = req.clientSession;
    if (!session) {
      return res
        .status(401)
        .send({ success: false, error: "Please sign in again to upload files." });
    }
    if (session.role !== "admin" && session.role !== "superadmin") {
      return res
        .status(403)
        .send({ success: false, error: "Unauthorized. Only admins can upload files." });
    }

    let data: Awaited<ReturnType<typeof req.file>>;
    try {
      data = await req.file({
        limits: { fileSize: FILE_UPLOAD_MAX_BYTES, files: 1 },
        // Truncation is checked below, after the partial file is removed.
        throwFileSizeLimit: false,
      });
    } catch {
      data = undefined;
    }
    if (!data) {
      return res
        .status(400)
        .send({ success: false, error: "No file provided" });
    }

    const mimeType = data.mimetype?.toLowerCase() || "";
    if (!FILE_UPLOAD_IMAGE_TYPES.includes(mimeType)) {
      data.file.resume();
      return res.status(400).send({
        success: false,
        error: "Unsupported file type. Upload a JPG, PNG, WebP, AVIF, GIF or SVG image.",
      });
    }

    // Server-chosen names only: nothing the client sent reaches the path.
    const fileId = v7();
    const tempFilePath = path.join(uploadsDir, `temp_${fileId}`);

    try {
      await fs.promises.mkdir(uploadsDir, { recursive: true });
      await pipeline(data.file, createWriteStream(tempFilePath));

      if (data.file.truncated) {
        await unlink(tempFilePath).catch(() => {});
        return res.status(413).send({
          success: false,
          error: `Image is too large. Maximum size is ${FILE_UPLOAD_MAX_BYTES / (1024 * 1024)}MB.`,
        });
      }

      // GIFs keep their animation, and their own extension, so the name on
      // disk says what the bytes are.
      const isGif = mimeType === "image/gif";
      const outputPath = path.join(uploadsDir, `${fileId}.${isGif ? "gif" : "webp"}`);

      // Optimize the image using our service. sharp decoding it is also the
      // content check: a non-image sent with an image type fails here.
      const optimizationResult = await runBackendEffect(
        pipe(
          imageOptimizationService.optimizeFile(
            tempFilePath,
            outputPath,
            "default", // Use default optimization settings
            { format: isGif ? "gif" : "webp" }
          ),
          Effect.mapError(
            (err) =>
              new ServerError({
                tag: "IMAGE_OPTIMIZATION_ERROR",
                message: "Failed to optimize image",
                clientMessage: "Failed to optimize image",
                cause: err,
              })
          )
        )
      );

      // Clean up temporary file
      try {
        // Add a small delay to ensure file handles are released
        await new Promise((resolve) => setTimeout(resolve, 100));
        await unlink(tempFilePath);
      } catch (err) {
        // Just log but don't fail the upload if temp deletion fails
        console.warn(
          "Warning: Could not delete temp file, will be cleaned up later:",
          tempFilePath
        );
      }

      // `optimizeFile` reports its own failures as a result, not an error.
      if (!optimizationResult.success || !optimizationResult.result.success) {
        await unlink(outputPath).catch(() => {});
        return res.status(400).send({
          success: false,
          error: "That file is not a valid image.",
        });
      }

      // Get actual output filename considering format
      const actualOutput = path.basename(
        optimizationResult.result.outputPath || outputPath
      );

      // Save to database
      const result = await runBackendEffect(
        createFile({
          diskname: actualOutput,
        }).pipe(Effect.provideService(DatabaseClientService, req.db))
      );

      if (!result.success) {
        // Delete the file if database insert fails
        await unlink(outputPath).catch(() => {});
        return res
          .status(500)
          .send({ success: false, error: "Failed to upload file" });
      }

      // Return file info and optimization stats
      return res.status(200).send({
        success: true,
        result: {
          ...result.result,
          optimization: {
            originalSize: optimizationResult.result.originalSize,
            optimizedSize: optimizationResult.result.optimizedSize,
            compressionRatio: optimizationResult.result.compressionRatio,
            width: optimizationResult.result.width,
            height: optimizationResult.result.height,
            format: optimizationResult.result.format,
          },
        },
      });
    } catch (err) {
      await unlink(tempFilePath).catch(() => {});
      console.error("Error processing file upload:", err);
      return res
        .status(500)
        .send({ success: false, error: "Failed to upload file" });
    }
  });
};
