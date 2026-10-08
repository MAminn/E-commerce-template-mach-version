import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  MEDIA_UPLOAD_VIDEO_ENDPOINT,
  MEDIA_UPLOAD_VIDEO_HEADER,
  MEDIA_UPLOAD_VIDEO_MAX_BYTES,
  oversizeVideoMessage,
  videoTooLargeMessage,
} from "#root/shared/types/media-upload";
import { Effect } from "effect";
import { MAX_BYTES, uploadHomepageMedia } from "../upload-media";
import { hasVideoSignature, homepageVideoUploadApiPlugin } from "../upload-media/video-api";

/**
 * The streamed CMS video route, driven through Fastify with real multipart
 * bodies. Payloads are generated on the fly — a real container signature
 * followed by zeros — so a 100MB case costs disk in a temp directory, never a
 * fixture in git or a 100MB buffer in memory.
 */

const MB = 1024 * 1024;
const BOUNDARY = "----mach-test-boundary";
const MP4_HEAD = Buffer.from([0, 0, 0, 0x20, ...Buffer.from("ftypisom"), 0, 0, 2, 0]);
const WEBM_HEAD = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0x42, 0xf7, 0x81]);

let dir: string;
let instance: FastifyInstance;

/** The route as server.ts mounts it, writing to a throwaway directory. */
async function appFor(uploadsDir: string): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(multipart, { limits: { fileSize: 100 * MB } });
  app.decorateRequest("clientSession", undefined);
  // Stand-in for the auth middleware: the role comes from a test header.
  app.addHook("onRequest", async (req) => {
    const role = req.headers["x-test-role"];
    req.clientSession =
      typeof role === "string"
        ? ({ id: "u1", role } as unknown as NonNullable<typeof req.clientSession>)
        : undefined;
  });
  await app.register(homepageVideoUploadApiPlugin, { uploadsDir });
  return app;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mach-video-upload-"));
  instance = await appFor(dir);
});

afterEach(async () => {
  await instance.close();
  await rm(dir, { recursive: true, force: true });
});

/** A multipart body carrying one file of exactly `size` bytes, streamed. */
function multipartBody(opts: {
  size: number;
  type?: string;
  head?: Buffer;
  filename?: string;
}): { stream: Readable; length: number } {
  const { size, type = "video/mp4", head = MP4_HEAD, filename = "clip.mp4" } = opts;
  const preamble = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
  );
  const epilogue = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
  const zeros = Buffer.alloc(MB);

  function* chunks() {
    yield preamble;
    const first = head.subarray(0, Math.min(head.length, size));
    yield first;
    let left = size - first.length;
    while (left > 0) {
      const n = Math.min(left, zeros.length);
      yield zeros.subarray(0, n);
      left -= n;
    }
    yield epilogue;
  }

  return {
    stream: Readable.from(chunks(), { objectMode: false }),
    length: preamble.length + size + epilogue.length,
  };
}

async function upload(
  body: { stream: Readable; length: number },
  headers: Record<string, string> = { "x-test-role": "admin", [MEDIA_UPLOAD_VIDEO_HEADER]: "1" },
  query = "?prefix=hero",
) {
  const res = await instance.inject({
    method: "POST",
    url: `${MEDIA_UPLOAD_VIDEO_ENDPOINT}${query}`,
    headers: {
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      "content-length": String(body.length),
      ...headers,
    },
    payload: body.stream,
  });
  return { status: res.statusCode, json: res.json() as Record<string, any> };
}

async function storedFiles(uploadsDir: string): Promise<string[]> {
  return readdir(uploadsDir).catch(() => []);
}

describe("video upload route — sizes", () => {
  const accepted: Array<[string, number]> = [
    ["24MB", 24 * MB],
    ["25MB (the old ceiling)", 25 * MB],
    ["59MB (the production file)", 59 * MB],
    ["exactly 100MB (inclusive limit)", MEDIA_UPLOAD_VIDEO_MAX_BYTES],
  ];

  for (const [label, size] of accepted) {
    it(`accepts a ${label} video and stores every byte`, async () => {
      const { status, json } = await upload(multipartBody({ size }));

      expect(status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.url).toMatch(/^\/uploads\/homepage\/hero-[0-9a-f-]+\.mp4$/);
      expect(json.data.kind).toBe("video");
      const files = await storedFiles(dir);
      expect(files).toEqual([json.data.filename]);
      expect((await stat(path.join(dir, json.data.filename))).size).toBe(size);
    }, 60_000);
  }

  it("refuses 100MB + 1 byte with the shared message and keeps nothing", async () => {
    const { status, json } = await upload(
      multipartBody({ size: MEDIA_UPLOAD_VIDEO_MAX_BYTES + 1 }),
    );

    expect(status).toBe(413);
    expect(json).toEqual({ success: false, error: videoTooLargeMessage() });
    expect(await storedFiles(dir)).toEqual([]);
  }, 60_000);

  it("refuses a declared body far over the limit before reading it", async () => {
    // Claims 150MB but carries almost nothing: refused on the header alone.
    const small = multipartBody({ size: 1024 });
    const { status, json } = await upload({ ...small, length: 150 * MB });

    expect(status).toBe(413);
    expect(json.error).toBe(videoTooLargeMessage());
    expect(await storedFiles(dir)).toEqual([]);
  });
});

describe("video upload route — what it accepts", () => {
  it("accepts WebM", async () => {
    const { status, json } = await upload(
      multipartBody({ size: 2 * MB, type: "video/webm", head: WEBM_HEAD, filename: "clip.webm" }),
    );
    expect(status).toBe(200);
    expect(json.data.url).toMatch(/\.webm$/);
  });

  const refusedTypes: Array<[string, string]> = [
    ["an image", "image/png"],
    ["a PDF", "application/pdf"],
    ["an executable", "application/x-msdownload"],
    ["HTML", "text/html"],
  ];
  for (const [label, type] of refusedTypes) {
    it(`refuses ${label} (${type})`, async () => {
      const { status, json } = await upload(
        multipartBody({ size: 1024, type, filename: "x.bin" }),
      );
      expect(status).toBe(400);
      expect(json.success).toBe(false);
      expect(await storedFiles(dir)).toEqual([]);
    });
  }

  it("refuses a non-video renamed to .mp4 and keeps nothing on disk", async () => {
    // A Windows executable header, declared as video/mp4.
    const exe = Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00", "latin1");
    const { status, json } = await upload(
      multipartBody({ size: 3 * MB, head: exe, filename: "setup.mp4" }),
    );
    expect(status).toBe(400);
    expect(json.error).toMatch(/not a valid MP4, WebM or MOV video/);
    expect(await storedFiles(dir)).toEqual([]);
  });

  it("refuses an empty file", async () => {
    const { status } = await upload(multipartBody({ size: 0 }));
    expect(status).toBe(400);
    expect(await storedFiles(dir)).toEqual([]);
  });

  it("keeps the stored name safe whatever prefix and filename are sent", async () => {
    const { status, json } = await upload(
      multipartBody({ size: 1024, filename: "../../evil.sh" }),
      undefined,
      `?prefix=${encodeURIComponent("../../etc/passwd")}`,
    );
    expect(status).toBe(200);
    expect(json.data.filename).toMatch(/^[a-z0-9-]+\.mp4$/);
    expect(await storedFiles(dir)).toEqual([json.data.filename]);
  });
});

describe("video upload route — who may upload", () => {
  const cases: Array<[string, Record<string, string>, number]> = [
    ["a signed-out visitor", { [MEDIA_UPLOAD_VIDEO_HEADER]: "1" }, 401],
    ["a customer account", { "x-test-role": "user", [MEDIA_UPLOAD_VIDEO_HEADER]: "1" }, 403],
    ["a vendor account", { "x-test-role": "vendor", [MEDIA_UPLOAD_VIDEO_HEADER]: "1" }, 403],
    ["an admin without the CMS header (cross-site form)", { "x-test-role": "admin" }, 403],
  ];
  for (const [label, headers, expected] of cases) {
    it(`refuses ${label}`, async () => {
      const { status, json } = await upload(multipartBody({ size: 1024 }), headers);
      expect(status).toBe(expected);
      expect(json.success).toBe(false);
      expect(await storedFiles(dir)).toEqual([]);
    });
  }

  it("lets a superadmin upload", async () => {
    const { status } = await upload(multipartBody({ size: 1024 }), {
      "x-test-role": "superadmin",
      [MEDIA_UPLOAD_VIDEO_HEADER]: "1",
    });
    expect(status).toBe(200);
  });
});

describe("one limit on both sides", () => {
  it("is 100MB for video, and images and PDFs keep 10MB", () => {
    expect(MEDIA_UPLOAD_VIDEO_MAX_BYTES).toBe(100 * MB);
    expect(MAX_BYTES.video).toBe(MEDIA_UPLOAD_VIDEO_MAX_BYTES);
    expect(MAX_BYTES.image).toBe(10 * MB);
    expect(MAX_BYTES.document).toBe(10 * MB);
  });

  it("leaves the tRPC path refusing oversize images and unknown types as before", async () => {
    // Both refusals happen before anything is written to disk.
    const run = (bytes: number, mimeType: string) =>
      Effect.runPromise(
        Effect.either(uploadHomepageMedia({ buffer: new Uint8Array(bytes), mimeType })),
      );

    const image = await run(10 * MB + 1, "image/png");
    expect(image._tag === "Left" && image.left.message).toBe(
      "File too large. Maximum size for image uploads is 10MB.",
    );
    const pdf = await run(10 * MB + 1, "application/pdf");
    expect(pdf._tag === "Left" && pdf.left.message).toBe(
      "File too large. Maximum size for document uploads is 10MB.",
    );
    const exe = await run(10, "application/x-msdownload");
    expect(exe._tag === "Left" && exe.left.message).toMatch(/^Unsupported file type/);
  });

  it("the CMS refuses exactly what the server refuses, in the same words", () => {
    const limit = MEDIA_UPLOAD_VIDEO_MAX_BYTES;
    expect(oversizeVideoMessage({ type: "video/mp4", size: limit })).toBeNull();
    const client = oversizeVideoMessage({ type: "video/mp4", size: limit + 1 });
    expect(client).toBe(videoTooLargeMessage(limit + 1));
    // The server stops reading at the limit, so it states the ceiling rather
    // than the size; everything after the first sentence is identical.
    const tail = (msg: string) => msg.slice(msg.indexOf(".") + 1);
    expect(tail(client!)).toBe(tail(videoTooLargeMessage()));
    expect(client).toContain("100MB or smaller");
  });
});

describe("hasVideoSignature", () => {
  it("recognises MP4/MOV boxes and the WebM EBML header", () => {
    expect(hasVideoSignature("video/mp4", MP4_HEAD)).toBe(true);
    expect(hasVideoSignature("video/quicktime", Buffer.from("\0\0\0\x14moov\0\0\0\0", "latin1"))).toBe(true);
    expect(hasVideoSignature("video/webm", WEBM_HEAD)).toBe(true);
  });

  it("refuses the wrong container for the declared type, and short input", () => {
    expect(hasVideoSignature("video/webm", MP4_HEAD)).toBe(false);
    expect(hasVideoSignature("video/mp4", WEBM_HEAD)).toBe(false);
    expect(hasVideoSignature("video/mp4", Buffer.from("<html><body>", "latin1"))).toBe(false);
    expect(hasVideoSignature("video/mp4", Buffer.alloc(4))).toBe(false);
  });
});
