import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { uploadsServingPlugin } from "../uploads-route";

/**
 * `/uploads/*` over real Fastify routing, so the wildcard is decoded exactly
 * as in production. Before the fix, `/uploads/..%2Fpackage.json` returned the
 * app's source; every escape below must 404 without a byte of the target.
 *
 *   <base>/secret.txt            outside uploads — must never be served
 *   <base>/uploads-evil/x.txt    a sibling sharing the "uploads" prefix
 *   <base>/uploads/              the served root
 */

const SECRET = "SECRET-MARKER-do-not-serve";
let base: string;
let uploads: string;
let app: FastifyInstance;
let junctionMade = false;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "mach-uploads-route-"));
  uploads = path.join(base, "uploads");
  await mkdir(path.join(uploads, "homepage"), { recursive: true });
  await mkdir(path.join(base, "uploads-evil"));
  await writeFile(path.join(base, "secret.txt"), SECRET);
  await writeFile(path.join(base, "uploads-evil", "x.txt"), SECRET);
  // Present at boot: gets its own @fastify/static route.
  await writeFile(path.join(uploads, "homepage", "boot.webp"), Buffer.from("RIFF0000WEBP"));

  app = Fastify();
  await app.register(uploadsServingPlugin, { uploadsRoot: uploads });
  await app.ready();

  // Uploaded after boot: only the catch-all can serve these.
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 0x20]),
    Buffer.from("ftypisom"),
    Buffer.alloc(4096),
  ]);
  await writeFile(path.join(uploads, "homepage", "late.mp4"), mp4);
  await writeFile(path.join(uploads, "late.html"), "<script>alert(1)</script>");
  // A link inside uploads/ pointing out of it. Junctions need no privileges
  // on Windows; elsewhere a directory symlink.
  try {
    await symlink(base, path.join(uploads, "escape"), process.platform === "win32" ? "junction" : "dir");
    junctionMade = true;
  } catch {
    junctionMade = false;
  }
});

afterAll(async () => {
  await app.close();
  await rm(base, { recursive: true, force: true });
});

const get = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "GET", url, headers });

describe("/uploads/* — escapes", () => {
  const escapes = [
    ["plain ../", "/uploads/../secret.txt"],
    ["encoded slash", "/uploads/..%2Fsecret.txt"],
    ["encoded dots", "/uploads/%2e%2e%2Fsecret.txt"],
    ["upper-case encoding", "/uploads/%2E%2E%2Fsecret.txt"],
    ["nested", "/uploads/homepage/..%2F..%2Fsecret.txt"],
    ["nested, fully encoded", "/uploads/homepage%2F..%2F..%2Fsecret.txt"],
    ["backslash", "/uploads/..%5Csecret.txt"],
    ["mixed slashes", "/uploads/homepage%5C..%2F..%5Csecret.txt"],
    ["sibling with the same prefix", "/uploads/..%2Fuploads-evil%2Fx.txt"],
    ["/proc/self/environ", "/uploads/..%2F..%2F..%2F..%2F..%2F..%2F..%2Fproc%2Fself%2Fenviron"],
    ["/etc/passwd absolute", "/uploads/%2Fetc%2Fpasswd"],
    ["NUL byte", "/uploads/homepage/late.mp4%00.txt"],
    ["double-encoded (stays literal)", "/uploads/..%252Fsecret.txt"],
  ] as const;

  for (const [label, url] of escapes) {
    it(`refuses ${label}: ${url}`, async () => {
      const res = await get(url);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(SECRET);
    });
  }

  it("refuses an absolute path to the real secret file", async () => {
    const res = await get(`/uploads/${encodeURIComponent(path.join(base, "secret.txt"))}`);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(SECRET);
  });

  it("refuses a link inside uploads/ that leads outside it", async (ctx) => {
    if (!junctionMade) ctx.skip();
    const res = await get("/uploads/escape/secret.txt");
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(SECRET);
  });
});

describe("/uploads/* — real files", () => {
  it("serves a file that existed at boot", async () => {
    const res = await get("/uploads/homepage/boot.webp");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/webp");
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });

  it("serves a video uploaded after boot as video/mp4 with Range support", async () => {
    const full = await get("/uploads/homepage/late.mp4");
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toBe("video/mp4");
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.headers["cross-origin-resource-policy"]).toBe("cross-origin");

    const part = await get("/uploads/homepage/late.mp4", { range: "bytes=0-1" });
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe("bytes 0-1/4108");
    expect(part.rawPayload.length).toBe(2);
  });

  it("keeps anything that is not media an opaque download", async () => {
    const res = await get("/uploads/late.html");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
  });

  it("404s a file that does not exist", async () => {
    expect((await get("/uploads/homepage/nope.mp4")).statusCode).toBe(404);
  });
});
