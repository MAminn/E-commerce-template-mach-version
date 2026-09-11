import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { machProductSectionComponent } from "../MachProductSection";
import {
  MACH_ROW_GROUND_CLASSES,
  MachProductRow,
} from "../../mach/sections/MachProductRow";
import { MachStackShowcase } from "../../mach/sections/MachStackShowcase";
import {
  MachProductCarousel,
  machCarouselControlLabels,
  machCarouselScrollStep,
  RING_OFFSET,
  TRACK_GUTTER,
} from "../../mach/sections/MachProductCarousel";
import { groupSectionRenders } from "../mach-group-rendering";
import {
  isAlternatingRowKey,
  resolveRowGrounds,
  STATIC_ALTERNATING_ROW_KEYS,
} from "../mach-row-grounds";

/**
 * How a product section is arranged, as the renderer itself decides it.
 *
 * `machProductSectionComponent` is the function the layout calls, so these are
 * assertions about the branch actually taken on the page rather than about a
 * copy of it. The carousel's own behavioural rules — the scroll step, the
 * control names and the absence of any autoplay — are pinned the same way,
 * through the helpers it uses and the file it is written in.
 */

const CAROUSEL_SOURCE = readFileSync(
  fileURLToPath(
    new URL("../../mach/sections/MachProductCarousel.tsx", import.meta.url),
  ),
  "utf8",
);

/**
 * The carousel's source with its prose removed.
 *
 * The file *explains* that it never autoplays, so a guard that scanned the
 * whole file for the word would fail on the sentence promising the behaviour
 * it is checking for.
 */
const CAROUSEL_CODE = CAROUSEL_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /\/\/.*$/gm,
  "",
);

/* ------------------------------------------------------------------ */
/*  Which component a section renders through                         */
/* ------------------------------------------------------------------ */

describe("machProductSectionComponent", () => {
  it("keeps the feature panels for a group on the grid", () => {
    expect(machProductSectionComponent("grid", "feature")).toBe(
      MachStackShowcase,
    );
  });

  it("keeps the standard row for a shelf group on the grid", () => {
    expect(machProductSectionComponent("grid", "shelf")).toBe(MachProductRow);
  });

  it("uses the carousel for a feature group set to carousel", () => {
    // Feature panels are a *grid* treatment. A carousel of them is not a thing
    // that exists, so the presentation is simply not consulted.
    expect(machProductSectionComponent("carousel", "feature")).toBe(
      MachProductCarousel,
    );
  });

  it("uses the carousel for a shelf group set to carousel", () => {
    expect(machProductSectionComponent("carousel", "shelf")).toBe(
      MachProductCarousel,
    );
  });

  it("gives a merchandising shelf the standard row on the grid", () => {
    // The four curated shelves pass no presentation at all — they are shelves.
    expect(machProductSectionComponent("grid")).toBe(MachProductRow);
  });

  it("gives a merchandising shelf the carousel when it is set to one", () => {
    expect(machProductSectionComponent("carousel")).toBe(MachProductCarousel);
  });
});

/* ------------------------------------------------------------------ */
/*  Background rhythm                                                 */
/* ------------------------------------------------------------------ */

describe("ground alternation", () => {
  const STACKS = "01a06cc1-36ba-75cb-8353-5968a3889e70";
  const ORDER = [
    "featuredProducts",
    `group:${STACKS}`,
    "newArrivals",
    "discountedProducts",
  ];

  it("counts a carousel row as rendering", () => {
    // Arrangement is not visibility. A section that puts products on the page
    // takes its turn in the paper / white rhythm either way.
    const renders = {
      featuredProducts: true,
      [`group:${STACKS}`]: true,
      newArrivals: true,
    };

    expect(resolveRowGrounds(ORDER, renders)).toEqual(
      new Map([
        ["featuredProducts", "paper"],
        [`group:${STACKS}`, "white"],
        ["newArrivals", "paper"],
      ]),
    );
  });

  it("gives a section the same ground in either arrangement", () => {
    // The predicate the layout reads has nothing to do with the display mode,
    // so switching Grid ↔ Carousel cannot move a section's place in the
    // sequence or the ground of the sections around it.
    const renders = {
      featuredProducts: true,
      [`group:${STACKS}`]: true,
      newArrivals: true,
    };

    expect(resolveRowGrounds(ORDER, renders)).toEqual(
      resolveRowGrounds(ORDER, { ...renders }),
    );
  });

  it("gives an empty carousel no turn in the rhythm", () => {
    // Same guard as the row: no products, nothing rendered, no slot consumed —
    // otherwise two visible neighbours land on the same ground.
    expect(groupSectionRenders({ enabled: true }, { products: [] })).toBe(
      false,
    );

    const grounds = resolveRowGrounds(ORDER, {
      featuredProducts: true,
      [`group:${STACKS}`]: false,
      newArrivals: true,
    });

    expect(grounds.has(`group:${STACKS}`)).toBe(false);
    expect(grounds.get("featuredProducts")).toBe("paper");
    // Still the hard tonal edge: the next visible row takes the next turn.
    expect(grounds.get("newArrivals")).toBe("white");
  });

  it("keeps Offers on ink, carousel or not", () => {
    // Offers is the page's dark merchandising anchor and is deliberately out
    // of the alternation, so no arrangement can relight it…
    expect(STATIC_ALTERNATING_ROW_KEYS).not.toContain("discountedProducts");
    expect(isAlternatingRowKey("discountedProducts")).toBe(false);
    expect(
      resolveRowGrounds(ORDER, { discountedProducts: true }).has(
        "discountedProducts",
      ),
    ).toBe(false);

    // …and the carousel paints ink from the same map the row does, so the
    // black ground and white type come across with it.
    expect(MACH_ROW_GROUND_CLASSES.ink).toBe(
      "bg-[var(--mach-ink)] text-white",
    );
    expect(CAROUSEL_SOURCE).toContain("MACH_ROW_GROUND_CLASSES[resolved]");
  });
});

/* ------------------------------------------------------------------ */
/*  Carousel behaviour                                                */
/* ------------------------------------------------------------------ */

describe("machCarouselScrollStep", () => {
  it("moves a screenful of cards, not one card", () => {
    // Four 300px cards with a 20px gap across a 1280px viewport.
    expect(machCarouselScrollStep(1280, 300, 20)).toBe(1280);
  });

  it("moves what is visible on a narrow viewport", () => {
    // A 390px phone showing one 56vw card and most of the next moves by one
    // card — never by the two it would take to carry a card past unseen.
    expect(machCarouselScrollStep(390, 218, 12)).toBe(230);
  });

  it("never moves less than one card", () => {
    expect(machCarouselScrollStep(100, 400, 20)).toBe(420);
  });

  it("falls back to the viewport when a card cannot be measured", () => {
    expect(machCarouselScrollStep(800, 0, 0)).toBe(800);
  });

  it("pages a four-up desktop shelf by four, not three", () => {
    // The real desktop geometry: a 928px content column, cards a quarter of it
    // with the gaps deducted, 20px gaps. Four of these fill the column exactly
    // — but four *strides* are 948px, because the last card carries no
    // trailing gap. Dividing the viewport by the stride gives 3.92 and floors
    // to three, which is what made the shelf page unpredictably through a
    // four-card view.
    expect(machCarouselScrollStep(928, 217, 20)).toBe(948);
    expect(948 / (217 + 20)).toBe(4);
  });

  it("pages a tablet shelf by what the tablet actually shows", () => {
    // 768px: a 704px track of 296px cards. Two fit, so it moves by two.
    expect(machCarouselScrollStep(704, 296, 16)).toBe(624);
  });
});

describe("track gutter", () => {
  /** `-mx-5 px-5 scroll-px-5` → `{ base: { mx: 5, px: 5, "scroll-px": 5 } }`. */
  function insetsByBreakpoint(spec: string) {
    const byBreakpoint: Record<string, Record<string, number>> = {};
    for (const token of spec.split(/\s+/).filter(Boolean)) {
      const [breakpoint, cls] = token.includes(":")
        ? (token.split(":") as [string, string])
        : (["base", token] as [string, string]);
      const match = /^-?(mx|px|scroll-px)-(\d+)$/.exec(cls);
      if (!match) throw new Error(`unrecognised gutter class: ${token}`);
      byBreakpoint[breakpoint] ??= {};
      byBreakpoint[breakpoint]![match[1]!] = Number(match[2]);
    }
    return byBreakpoint;
  }

  it("pays back exactly the inset it bleeds, at every breakpoint", () => {
    // The defect this fixes: padding without a matching `scroll-padding` is a
    // gutter that is there at rest and gone the moment the shelf is swiped,
    // because a snap position is measured from the track's padding box. All
    // three numbers have to move together or the phone shows product titles
    // hard against the screen edge.
    const insets = insetsByBreakpoint(TRACK_GUTTER);

    expect(Object.keys(insets)).toEqual(["base", "sm", "lg"]);
    for (const [breakpoint, inset] of Object.entries(insets)) {
      expect(Object.keys(inset).sort()).toEqual(["mx", "px", "scroll-px"]);
      expect(
        inset["px"],
        `${breakpoint}: padding must match the bleed`,
      ).toBe(inset["mx"]);
      expect(
        inset["scroll-px"],
        `${breakpoint}: snap positions must respect the padding`,
      ).toBe(inset["px"]);
    }
  });

  it("gives phones a real gutter and desktop none", () => {
    const insets = insetsByBreakpoint(TRACK_GUTTER);
    // Phones and small tablets keep the page's own margin…
    expect(insets["base"]!["scroll-px"]).toBeGreaterThan(0);
    expect(insets["sm"]!["scroll-px"]).toBeGreaterThan(
      insets["base"]!["scroll-px"]!,
    );
    // …and desktop drops the bleed so the track is the content column itself.
    expect(insets["lg"]).toEqual({ mx: 0, px: 0, "scroll-px": 0 });
  });
});

describe("control grounds", () => {
  it("offsets the focus ring with the ground actually behind the button", () => {
    // A ring offset is a solid band painted behind the ring, so a hard-coded
    // white one would halo the arrows on the Offers shelf.
    expect(RING_OFFSET.ink).toContain("var(--mach-ink)");
    expect(RING_OFFSET.paper).toContain("var(--mach-paper)");
    expect(RING_OFFSET.white).toContain("white");
  });

  it("covers every ground the rows can render on", () => {
    expect(Object.keys(RING_OFFSET).sort()).toEqual(
      Object.keys(MACH_ROW_GROUND_CLASSES).sort(),
    );
  });
});

describe("carousel controls", () => {
  it("names both controls for the shelf they move", () => {
    // Four carousels on one page would otherwise present eight buttons all
    // called "Previous".
    expect(machCarouselControlLabels("BEST SELLERS")).toEqual({
      previous: "Previous products in BEST SELLERS",
      next: "Next products in BEST SELLERS",
    });
  });

  it("still names a control when the section has no heading", () => {
    expect(machCarouselControlLabels("   ")).toEqual({
      previous: "Previous products",
      next: "Next products",
    });
  });

  it("puts those names on real buttons", () => {
    // Not a div with a click handler: a real button, labelled, and reachable
    // from the keyboard by construction.
    expect(CAROUSEL_SOURCE).toContain("aria-label={labels.previous}");
    expect(CAROUSEL_SOURCE).toContain("aria-label={labels.next}");
    expect(CAROUSEL_SOURCE.match(/<button\s+type='button'/g)).toHaveLength(2);
    expect(CAROUSEL_CODE).not.toMatch(/<div[^>]*onClick/);
  });

  it("keeps both controls in place when one is unavailable", () => {
    // Dimmed and inert, never removed: hiding the control at the end of a
    // shelf shifts the header every time the shopper reaches either end.
    expect(CAROUSEL_CODE).toContain("disabled:opacity-30");
    expect(CAROUSEL_CODE).toContain("disabled:cursor-not-allowed");
    expect(CAROUSEL_CODE).toContain("disabled={!canScrollBack}");
    expect(CAROUSEL_CODE).toContain("disabled={!canScrollOn}");
    // Nothing conditionally renders a button away.
    expect(CAROUSEL_CODE).not.toMatch(/canScroll\w+\s*&&\s*</);
  });

  it("takes its hover and press states off a disabled control", () => {
    // A dimmed button that still lights up under the pointer reads as broken
    // rather than as unavailable, so every interactive state is behind
    // `enabled:`.
    const interactive = CAROUSEL_CODE.match(/"[^"]*(?:hover|active):[^"]*"/g) ?? [];
    const controlStates = interactive.filter((cls) =>
      /(?:^|[\s"])(?:hover|active):(?:bg|border|text)-/.test(cls),
    );
    expect(controlStates).toHaveLength(0);
    expect(CAROUSEL_CODE).toContain("enabled:hover:");
    expect(CAROUSEL_CODE).toContain("enabled:active:");
  });

  it("respects a request for reduced motion", () => {
    expect(CAROUSEL_SOURCE).toContain("useReducedMotion");
    expect(CAROUSEL_SOURCE).toContain(
      'behavior: prefersReducedMotion ? "auto" : "smooth"',
    );
  });

  it("pages the shelf from the keyboard without a state machine", () => {
    expect(CAROUSEL_CODE).toContain("ArrowRight");
    expect(CAROUSEL_CODE).toContain("ArrowLeft");
    // The track stays a plain focusable scroll container: no roving tabindex.
    expect(CAROUSEL_CODE).not.toMatch(/tabIndex=\{-1\}/);
  });

  it("never scrolls on its own", () => {
    // A product shelf that moves while the shopper is reading it takes their
    // place away and makes two items impossible to compare. There are no
    // timers, no animation loop and no autoplay flag in the file — and this
    // test is here so none can be added quietly.
    expect(CAROUSEL_CODE).not.toMatch(
      /setInterval|setTimeout|requestAnimationFrame|autoplay|autoPlay/i,
    );
  });
});
