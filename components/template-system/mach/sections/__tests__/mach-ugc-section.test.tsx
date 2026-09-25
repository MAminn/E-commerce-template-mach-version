import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_HOMEPAGE_CONTENT,
  type HomepageUgcContent,
  type UgcVideoItem,
} from "#root/shared/types/homepage-content";
import {
  MachUgcSection,
  ugcVideoFit,
  ugcVideoLabel,
} from "../MachUgcSection";
import { TRACK_GUTTER } from "../MachProductCarousel";

/**
 * What the UGC / "Judge Me" section puts on the page.
 *
 * Static markup, like the other Mach section tests: whether the section
 * renders, which CMS words and URLs reach it, and the attributes that decide
 * how much a homepage visit downloads and whether anything plays on its own.
 * None of that needs a browser.
 */

function render(content: HomepageUgcContent): string {
  return renderToStaticMarkup(<MachUgcSection content={content} />);
}

function ugc(patch: Partial<HomepageUgcContent> = {}): HomepageUgcContent {
  return { ...(DEFAULT_HOMEPAGE_CONTENT.ugc as HomepageUgcContent), ...patch };
}

function video(n: number, patch: Partial<UgcVideoItem> = {}): UgcVideoItem {
  return { id: `ugc-${n}`, videoUrl: `/uploads/homepage/ugc-${n}.mp4`, ...patch };
}

/** Every `<video …>` opening tag in the markup. */
function videoTags(html: string): string[] {
  return html.match(/<video\b[^>]*>/g) ?? [];
}

describe("MachUgcSection — when it renders at all", () => {
  it("renders nothing when switched off, even with videos", () => {
    expect(render(ugc({ enabled: false, items: [video(1)] }))).toBe("");
  });

  it("renders nothing when switched on with no items", () => {
    expect(render(ugc({ enabled: true, items: [] }))).toBe("");
  });

  it("renders nothing when every row is still waiting for its upload", () => {
    expect(
      render(ugc({ enabled: true, items: [video(1, { videoUrl: "  " })] })),
    ).toBe("");
  });

  it("renders when switched on with a video", () => {
    const html = render(ugc({ enabled: true, items: [video(1)] }));

    expect(html).toContain('data-testid="mach-ugc"');
    expect(videoTags(html)).toHaveLength(1);
  });

  it("ships off and empty: the defaults put nothing on the page", () => {
    expect(render(DEFAULT_HOMEPAGE_CONTENT.ugc as HomepageUgcContent)).toBe("");
    expect(DEFAULT_HOMEPAGE_CONTENT.ugc?.items).toEqual([]);
  });
});

describe("MachUgcSection — CMS content", () => {
  it("shows the heading, eyebrow and subheading from the CMS", () => {
    const html = render(
      ugc({
        enabled: true,
        eyebrow: "REAL ATHLETES",
        heading: "SEE IT WORK",
        subheading: "Unfiltered, from the people who train on it.",
        items: [video(1)],
      }),
    );

    expect(html).toContain("REAL ATHLETES");
    expect(html).toContain("SEE IT WORK");
    expect(html).toContain("Unfiltered, from the people who train on it.");
    expect(html).toMatch(/<h2[^>]*>SEE IT WORK<\/h2>/);
  });

  it("uses the shipped JUDGE ME heading and UGC eyebrow by default", () => {
    const html = render(ugc({ enabled: true, items: [video(1)] }));

    expect(html).toMatch(/<h2[^>]*>JUDGE ME<\/h2>/);
    expect(html).toContain("UGC");
  });

  it("invents no heading when the owner cleared it", () => {
    const html = render(
      ugc({ enabled: true, heading: "", eyebrow: "", items: [video(1)] }),
    );

    expect(html).not.toContain("<h2");
    expect(html).not.toContain("JUDGE ME");
  });

  it("puts the CMS video URL and poster on the video", () => {
    const html = render(
      ugc({
        enabled: true,
        items: [video(7, { posterUrl: "/uploads/homepage/ugc-poster-7.webp" })],
      }),
    );
    const [tag] = videoTags(html);

    expect(tag).toContain('src="/uploads/homepage/ugc-7.mp4"');
    expect(tag).toContain('poster="/uploads/homepage/ugc-poster-7.webp"');
  });

  it("renders creator name, handle and caption only when present", () => {
    const html = render(
      ugc({
        enabled: true,
        items: [
          video(1, {
            creatorName: "Omar K.",
            creatorHandle: "omar.lifts",
            caption: "Week 6 on the stack.",
          }),
          video(2, { creatorHandle: "@@nour.trains" }),
          video(3),
        ],
      }),
    );

    expect(html).toContain("Omar K.");
    // One leading "@", however the owner typed it.
    expect(html).toContain("@omar.lifts");
    expect(html).toContain("@nour.trains");
    expect(html).not.toContain("@@");
    expect(html).toContain("Week 6 on the stack.");
    // The bare third card carries no credit block at all.
    const cards = html.split("data-mach-ugc-card").slice(1);
    expect(cards).toHaveLength(3);
    expect(cards[2]).not.toContain('class="mt-3 min-w-0"');
    expect(cards[1]).not.toContain("uppercase leading-snug tracking-[0.14em]");
  });

  it("adds nothing the owner did not supply", () => {
    // A single bare video: the only words on the section are the CMS heading
    // and eyebrow, plus accessible names for controls. No placeholder
    // creator, handle, caption or quote.
    const html = render(ugc({ enabled: true, items: [video(1)] }));
    const visibleText = html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    expect(visibleText).toBe("UGC JUDGE ME");
    expect(videoTags(html)).toHaveLength(1);
  });

  it("keeps the CMS order", () => {
    const html = render(
      ugc({ enabled: true, items: [video(3), video(1), video(8), video(2)] }),
    );
    const srcs = videoTags(html).map((t) => t.match(/src="([^"]+)"/)?.[1]);

    expect(srcs).toEqual([
      "/uploads/homepage/ugc-3.mp4",
      "/uploads/homepage/ugc-1.mp4",
      "/uploads/homepage/ugc-8.mp4",
      "/uploads/homepage/ugc-2.mp4",
    ]);
  });

  it("drops a removed item and skips a draft row without disturbing order", () => {
    const html = render(
      ugc({
        enabled: true,
        items: [video(1), video(2, { videoUrl: "" }), video(3)],
      }),
    );

    expect(videoTags(html)).toHaveLength(2);
    expect(html).not.toContain("ugc-2.mp4");
  });
});

describe("MachUgcSection — playback and loading", () => {
  const html = render(
    ugc({
      enabled: true,
      items: [video(1), video(2, { posterUrl: "/uploads/homepage/p.webp" })],
    }),
  );
  const tags = videoTags(html);

  it("never preloads the video file itself", () => {
    // Server markup is preload="none" for every card; a card without a poster
    // upgrades itself to "metadata" only once it nears the viewport.
    for (const tag of tags) {
      expect(tag).toContain('preload="none"');
      expect(tag).not.toMatch(/preload="auto"/);
    }
  });

  it("never autoplays, with or without sound", () => {
    for (const tag of tags) {
      expect(tag).not.toMatch(/autoplay/i);
      expect(tag).not.toMatch(/\bloop\b/);
    }
  });

  it("plays inline on phones", () => {
    for (const tag of tags) expect(tag).toMatch(/playsinline/i);
  });

  it("shows a keyboard-reachable play button per video, and no native controls yet", () => {
    for (const tag of tags) expect(tag).not.toMatch(/\bcontrols\b/);
    const buttons = html.match(/<button type="button" aria-label="Play [^"]+"/g);
    expect(buttons).toHaveLength(2);
  });

  it("labels each video and its play control", () => {
    expect(html).toContain('aria-label="Customer video 1 of 2"');
    expect(html).toContain('aria-label="Play Customer video 2 of 2"');
    expect(
      ugcVideoLabel({ creatorName: "Omar K." }, 0, 4),
    ).toBe("Customer video 1 of 4, by Omar K.");
    expect(ugcVideoLabel({ creatorHandle: "omar" }, 1, 4)).toBe(
      "Customer video 2 of 4, by @omar",
    );
  });

  it("holds a 9:16 frame before any media loads", () => {
    expect(html.match(/aspect-\[9\/16\]/g)).toHaveLength(2);
  });
});

describe("MachUgcSection — layout", () => {
  const html = render(
    ugc({ enabled: true, items: Array.from({ length: 8 }, (_, i) => video(i)) }),
  );

  it("scrolls natively with snap points, on the carousel's own gutter", () => {
    const track = html.match(/<ul[^>]*data-testid="mach-ugc-track"[^>]*>/)?.[0] ?? "";

    expect(track).toContain("overflow-x-auto");
    expect(track).toContain("snap-x");
    expect(track).toContain('tabindex="0"');
    // The bleed and the padding that pays it back are the same numbers, so
    // the track spans the viewport exactly and never widens the page.
    for (const cls of TRACK_GUTTER.split(" ")) expect(track).toContain(cls);
  });

  it("sizes a phone card to one prominent card plus a peek", () => {
    expect(html).toContain("w-[min(78vw,18.5rem)]");
    // Desktop cards stay inside the 240-300px band.
    expect(html).toContain("sm:w-[15rem]");
    expect(html).toContain("2xl:w-[18.75rem]");
  });

  it("letterboxes landscape and square uploads instead of cropping them", () => {
    expect(ugcVideoFit(1080, 1920)).toBe("cover");
    expect(ugcVideoFit(720, 1280)).toBe("cover");
    // 4:5 is close enough to vertical that it is not the case this guards.
    expect(ugcVideoFit(1920, 1080)).toBe("contain");
    expect(ugcVideoFit(1080, 1080)).toBe("contain");
    expect(ugcVideoFit(0, 0)).toBe("cover");
  });
});

describe("LandingTemplateMach — the ugc key", () => {
  it("renders MachUgcSection for the ugc section-order entry", () => {
    const source = readFileSync(
      path.resolve(
        __dirname,
        "../../../landing/LandingTemplateMach.tsx",
      ),
      "utf8",
    );
    const ugcCase = source.slice(source.indexOf('case "ugc":'));

    expect(ugcCase.slice(0, 400)).toContain(
      "<MachUgcSection key={key} content={content.ugc} />",
    );
  });
});
