import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { createReadStream, existsSync } from "node:fs";
import { relative, sep } from "node:path";
import { Readable } from "node:stream";
import { isCanonicallyInsideUploads, resolveUploadPath } from "./upload-path";

/**
 * Everything under `/uploads/`.
 *
 * Files present at boot get their own routes from @fastify/static (`wildcard:
 * false`); `/uploads/*` catches everything uploaded since. Both serve the same
 * way — real content type, Range requests, ETag — and the catch-all serves
 * nothing that is not, canonically, inside the uploads directory.
 */

/** Extensions the catch-all serves with their real type; the rest download. */
const SERVED_MEDIA_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "ico",
  "mp4", "webm", "mov", "pdf",
]);

export interface UploadsServingOptions {
  /** Absolute path of the uploads directory. */
  uploadsRoot: string;
  /**
   * Dev-only: where to fetch a file that is referenced but not on disk.
   * Empty in production.
   */
  fallbackOrigin?: string;
}

export const uploadsServingPlugin = async (
  app: FastifyInstance,
  { uploadsRoot, fallbackOrigin = "" }: UploadsServingOptions,
) => {
  await app.register(fastifyStatic, {
    root: uploadsRoot,
    // The one registration that decorates: `/uploads/*` below sends files
    // uploaded after boot through this instance's `reply.sendFile`.
    decorateReply: true,
    wildcard: false,
    prefix: "/uploads",
    // helmet's default Cross-Origin-Resource-Policy: same-origin blocks any
    // cross-origin embedder from loading these files — but uploads (logos,
    // product photos, share images) are deliberately public assets meant to
    // be embedded elsewhere: marketing emails (Gmail/Outlook render message
    // bodies as an opaque/foreign origin), social-preview scrapers, and this
    // admin's own sandboxed (`sandbox=""`, opaque-origin) preview iframe.
    // Same-origin CORP was silently breaking all three.
    setHeaders: (res) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  });

  // Dynamic route for uploaded files (wildcard: false only registers files existing at boot)
  app.get("/uploads/*", async (request, reply) => {
    const filePath = (request.params as { "*": string })["*"];
    const notFound = () => reply.code(404).send({ error: "File not found" });

    const fullPath = resolveUploadPath(uploadsRoot, filePath);
    if (!fullPath) return notFound();
    reply.header("Cross-Origin-Resource-Policy", "cross-origin");

    if (!existsSync(fullPath)) {
      // Dev-only: DB records synced down from prod (see env-sync) reference
      // files that intentionally stay on prod's storage rather than being
      // copied locally. Fetch the real file from there and stream it back
      // same-origin — a redirect would send the browser straight to prod,
      // and prod's Cross-Origin-Resource-Policy: same-origin header (from
      // helmet) makes browsers silently block that cross-origin image load.
      if (fallbackOrigin) {
        try {
          const upstream = await fetch(`${fallbackOrigin}/uploads/${filePath}`);
          if (!upstream.ok || !upstream.body) return notFound();
          reply.header(
            "Content-Type",
            upstream.headers.get("content-type") ?? "application/octet-stream",
          );
          return reply.send(
            Readable.fromWeb(upstream.body as import("stream/web").ReadableStream),
          );
        } catch (err) {
          console.error("[uploads fallback] failed to fetch from PROD_ASSET_ORIGIN:", err);
          return notFound();
        }
      }
      return notFound();
    }

    // The spelling is inside uploads/; make sure the file really is, with
    // any symlink or junction on the way followed.
    if (!(await isCanonicallyInsideUploads(uploadsRoot, fullPath))) {
      return notFound();
    }

    const ext = fullPath.split(".").pop()?.toLowerCase() ?? "";
    if (SERVED_MEDIA_EXTENSIONS.has(ext)) {
      // Served exactly like a file that existed at boot: real content type,
      // Range requests (Safari will not play a video without 206 responses,
      // and a seek would otherwise re-download the whole file), ETag. Handed
      // the vetted path, not the raw wildcard.
      return reply.sendFile(relative(uploadsRoot, fullPath).split(sep).join("/"));
    }
    // Anything else stays an opaque download, as it always has here.
    return reply
      .type("application/octet-stream")
      .send(createReadStream(fullPath));
  });
};
