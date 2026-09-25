import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import type { z } from "zod";
import {
  DEFAULT_HOMEPAGE_CONTENT,
  MACH_LANDING_TEMPLATE_ID,
  type HomepageContent,
  type HomepageUgcContent,
} from "#root/shared/types/homepage-content";
import {
  createUgcItem,
  moveUgcItem,
  patchUgcItem,
  removeUgcItem,
  ugcSectionRenders,
} from "#root/shared/types/homepage-ugc";
import { mergeHomepageContentWithDefaults } from "../merge-homepage-content";
import { homepageRouter } from "../trpc";
import { uploadHomepageMedia } from "../upload-media";

/**
 * The UGC chain, end to end, minus the database: Homepage Admin state → the
 * real `updateContent` Zod schema → the jsonb round trip → the merge layer
 * every read goes through. The upload leg runs the real `uploadHomepageMedia`
 * with only the disk write mocked, so the URL it returns is the one saved.
 */

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
}));
vi.mock("node:fs", () => ({ existsSync: () => true }));

const MERCHANT_ID = "00000000-0000-0000-0000-000000000000";

const updateContentInput = (
  homepageRouter as unknown as {
    _def: { procedures: { updateContent: { _def: { inputs: z.ZodTypeAny[] } } } };
  }
)._def.procedures.updateContent._def.inputs[0] as z.ZodTypeAny;

function save(content: unknown): HomepageContent {
  const parsed = updateContentInput.safeParse({
    merchantId: MERCHANT_ID,
    templateId: MACH_LANDING_TEMPLATE_ID,
    content,
  });
  if (!parsed.success) {
    throw new Error(`save rejected: ${JSON.stringify(parsed.error.issues)}`);
  }
  return JSON.parse(
    JSON.stringify((parsed.data as { content: HomepageContent }).content),
  );
}

function saveAndReload(content: unknown): HomepageContent {
  return mergeHomepageContentWithDefaults(
    save(content) as Partial<HomepageContent>,
    MACH_LANDING_TEMPLATE_ID,
  );
}

function withUgc(ugc: unknown): HomepageContent {
  return { ...DEFAULT_HOMEPAGE_CONTENT, ugc } as HomepageContent;
}

/** The UGC block after a save and reload; fails the test if it went missing. */
function reloadedUgc(content: unknown): HomepageUgcContent {
  const ugc = saveAndReload(content).ugc;
  if (!ugc) throw new Error("ugc missing after reload");
  return ugc;
}

const CONFIGURED: HomepageUgcContent = {
  enabled: true,
  eyebrow: "REAL ATHLETES",
  heading: "JUDGE ME",
  subheading: "Straight from the gym floor.",
  items: [
    {
      id: "ugc-a",
      videoUrl: "/uploads/homepage/ugc-a.mp4",
      posterUrl: "/uploads/homepage/ugc-poster-a.webp",
      creatorName: "Omar K.",
      creatorHandle: "@omar.lifts",
      caption: "Week 6.",
    },
    { id: "ugc-b", videoUrl: "/uploads/homepage/ugc-b.webm" },
  ],
};

describe("saving UGC through the real homepage schema", () => {
  it("persists every field the admin edits", () => {
    const reloaded = saveAndReload(withUgc(CONFIGURED)).ugc;

    expect(reloaded).toEqual({
      ...CONFIGURED,
      items: [
        CONFIGURED.items[0],
        {
          id: "ugc-b",
          videoUrl: "/uploads/homepage/ugc-b.webm",
          posterUrl: undefined,
          creatorName: undefined,
          creatorHandle: undefined,
          caption: undefined,
        },
      ],
    });
    expect(ugcSectionRenders(reloaded)).toBe(true);
  });

  it("persists a poster added later, and clearing it", () => {
    const withPoster = reloadedUgc(
      withUgc({
        ...CONFIGURED,
        items: patchUgcItem(CONFIGURED.items, "ugc-b", {
          posterUrl: "/uploads/homepage/ugc-poster-b.webp",
        }),
      }),
    );
    expect(withPoster.items[1]?.posterUrl).toBe("/uploads/homepage/ugc-poster-b.webp");

    const cleared = reloadedUgc(
      withUgc({
        ...withPoster,
        items: patchUgcItem(withPoster.items, "ugc-b", { posterUrl: "" }),
      }),
    );
    expect(cleared.items[1]?.posterUrl).toBe("");
  });

  it("keeps the order the admin set", () => {
    const reordered = moveUgcItem(CONFIGURED.items, "ugc-b", -1);
    const reloaded = reloadedUgc(withUgc({ ...CONFIGURED, items: reordered }));

    expect(reloaded.items.map((i) => i.id)).toEqual(["ugc-b", "ugc-a"]);
  });

  it("forgets a removed video", () => {
    const reloaded = reloadedUgc(
      withUgc({ ...CONFIGURED, items: removeUgcItem(CONFIGURED.items, "ugc-a") }),
    );

    expect(reloaded.items.map((i) => i.id)).toEqual(["ugc-b"]);
    expect(JSON.stringify(reloaded)).not.toContain("ugc-a.mp4");
  });

  it("keeps a draft row through save so the owner can finish it", () => {
    const reloaded = reloadedUgc(
      withUgc({ ...CONFIGURED, items: [createUgcItem("ugc-new")] }),
    );

    expect(reloaded.items.map((i) => i.id)).toEqual(["ugc-new"]);
    expect(ugcSectionRenders(reloaded)).toBe(false);
  });

  it("persists the switch and the copy", () => {
    const reloaded = reloadedUgc(
      withUgc({ ...CONFIGURED, enabled: false, heading: "", eyebrow: "", subheading: "" }),
    );

    expect(reloaded.enabled).toBe(false);
    expect(reloaded.heading).toBe("");
    expect(reloaded.eyebrow).toBe("");
  });
});

describe("old content", () => {
  const LEGACY_STUB = { enabled: false, title: "", subtitle: "", reviewIds: [] };

  it("reads a stored blob carrying the reserved stub", () => {
    const reloaded = mergeHomepageContentWithDefaults(
      { ugc: LEGACY_STUB } as unknown as Partial<HomepageContent>,
      MACH_LANDING_TEMPLATE_ID,
    ).ugc;

    expect(reloaded).toEqual(DEFAULT_HOMEPAGE_CONTENT.ugc);
  });

  it("reads a blob with no ugc key at all", () => {
    expect(
      mergeHomepageContentWithDefaults({}, MACH_LANDING_TEMPLATE_ID).ugc,
    ).toEqual(DEFAULT_HOMEPAGE_CONTENT.ugc);
  });

  it("still accepts a save from a client holding the stub", () => {
    // A tab left open across the deploy sends the old shape once.
    const reloaded = reloadedUgc(withUgc(LEGACY_STUB));

    expect(reloaded).toEqual(DEFAULT_HOMEPAGE_CONTENT.ugc);
    expect(save(withUgc(LEGACY_STUB)).ugc).not.toHaveProperty("reviewIds");
  });

  it("rejects an item with no id", () => {
    expect(() =>
      save(withUgc({ enabled: true, items: [{ id: "", videoUrl: "/x.mp4" }] })),
    ).toThrow(/save rejected/);
  });
});

describe("the upload that feeds it", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a /uploads/homepage URL for an MP4, which is what gets saved", async () => {
    const result = await Effect.runPromise(
      uploadHomepageMedia({
        buffer: new Uint8Array([0, 0, 0, 24]),
        mimeType: "video/mp4",
        prefix: "ugc",
      }),
    );

    expect(result.kind).toBe("video");
    expect(result.url).toMatch(/^\/uploads\/homepage\/ugc-[0-9a-f-]{36}\.mp4$/);

    const reloaded = reloadedUgc(
      withUgc({ ...CONFIGURED, items: [{ id: "ugc-up", videoUrl: result.url }] }),
    );
    expect(reloaded.items[0]?.videoUrl).toBe(result.url);
  });

  it("stores WebM with its own extension", async () => {
    const result = await Effect.runPromise(
      uploadHomepageMedia({ buffer: new Uint8Array([1]), mimeType: "video/webm", prefix: "ugc" }),
    );
    expect(result.url).toMatch(/\.webm$/);
  });

  it("refuses a type the server does not take", async () => {
    await expect(
      Effect.runPromise(
        uploadHomepageMedia({ buffer: new Uint8Array([1]), mimeType: "video/x-matroska" }),
      ),
    ).rejects.toThrow(/Unsupported file type/);
  });
});
