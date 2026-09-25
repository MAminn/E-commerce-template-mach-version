import { describe, expect, it } from "vitest";
import SuperJSON from "superjson";
import {
  DEFAULT_SECTION_ORDER,
  ORDERABLE_SECTION_KEYS,
  SECTION_LABELS,
  resolveSectionOrder,
  type UgcVideoItem,
} from "../homepage-content";
import {
  UGC_VIDEO_ACCEPT,
  createUgcItem,
  formatUgcHandle,
  moveUgcItem,
  normalizeUgcContent,
  patchUgcItem,
  removeUgcItem,
  renderableUgcItems,
  ugcSectionRenders,
} from "../homepage-ugc";
import {
  MEDIA_UPLOAD_VIDEO_MAX_BYTES,
  oversizeVideoMessage,
} from "../media-upload";
import { VIDEO_TYPES } from "#root/backend/homepage/upload-media";

const item = (id: string, videoUrl = `/uploads/homepage/${id}.mp4`): UgcVideoItem => ({
  id,
  videoUrl,
});

describe("normalizeUgcContent", () => {
  it("reads the old reserved Community stub as the new shape", () => {
    // Exactly what DEFAULT_HOMEPAGE_CONTENT.ugc used to be, and what stores
    // that saved Homepage Admin before this change still hold.
    const legacy = { enabled: false, title: "", subtitle: "", reviewIds: [] };

    expect(normalizeUgcContent(legacy)).toEqual({
      enabled: false,
      eyebrow: "UGC",
      heading: "JUDGE ME",
      subheading: "",
      items: [],
    });
  });

  it("drops the stub's keys rather than carrying them into admin state", () => {
    const out = normalizeUgcContent({
      enabled: true,
      title: "Community",
      reviewIds: ["x"],
    }) as unknown as Record<string, unknown>;

    expect(out).not.toHaveProperty("title");
    expect(out).not.toHaveProperty("reviewIds");
    expect(out.enabled).toBe(true);
  });

  it("fills defaults for a missing blob", () => {
    expect(normalizeUgcContent(undefined).heading).toBe("JUDGE ME");
    expect(normalizeUgcContent(undefined).items).toEqual([]);
  });

  it("keeps a heading the owner deliberately cleared", () => {
    expect(normalizeUgcContent({ enabled: true, heading: "" }).heading).toBe("");
  });

  it("ignores malformed items instead of throwing", () => {
    const out = normalizeUgcContent({
      enabled: true,
      items: [null, "x", { videoUrl: "/a.mp4" }, { id: "ok", videoUrl: 4 }],
    });

    expect(out.items).toEqual([
      {
        id: "ok",
        videoUrl: "",
        posterUrl: undefined,
        creatorName: undefined,
        creatorHandle: undefined,
        caption: undefined,
      },
    ]);
  });
});

describe("when the section renders", () => {
  it("needs the switch on and at least one uploaded video", () => {
    expect(ugcSectionRenders({ enabled: false, heading: "", items: [item("a")] })).toBe(false);
    expect(ugcSectionRenders({ enabled: true, heading: "", items: [] })).toBe(false);
    expect(
      ugcSectionRenders({ enabled: true, heading: "", items: [item("a", " ")] }),
    ).toBe(false);
    expect(ugcSectionRenders({ enabled: true, heading: "", items: [item("a")] })).toBe(true);
    expect(ugcSectionRenders(undefined)).toBe(false);
  });

  it("keeps CMS order and skips draft rows", () => {
    const items = [item("c"), item("draft", ""), item("a")];
    expect(
      renderableUgcItems({ enabled: true, heading: "", items }).map((i) => i.id),
    ).toEqual(["c", "a"]);
  });
});

describe("creator handle", () => {
  it("is shown with exactly one leading @, or not at all", () => {
    expect(formatUgcHandle("mach.athlete")).toBe("@mach.athlete");
    expect(formatUgcHandle("@mach.athlete")).toBe("@mach.athlete");
    expect(formatUgcHandle("  @@x ")).toBe("@x");
    expect(formatUgcHandle("@")).toBe("");
    expect(formatUgcHandle(undefined)).toBe("");
  });
});

describe("admin list helpers", () => {
  const list = [item("a"), item("b"), item("c")];

  it("adds an empty row with no invented content", () => {
    expect(createUgcItem("ugc-1")).toEqual({
      id: "ugc-1",
      videoUrl: "",
      posterUrl: "",
      creatorName: "",
      creatorHandle: "",
      caption: "",
    });
  });

  it("patches one row by id", () => {
    const out = patchUgcItem(list, "b", { posterUrl: "/p.webp", caption: "c" });
    expect(out[1]).toEqual({ ...item("b"), posterUrl: "/p.webp", caption: "c" });
    expect(out[0]).toBe(list[0]);
  });

  it("removes one row by id", () => {
    expect(removeUgcItem(list, "b").map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("moves rows up and down, and ignores moves past either end", () => {
    expect(moveUgcItem(list, "c", -1).map((i) => i.id)).toEqual(["a", "c", "b"]);
    expect(moveUgcItem(list, "a", 1).map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect(moveUgcItem(list, "a", -1)).toBe(list);
    expect(moveUgcItem(list, "c", 1)).toBe(list);
    expect(moveUgcItem(list, "missing", 1)).toBe(list);
  });
});

describe("section order", () => {
  it("knows ugc as an orderable section with its CMS label", () => {
    expect(ORDERABLE_SECTION_KEYS).toContain("ugc");
    expect(SECTION_LABELS.ugc).toBe("UGC / Judge Me");
    expect(DEFAULT_SECTION_ORDER).toContain("ugc");
  });

  it("places ugc between certificates and the newsletter by default", () => {
    const order = resolveSectionOrder(undefined, []);
    expect(order.indexOf("ugc")).toBe(order.indexOf("certificates") + 1);
    expect(order.indexOf("newsletter")).toBe(order.indexOf("ugc") + 1);
  });

  it("keeps a position the owner chose", () => {
    const saved = ["ugc", "heroMarquee", "certificates", "newsletter"];
    expect(resolveSectionOrder(saved, []).slice(0, 2)).toEqual(["ugc", "heroMarquee"]);
  });

  it("splices ugc into an order saved without it", () => {
    const order = resolveSectionOrder(["certificates", "newsletter", "footerCta"], []);
    expect(order).toContain("ugc");
    expect(order.indexOf("ugc")).toBe(order.indexOf("certificates") + 1);
    expect(order.indexOf("newsletter")).toBe(order.indexOf("ugc") + 1);
  });
});

describe("video upload rules", () => {
  it("offers only MP4 and WebM, both of which the server accepts", () => {
    const types = UGC_VIDEO_ACCEPT.split(",");
    expect(types).toEqual(["video/mp4", "video/webm"]);
    for (const type of types) expect(VIDEO_TYPES).toContain(type);
    expect(types).not.toContain("video/quicktime");
  });

  it("refuses a video over the transport limit, before reading it", () => {
    const limit = MEDIA_UPLOAD_VIDEO_MAX_BYTES;
    expect(oversizeVideoMessage({ type: "video/mp4", size: limit })).toBeNull();
    expect(oversizeVideoMessage({ type: "video/mp4", size: limit + 1 })).toBe(
      "Video is 26MB. Videos must be 25MB or smaller — export at 1080p or compress it, then upload again.",
    );
    // Images keep their own server-side limits; this rule is video-only.
    expect(oversizeVideoMessage({ type: "image/png", size: limit * 2 })).toBeNull();
  });

  it("is the largest video that always fits the 100MiB request", () => {
    // SuperJSON sends a Uint8Array as a JSON array of numbers. The worst byte
    // (100-255) costs three digits and a comma, so four characters per byte
    // bounds any file, and 25MiB x 4 = the 100MiB body limit in server.ts.
    const worst = new Uint8Array(10_000).fill(255);
    const encoded = JSON.stringify(SuperJSON.serialize({ buffer: worst }).json);
    expect(encoded.length / worst.length).toBeLessThanOrEqual(4.01);
    expect(MEDIA_UPLOAD_VIDEO_MAX_BYTES * 4).toBe(100 * 1024 * 1024);
  });
});
