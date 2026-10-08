import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  MEDIA_UPLOAD_PREFIX_MAX_LENGTH,
  MEDIA_UPLOAD_VIDEO_ENDPOINT,
  MEDIA_UPLOAD_VIDEO_HEADER,
  MEDIA_UPLOAD_VIDEO_MAX_BYTES,
  normalizeMediaUploadPrefix,
} from "#root/shared/types/media-upload";
import { homepageRouter } from "#root/backend/homepage/trpc";
import {
  IMAGE_TYPES,
  VIDEO_TYPES,
} from "#root/backend/homepage/upload-media";
import { ACCEPT_BY_KIND } from "../MediaSlotField";
import {
  mediaUploadPayload,
  safeUploadErrorMessage,
  uploadMediaFile,
} from "../uploadMediaFile";

/**
 * The CMS upload path, at the seam where it actually broke.
 *
 * Section background uploads failed with "Error uploading file" while every
 * existing media slot kept working, and the difference was one field: the
 * prefix. `homepage.uploadMedia` caps it at 24 characters, every existing
 * caller passes a short literal ("hero", "campaign"), and the new control
 * built one from client data — `section-bg-` plus a group's slug — which a
 * group called "Stacks & Bundles" pushes to 29. The mutation's input schema
 * refused the request before the procedure ran, the thrown error landed in the
 * client's catch, and the admin was told their file was the problem.
 *
 * So the assertions that matter are made against the *real* schema pulled off
 * the router, with the prefixes the CMS really constructs. A test that
 * re-declared the limit would have passed on the day this broke.
 */

const uploadMediaInput = (
  homepageRouter as unknown as {
    _def: {
      procedures: { uploadMedia: { _def: { inputs: z.ZodTypeAny[] } } };
    };
  }
)._def.procedures.uploadMedia._def.inputs[0] as z.ZodTypeAny;

const mutate = vi.fn();
vi.mock("#root/shared/trpc/client", () => ({
  trpc: { homepage: { uploadMedia: { mutate: (input: unknown) => mutate(input) } } },
}));

function file(name = "shot.png", type = "image/png"): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
}

const MB = 1024 * 1024;

/** A file that reports `size` without allocating it. */
function sized(f: File, size: number): File {
  Object.defineProperty(f, "size", { value: size });
  return f;
}

const fetchMock = vi.fn();
vi.stubGlobal("fetch", (...args: unknown[]) => fetchMock(...args));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Whether the real mutation would accept what the client is about to send. */
function accepted(payload: unknown): z.SafeParseReturnType<unknown, unknown> {
  return uploadMediaInput.safeParse(payload);
}

beforeEach(() => {
  mutate.mockReset();
  fetchMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/* ================================================================== */
/*  The root cause                                                    */
/* ================================================================== */

describe("the prefix a section background uploads under", () => {
  // Every prefix the CMS builds, including the group names this store
  // actually carries. The long ones are the ones that used to fail.
  const CMS_PREFIXES = [
    "sec-bg-supplements",
    "sec-bg-stacks-and-bundles",
    "sec-bg-gym-gear",
    "sec-bg-protein-powder",
    "sec-bg-Best Sellers",
    "sec-bg-New Drops",
    "sec-bg-Featured",
    "sec-bg-Offers",
    // A group named in Arabic, which this store has: the slug sanitises away
    // to nothing and must still produce a usable prefix.
    "sec-bg-مكملات",
  ];

  it.each(CMS_PREFIXES)("is accepted by the real mutation: %s", (prefix) => {
    const payload = mediaUploadPayload(
      { name: "shot.png", type: "image/png" },
      new Uint8Array([1]),
      prefix,
    );

    expect(payload.prefix.length).toBeLessThanOrEqual(
      MEDIA_UPLOAD_PREFIX_MAX_LENGTH,
    );
    expect(accepted(payload).success).toBe(true);
  });

  it("is what the mutation rejected before the fix", () => {
    // The exact failure: the unnormalised prefix, refused on the way in.
    const rejected = accepted({
      file: { name: "shot.png", type: "image/png", buffer: new Uint8Array([1]) },
      prefix: "section-bg-stacks-and-bundles",
    });

    expect(rejected.success).toBe(false);
  });

  it("stays readable rather than being cut to a stub", () => {
    expect(normalizeMediaUploadPrefix("sec-bg-supplements")).toBe(
      "sec-bg-supplements",
    );
    // Truncated, never left ending on a dash.
    expect(normalizeMediaUploadPrefix("sec-bg-stacks-and-bundles")).toBe(
      "sec-bg-stacks-and-bundle",
    );
    expect(normalizeMediaUploadPrefix("sec-bg-مكملات")).toBe("sec-bg");
    expect(normalizeMediaUploadPrefix("")).toBe("media");
  });

  it("leaves the prefixes existing slots already use untouched", () => {
    // Hero, campaign banners, certificates and the factory shot upload under
    // these; normalisation must be a no-op for all of them.
    for (const prefix of [
      "hero",
      "hero-product",
      "campaign",
      "certificate",
      "factory",
      "shop-hero",
      "media",
    ]) {
      expect(normalizeMediaUploadPrefix(prefix)).toBe(prefix);
    }
  });
});

/* ================================================================== */
/*  What gets sent                                                    */
/* ================================================================== */

describe("the upload payload", () => {
  it("matches what the mutation expects, for image and for video", () => {
    const image = mediaUploadPayload(
      { name: "shot.jpg", type: "image/jpeg" },
      new Uint8Array([1, 2, 3]),
      "sec-bg-offers",
    );
    const video = mediaUploadPayload(
      { name: "loop.mp4", type: "video/mp4" },
      new Uint8Array([1, 2, 3]),
      "sec-bg-offers",
    );

    expect(image.file).toEqual({
      name: "shot.jpg",
      type: "image/jpeg",
      buffer: new Uint8Array([1, 2, 3]),
    });
    expect(accepted(image).success).toBe(true);
    expect(accepted(video).success).toBe(true);
  });

  it("is sent through the one mutation call in the CMS", async () => {
    mutate.mockResolvedValue({
      success: true,
      data: { url: "/uploads/homepage/sec-bg-offers-1.webp" },
    });

    const outcome = await uploadMediaFile(file(), "sec-bg-offers");

    expect(mutate).toHaveBeenCalledTimes(1);
    const [sent] = mutate.mock.calls[0] ?? [];
    expect(accepted(sent).success).toBe(true);
    expect(outcome).toEqual({
      ok: true,
      url: "/uploads/homepage/sec-bg-offers-1.webp",
    });
  });

  it("refuses an oversize video before reading or sending it", async () => {
    // Every CMS video slot uploads through here, with the limit the server
    // enforces. The file is never read into memory or put on the wire.
    const big = sized(file("clip.mp4", "video/mp4"), MEDIA_UPLOAD_VIDEO_MAX_BYTES + 1);
    const read = vi.spyOn(big, "arrayBuffer");

    const outcome = await uploadMediaFile(big, "ugc");

    expect(outcome).toEqual({
      ok: false,
      message:
        "Video is 101MB. Videos must be 100MB or smaller — export at 1080p or compress it, then upload again.",
    });
    expect(read).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams a 59MB hero video to the multipart endpoint, not through tRPC", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { success: true, data: { url: "/uploads/homepage/hero-1.mp4" } }),
    );
    const hero = sized(file("hero.mp4", "video/mp4"), 59 * MB);
    const read = vi.spyOn(hero, "arrayBuffer");

    const outcome = await uploadMediaFile(hero, "hero");

    expect(mutate).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${MEDIA_UPLOAD_VIDEO_ENDPOINT}?prefix=hero`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers[MEDIA_UPLOAD_VIDEO_HEADER]).toBe("1");
    // The file itself is the body part, never a buffer read from it; the
    // browser streams it.
    const part = (init.body as FormData).get("file");
    expect(part).toBeInstanceOf(File);
    expect(part).toMatchObject({ name: "hero.mp4", type: "video/mp4" });
    expect(outcome).toMatchObject({ ok: true, url: "/uploads/homepage/hero-1.mp4" });
    // Accepted, with a word about what it costs the storefront.
    expect(outcome?.ok && outcome.notice).toMatch(/59MB/);
  });

  it("sends a video of exactly 100MB, and warns only about heavy ones", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { success: true, data: { url: "/u.mp4" } }),
    );
    const atLimit = sized(file("clip.mp4", "video/mp4"), MEDIA_UPLOAD_VIDEO_MAX_BYTES);
    const light = sized(file("loop.mp4", "video/mp4"), 8 * MB);

    expect((await uploadMediaFile(atLimit, "hero"))?.ok).toBe(true);
    expect(await uploadMediaFile(light, "hero")).toEqual({ ok: true, url: "/u.mp4" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still sends images through the mutation, never size-checked here", async () => {
    mutate.mockResolvedValue({ success: true, data: { url: "/u.webp" } });
    const bigImage = sized(file("shot.png", "image/png"), 60 * MB);

    expect((await uploadMediaFile(bigImage, "hero"))?.ok).toBe(true);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's own refusal, and a plain one when a proxy answers", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { success: false, error: "Unsupported video type. Allowed: MP4, WebM, MOV." }),
    );
    fetchMock.mockResolvedValueOnce(new Response("<html>413</html>", { status: 413 }));
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const clip = () => file("clip.mp4", "video/mp4");

    expect(await uploadMediaFile(clip(), "hero")).toEqual({
      ok: false,
      message: "Unsupported video type. Allowed: MP4, WebM, MOV.",
    });
    expect(await uploadMediaFile(clip(), "hero")).toEqual({
      ok: false,
      message: "Upload failed (413)",
    });
    expect(await uploadMediaFile(clip(), "hero")).toEqual({
      ok: false,
      message: "Error uploading file",
    });
  });

  it("does nothing at all when no file was chosen", async () => {
    // A cancelled picker fires a change event with an empty selection.
    expect(await uploadMediaFile(undefined, "sec-bg-offers")).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
/*  Accepted formats                                                  */
/* ================================================================== */

describe("the formats the picker offers", () => {
  it("offers only image types the server accepts", () => {
    for (const type of ACCEPT_BY_KIND.image.split(",")) {
      expect(IMAGE_TYPES).toContain(type);
    }
  });

  it("offers only video types the server accepts", () => {
    for (const type of ACCEPT_BY_KIND.video.split(",")) {
      expect(VIDEO_TYPES).toContain(type);
    }
  });
});

/* ================================================================== */
/*  What a failure says                                               */
/* ================================================================== */

describe("a failed upload", () => {
  it("passes the server's own explanation through", async () => {
    mutate.mockResolvedValue({
      success: false,
      error: "File too large. Maximum size for image uploads is 10MB.",
    });

    expect(await uploadMediaFile(file(), "sec-bg-offers")).toEqual({
      ok: false,
      message: "File too large. Maximum size for image uploads is 10MB.",
    });
  });

  it("shows a thrown error's message when it was written for a person", async () => {
    mutate.mockRejectedValue(
      new Error("Unauthorized. Only admins can upload homepage media."),
    );

    const outcome = await uploadMediaFile(file(), "sec-bg-offers");

    expect(outcome).toEqual({
      ok: false,
      message: "Unauthorized. Only admins can upload homepage media.",
    });
  });

  it("never shows a stack frame, a path or a serialised validation blob", () => {
    expect(
      safeUploadErrorMessage(
        new Error('[\n  {\n    "code": "too_big",\n    "path": ["prefix"]\n  }\n]'),
      ),
    ).toBeNull();
    expect(
      safeUploadErrorMessage(
        new Error("ENOENT: no such file or directory, open 'D:/app/uploads/x'"),
      ),
    ).toBeNull();
    // A stack trailing the message is cut off with the rest of the lines:
    // the admin gets the sentence, not the frame under it.
    expect(
      safeUploadErrorMessage(
        new Error("Upload failed.\n    at h (x.ts:1:2)"),
      ),
    ).toBe("Upload failed.");
    expect(safeUploadErrorMessage(new Error("File too large."))).toBe(
      "File too large.",
    );
  });

  it("falls back to the generic message when there is nothing safe to say", async () => {
    mutate.mockRejectedValue(new Error("fetch failed: /api/trpc 500:12:1"));

    expect(await uploadMediaFile(file(), "sec-bg-offers")).toEqual({
      ok: false,
      message: "Error uploading file",
    });
  });
});
