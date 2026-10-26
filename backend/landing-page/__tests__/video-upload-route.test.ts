import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MEDIA_UPLOAD_VIDEO_ENDPOINT,
  MEDIA_UPLOAD_VIDEO_HEADER,
} from "#root/shared/types/media-upload";
import {
  LANDING_MEDIA_VIDEO_ENDPOINT,
  canEditLandingPage,
} from "#root/shared/landing-page/config";
import { homepageVideoUploadApiPlugin } from "#root/backend/homepage/upload-media/video-api";

/**
 * Both instances of the streamed video route, mounted as server.ts mounts
 * them: the homepage one stays admin-only, the Landing 2 one also admits media
 * buyers. Same handler, same directory.
 */

const BOUNDARY = "----landing-test-boundary";
const MP4_HEAD = Buffer.from([0, 0, 0, 0x20, ...Buffer.from("ftypisom"), 0, 0, 2, 0]);

let dir: string;
let app: FastifyInstance;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "landing-video-upload-"));
  app = Fastify();
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
  app.decorateRequest("clientSession", undefined);
  app.addHook("onRequest", async (req) => {
    const role = req.headers["x-test-role"];
    req.clientSession =
      typeof role === "string"
        ? ({ id: "u1", role } as unknown as NonNullable<typeof req.clientSession>)
        : undefined;
  });
  await app.register(homepageVideoUploadApiPlugin, { uploadsDir: dir });
  await app.register(homepageVideoUploadApiPlugin, {
    uploadsDir: dir,
    endpoint: LANDING_MEDIA_VIDEO_ENDPOINT,
    isAllowedRole: canEditLandingPage,
    forbiddenMessage: "You do not have access to the landing page settings.",
  });
});

afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

function body() {
  const file = Buffer.concat([MP4_HEAD, Buffer.alloc(4096)]);
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="clip.mp4"\r\nContent-Type: video/mp4\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

async function post(url: string, role: string | null) {
  const payload = body();
  const res = await app.inject({
    method: "POST",
    url: `${url}?prefix=landing`,
    headers: {
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      "content-length": String(payload.length),
      [MEDIA_UPLOAD_VIDEO_HEADER]: "1",
      ...(role ? { "x-test-role": role } : {}),
    },
    payload,
  });
  return { status: res.statusCode, json: res.json() as Record<string, any> };
}

describe("Landing 2 video upload route", () => {
  it.each(["media_buyer", "admin", "superadmin"])("%s can upload a hero video", async (role) => {
    const { status, json } = await post(LANDING_MEDIA_VIDEO_ENDPOINT, role);
    expect(status).toBe(200);
    expect(json.data.url).toMatch(/^\/uploads\/homepage\/landing-[0-9a-f-]+\.mp4$/);
  });

  it.each(["user", "vendor"])("%s is refused", async (role) => {
    const { status, json } = await post(LANDING_MEDIA_VIDEO_ENDPOINT, role);
    expect(status).toBe(403);
    expect(json.error).toBe("You do not have access to the landing page settings.");
  });

  it("a guest is asked to sign in", async () => {
    const { status } = await post(LANDING_MEDIA_VIDEO_ENDPOINT, null);
    expect(status).toBe(401);
  });

  it("the homepage CMS route still refuses a media buyer", async () => {
    const before = await readdir(dir);
    const { status, json } = await post(MEDIA_UPLOAD_VIDEO_ENDPOINT, "media_buyer");
    expect(status).toBe(403);
    expect(json.error).toBe("Unauthorized. Only admins can upload homepage media.");
    expect(await readdir(dir)).toEqual(before);
  });
});
