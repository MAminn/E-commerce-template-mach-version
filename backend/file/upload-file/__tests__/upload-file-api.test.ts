import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

// Only the database insert is stubbed; the route, multipart parsing, sharp
// and the filesystem are all real.
const createFile = vi.fn((data: { diskname: string }) =>
  Effect.succeed({ id: "file-1", diskname: data.diskname }),
);
vi.mock("../createFile", () => ({
  createFile: (data: { diskname: string }) => createFile(data),
}));

import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FILE_UPLOAD_MAX_BYTES,
  uploadFileApiPlugin,
} from "../api";

/**
 * `POST /file` — the category image upload.
 *
 * It used to accept anything from anyone: no sign-in check, and any non-image
 * stored byte-for-byte under the client's own extension, publicly reachable
 * under /uploads/. These pin the fix: admins only, images only, every stored
 * file is sharp's re-encoding under a server-chosen name.
 */

const BOUNDARY = "----mach-file-boundary";
let base: string;
let dir: string;
let app: FastifyInstance;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "mach-file-upload-"));
  dir = path.join(base, "uploads");
  createFile.mockClear();
  app = Fastify();
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
  app.decorateRequest("clientSession", undefined);
  // Stand-in for the auth middleware: the role comes from a test header.
  app.addHook("onRequest", async (req) => {
    const role = req.headers["x-test-role"];
    req.clientSession =
      typeof role === "string"
        ? ({ id: "u1", role } as unknown as NonNullable<typeof req.clientSession>)
        : undefined;
  });
  await app.register(uploadFileApiPlugin, { uploadsDir: dir });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await app.close();
  await rm(base, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function body(content: Buffer, type: string, filename: string): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

async function upload(
  content: Buffer,
  type: string,
  filename = "photo.png",
  role: string | null = "admin",
) {
  const res = await app.inject({
    method: "POST",
    url: "/file",
    headers: {
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      ...(role ? { "x-test-role": role } : {}),
    },
    payload: body(content, type, filename),
  });
  return { status: res.statusCode, json: res.json() as Record<string, any> };
}

/** The real format of a stored file, read via a buffer so no handle lingers. */
const formatOf = async (name: string) =>
  (await sharp(await readFile(path.join(dir, name))).metadata()).format;
const stored = async () => (await readdir(dir).catch(() => [])).sort();
const png = () =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: "#c00" } }).png().toBuffer();

describe("POST /file — who may upload", () => {
  const refused: Array<[string, string | null, number]> = [
    ["a signed-out visitor", null, 401],
    ["a customer account", "user", 403],
    ["a vendor account", "vendor", 403],
  ];
  for (const [label, role, status] of refused) {
    it(`refuses ${label}, writing nothing`, async () => {
      const res = await upload(await png(), "image/png", "photo.png", role);
      expect(res.status).toBe(status);
      expect(res.json.success).toBe(false);
      expect(await stored()).toEqual([]);
      expect(createFile).not.toHaveBeenCalled();
    });
  }

  for (const role of ["admin", "superadmin"]) {
    it(`lets ${role} upload`, async () => {
      expect((await upload(await png(), "image/png", "photo.png", role)).status).toBe(200);
    });
  }
});

describe("POST /file — what it stores", () => {
  it("re-encodes an image to WebP under a server-chosen name (same response shape)", async () => {
    const res = await upload(await png(), "image/png", "My Category.png");

    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.result.id).toBe("file-1");
    expect(res.json.result.diskname).toMatch(/^[0-9a-f-]{36}\.webp$/);
    expect(res.json.result.optimization.format).toBe("webp");
    // Only the output is left behind — no temp file, nothing named by the client.
    expect(await stored()).toEqual([res.json.result.diskname]);
    expect(await formatOf(res.json.result.diskname)).toBe("webp");
  });

  it("keeps a GIF a GIF, named .gif", async () => {
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#0c0" } })
      .gif()
      .toBuffer();
    const res = await upload(gif, "image/gif", "anim.gif");
    expect(res.status).toBe(200);
    expect(res.json.result.diskname).toMatch(/\.gif$/);
    expect(await formatOf(res.json.result.diskname)).toBe("gif");
  });

  it("rasterises an SVG — its script never reaches disk", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><script>alert(1)</script><rect width="8" height="8" fill="red"/></svg>',
    );
    const res = await upload(svg, "image/svg+xml", "logo.svg");
    expect(res.status).toBe(200);
    expect(res.json.result.diskname).toMatch(/\.webp$/);
    const bytes = await readFile(path.join(dir, res.json.result.diskname));
    expect(bytes.includes("<script")).toBe(false);
  });

  it("ignores a hostile filename — nothing is written outside uploads/", async () => {
    const res = await upload(await png(), "image/png", "../../evil.png");
    expect(res.status).toBe(200);
    expect(res.json.result.diskname).toMatch(/^[0-9a-f-]{36}\.webp$/);
    expect((await readdir(base)).sort()).toEqual(["uploads"]);
  });
});

describe("POST /file — what it refuses", () => {
  const types: Array<[string, string, string]> = [
    ["HTML", "text/html", "page.html"],
    ["JavaScript", "application/javascript", "x.js"],
    ["an executable", "application/x-msdownload", "setup.exe"],
    ["a shell script", "application/x-sh", "run.sh"],
    ["a PDF (never sent here)", "application/pdf", "doc.pdf"],
    ["a video (has its own endpoint)", "video/mp4", "clip.mp4"],
    ["an unlisted image type", "image/x-icon", "f.ico"],
  ];
  for (const [label, type, filename] of types) {
    it(`refuses ${label} (${type})`, async () => {
      const res = await upload(Buffer.from("<html><script>alert(1)</script></html>"), type, filename);
      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/Unsupported file type/);
      expect(await stored()).toEqual([]);
      expect(createFile).not.toHaveBeenCalled();
    });
  }

  it("refuses HTML disguised as a PNG", async () => {
    const res = await upload(
      Buffer.from("<html><body><script>alert(document.cookie)</script></body></html>"),
      "image/png",
      "evil.html",
    );
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("That file is not a valid image.");
    expect(await stored()).toEqual([]);
    expect(createFile).not.toHaveBeenCalled();
  });

  it("refuses an executable disguised as a JPEG", async () => {
    const exe = Buffer.concat([Buffer.from("MZ\x90\x00", "latin1"), Buffer.alloc(2048)]);
    const res = await upload(exe, "image/jpeg", "photo.jpg");
    expect(res.status).toBe(400);
    expect(await stored()).toEqual([]);
    expect(createFile).not.toHaveBeenCalled();
  });

  it("refuses an image over 20MB, keeping nothing", async () => {
    const big = Buffer.concat([await png(), Buffer.alloc(FILE_UPLOAD_MAX_BYTES)]);
    const res = await upload(big, "image/png");
    expect(res.status).toBe(413);
    expect(res.json.error).toBe("Image is too large. Maximum size is 20MB.");
    expect(await stored()).toEqual([]);
    expect(createFile).not.toHaveBeenCalled();
  });

  it("refuses a request with no file", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/file",
      headers: { "content-type": "application/json", "x-test-role": "admin" },
      payload: "{}",
    });
    expect(res.statusCode).toBe(400);
  });
});
