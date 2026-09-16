import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DEFAULT_HOMEPAGE_CONTENT,
  MACH_LANDING_TEMPLATE_ID,
  isSectionBackgroundActive,
  resolveSectionBackground,
  type HomepageContent,
} from "#root/shared/types/homepage-content";
import {
  resolveGroupSections,
  type BroadGroupCategory,
} from "#root/shared/types/homepage-group-sections";
import { mergeHomepageContentWithDefaults } from "../merge-homepage-content";
import { homepageRouter } from "../trpc";

/**
 * Section backgrounds, from Homepage Admin to the storefront, minus the
 * database.
 *
 * The chain a background crosses is the same one a campaign banner crosses —
 * admin state → the save mutation's Zod schema → the jsonb blob → the merge
 * every read goes through → the resolved section the storefront renders from —
 * and a field dropped at any one of those five is invisible until the client
 * reloads and finds their work gone.
 *
 * Two properties are worth more than the round trip itself, and both are
 * asserted below:
 *
 *  - **Nothing already saved changes.** Content written before this field
 *    existed must still validate, still merge, and still resolve to *no*
 *    background — a new field may not repaint a live homepage.
 *  - **Each section carries its own.** Four merchandising shelves and every
 *    group section, independently. A background set on Offers must not appear
 *    behind Best Sellers.
 *
 * The schema is pulled off the real router rather than re-declared, so a
 * background field added to the type and forgotten in the mutation fails here
 * instead of in production.
 */

const MERCHANT_ID = "00000000-0000-0000-0000-000000000000";
const SUPPLEMENTS = "11111111-1111-1111-1111-111111111111";
const GYM_GEAR = "22222222-2222-2222-2222-222222222222";

const updateContentInput = (
  homepageRouter as unknown as {
    _def: {
      procedures: {
        updateContent: { _def: { inputs: z.ZodTypeAny[] } };
      };
    };
  }
)._def.procedures.updateContent._def.inputs[0] as z.ZodTypeAny;

/** Everything the save mutation does to content, and nothing else. */
function save(content: HomepageContent): HomepageContent {
  const parsed = updateContentInput.safeParse({
    merchantId: MERCHANT_ID,
    templateId: MACH_LANDING_TEMPLATE_ID,
    content,
  });
  if (!parsed.success) {
    throw new Error(
      `save rejected: ${JSON.stringify(parsed.error.issues, null, 2)}`,
    );
  }
  return JSON.parse(
    JSON.stringify((parsed.data as { content: HomepageContent }).content),
  ) as HomepageContent;
}

/** A save followed by the read path Homepage Admin and SSR both use. */
function saveAndReload(content: HomepageContent): HomepageContent {
  return mergeHomepageContentWithDefaults(
    save(content) as Partial<HomepageContent>,
    MACH_LANDING_TEMPLATE_ID,
  );
}

const GROUPS: BroadGroupCategory[] = [
  { id: SUPPLEMENTS, name: "Supplements", slug: "supplements" },
  { id: GYM_GEAR, name: "Gym Gear", slug: "gym-gear" },
];

function content(overrides: Partial<HomepageContent> = {}): HomepageContent {
  return { ...DEFAULT_HOMEPAGE_CONTENT, ...overrides };
}

/* ================================================================== */
/*  Defaults                                                          */
/* ================================================================== */

describe("a section with no background configured", () => {
  it("ships with none on every merchandising shelf", () => {
    const shipped = DEFAULT_HOMEPAGE_CONTENT;

    for (const shelf of [
      shipped.featuredProducts,
      shipped.newArrivals,
      shipped.featuredShelf,
      shipped.discountedProducts,
    ]) {
      expect(resolveSectionBackground(shelf?.background).type).toBe("none");
      expect(isSectionBackgroundActive(shelf?.background)).toBe(false);
    }
  });

  it("resolves to none on a group nobody has configured", () => {
    const [supplements] = resolveGroupSections(content(), GROUPS);

    expect(supplements?.background).toEqual({ type: "none" });
    expect(isSectionBackgroundActive(supplements?.background)).toBe(false);
  });

  it("treats a missing, null or half-configured value as none", () => {
    expect(resolveSectionBackground(undefined).type).toBe("none");
    expect(resolveSectionBackground(null).type).toBe("none");
    // Chosen a type, not yet uploaded: a type with no asset is not a
    // background, and the section keeps its flat ground rather than flashing
    // through a transparent band while the upload finishes.
    expect(isSectionBackgroundActive({ type: "image" })).toBe(false);
    expect(isSectionBackgroundActive({ type: "video", url: "  " })).toBe(false);
  });
});

/* ================================================================== */
/*  Backward compatibility                                            */
/* ================================================================== */

describe("content saved before backgrounds existed", () => {
  it("still validates, merges and resolves to no background", () => {
    // Exactly what a stored blob from before this feature looks like: the
    // field is simply absent, everywhere.
    const legacy = JSON.parse(
      JSON.stringify(
        content({
          groupSections: [{ categoryId: SUPPLEMENTS, enabled: true }],
        }),
      ),
    ) as HomepageContent;
    expect(JSON.stringify(legacy)).not.toContain('"background"');

    const reloaded = saveAndReload(legacy);

    expect(reloaded.featuredProducts.background).toBeUndefined();
    expect(reloaded.groupSections?.[0]?.background).toBeUndefined();

    const [supplements] = resolveGroupSections(reloaded, GROUPS);
    expect(supplements?.background).toEqual({ type: "none" });
  });

  it("accepts a cleared url without failing the save", () => {
    // The CMS sends `null` for optional fields it has cleared; a client
    // saving an untouched homepage must never be told it is invalid.
    const reloaded = saveAndReload(
      content({
        featuredProducts: {
          ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
          background: { type: "none", url: undefined },
        },
      }),
    );

    expect(isSectionBackgroundActive(reloaded.featuredProducts.background)).toBe(
      false,
    );
  });
});

/* ================================================================== */
/*  What the client configured comes back                             */
/* ================================================================== */

describe("a merchandising shelf's background", () => {
  it("survives the save as an image", () => {
    const reloaded = saveAndReload(
      content({
        featuredProducts: {
          ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
          background: { type: "image", url: "/uploads/section-bg-best.webp" },
        },
      }),
    );

    expect(reloaded.featuredProducts.background).toEqual({
      type: "image",
      url: "/uploads/section-bg-best.webp",
    });
    expect(isSectionBackgroundActive(reloaded.featuredProducts.background)).toBe(
      true,
    );
  });

  it("survives the save as a video", () => {
    const reloaded = saveAndReload(
      content({
        discountedProducts: {
          ...DEFAULT_HOMEPAGE_CONTENT.discountedProducts!,
          background: { type: "video", url: "/uploads/section-bg-offers.mp4" },
        },
      }),
    );

    expect(reloaded.discountedProducts?.background).toEqual({
      type: "video",
      url: "/uploads/section-bg-offers.mp4",
    });
  });

  it("belongs to that shelf alone", () => {
    const reloaded = saveAndReload(
      content({
        newArrivals: {
          ...DEFAULT_HOMEPAGE_CONTENT.newArrivals!,
          background: { type: "image", url: "/uploads/section-bg-drops.webp" },
        },
        featuredShelf: {
          ...DEFAULT_HOMEPAGE_CONTENT.featuredShelf!,
          background: { type: "video", url: "/uploads/section-bg-feat.mp4" },
        },
      }),
    );

    expect(reloaded.newArrivals?.background?.url).toBe(
      "/uploads/section-bg-drops.webp",
    );
    expect(reloaded.featuredShelf?.background?.type).toBe("video");
    // The two shelves that were not given one stay as they were.
    expect(reloaded.featuredProducts.background).toBeUndefined();
    expect(reloaded.discountedProducts?.background).toBeUndefined();
  });

  it("carries its contrast treatment through the save mutation", () => {
    // Through the *real* schema, which strips keys it does not declare: a
    // `textTheme` or `overlayOpacity` added to the type and forgotten in the
    // mutation would vanish silently on the first save, and the admin would
    // watch their setting revert on reload.
    const reloaded = saveAndReload(
      content({
        featuredProducts: {
          ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
          background: {
            type: "image",
            url: "/uploads/section-bg-best.webp",
            textTheme: "dark",
            overlayOpacity: 65,
          },
        },
        groupSections: [
          {
            categoryId: SUPPLEMENTS,
            enabled: true,
            background: {
              type: "video",
              url: "/uploads/section-bg-supps.mp4",
              textTheme: "light",
              overlayOpacity: 0,
            },
          },
        ],
      }),
    );

    expect(reloaded.featuredProducts.background).toEqual({
      type: "image",
      url: "/uploads/section-bg-best.webp",
      textTheme: "dark",
      overlayOpacity: 65,
    });
    // Zero has to survive as zero rather than being read as "not set".
    expect(reloaded.groupSections?.[0]?.background?.overlayOpacity).toBe(0);
    expect(resolveGroupSections(reloaded, GROUPS)[0]?.background).toEqual({
      type: "video",
      url: "/uploads/section-bg-supps.mp4",
      textTheme: "light",
      overlayOpacity: 0,
    });
  });

  it("rejects an overlay outside the range it offers", () => {
    // The CMS slider cannot produce this; a hand-edited blob can, and the
    // mutation is where that stops.
    expect(() =>
      saveAndReload(
        content({
          featuredProducts: {
            ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
            background: {
              type: "image",
              url: "/uploads/section-bg-best.webp",
              overlayOpacity: 95,
            },
          },
        }),
      ),
    ).toThrow(/save rejected/);
  });

  it("goes back to nothing when the media is removed", () => {
    // "Remove" in the CMS empties the url and leaves the type alone; the
    // section has to return to its flat ground, not render an empty layer.
    const reloaded = saveAndReload(
      content({
        featuredProducts: {
          ...DEFAULT_HOMEPAGE_CONTENT.featuredProducts,
          background: { type: "image", url: "" },
        },
      }),
    );

    expect(isSectionBackgroundActive(reloaded.featuredProducts.background)).toBe(
      false,
    );
  });
});

describe("a group section's background", () => {
  it("survives the save and resolves onto the section", () => {
    const reloaded = saveAndReload(
      content({
        groupSections: [
          {
            categoryId: SUPPLEMENTS,
            enabled: true,
            background: { type: "video", url: "/uploads/section-bg-supps.mp4" },
          },
          {
            categoryId: GYM_GEAR,
            enabled: true,
            background: { type: "image", url: "/uploads/section-bg-gym.webp" },
          },
        ],
      }),
    );

    const [supplements, gymGear] = resolveGroupSections(reloaded, GROUPS);

    // Each group independently, which is the whole point of storing it on the
    // group's own config rather than on the page. The contrast treatment is
    // resolved onto both, since neither group saved one.
    expect(supplements?.background).toEqual({
      type: "video",
      url: "/uploads/section-bg-supps.mp4",
      textTheme: "light",
      overlayOpacity: 40,
    });
    expect(gymGear?.background).toEqual({
      type: "image",
      url: "/uploads/section-bg-gym.webp",
      textTheme: "light",
      overlayOpacity: 40,
    });
  });

  it("leaves a group configured without one alone", () => {
    const reloaded = saveAndReload(
      content({
        groupSections: [
          {
            categoryId: SUPPLEMENTS,
            enabled: true,
            background: { type: "image", url: "/uploads/section-bg-supps.webp" },
          },
          { categoryId: GYM_GEAR, enabled: true },
        ],
      }),
    );

    const [, gymGear] = resolveGroupSections(reloaded, GROUPS);

    expect(gymGear?.background).toEqual({ type: "none" });
    expect(isSectionBackgroundActive(gymGear?.background)).toBe(false);
  });
});
