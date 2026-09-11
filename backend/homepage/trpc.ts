import { z } from "zod";
import {
  publicProcedure,
  router,
  protectedProcedure,
} from "#root/shared/trpc/server";
import { getHomepageContent } from "./get-homepage-content";
import { updateHomepageContent } from "./update-homepage-content";
import { uploadHeroImage } from "./upload-hero-image";
import { uploadHomepageMedia } from "./upload-media";
import {
  DISCOUNTED_LIMIT_MAX,
  DISCOUNTED_LIMIT_MIN,
  GROUP_SECTION_LIMIT_MAX,
  GROUP_SECTION_LIMIT_MIN,
  ValuePropIconType,
  type HomepageContent,
} from "#root/shared/types/homepage-content";
import { Effect } from "effect";

// ── Shared content primitives ───────────────────────────────────────────────

/** Matches `MediaSlot` in shared/types/homepage-content.ts. */
const MediaSlotSchema = z.object({
  kind: z.enum(["image", "video"]),
  desktopUrl: z.string(),
  mobileUrl: z.string().nullish(),
  posterUrl: z.string().nullish(),
  alt: z.string().nullish(),
  focalPoint: z
    .object({ x: z.number(), y: z.number() })
    .nullish(),
});

const TextAlignSchema = z.enum(["left", "center", "right"]);
const TextVerticalAlignSchema = z.enum(["top", "middle", "bottom"]);
const TextThemeSchema = z.enum(["light", "dark"]);

/**
 * Matches `HomepageGroupSectionContent` — one broad group's own section.
 *
 * `categoryId` is the identity and the only required field beside the switch:
 * everything else overrides copy or presentation the category already
 * supplies. The array is not constrained to the store's current broad groups
 * here — reconciliation against the live category list happens on read, so a
 * client saving while a category is mid-rename cannot lose a section.
 */
const GroupSectionSchema = z.object({
  categoryId: z.string().uuid(),
  enabled: z.boolean(),
  title: z.string().nullish(),
  titleAr: z.string().nullish(),
  subtitle: z.string().nullish(),
  subtitleAr: z.string().nullish(),
  viewAllText: z.string().nullish(),
  viewAllTextAr: z.string().nullish(),
  viewAllLink: z.string().nullish(),
  productIds: z.array(z.string().uuid()).nullish(),
  limit: z
    .number()
    .int()
    .min(GROUP_SECTION_LIMIT_MIN)
    .max(GROUP_SECTION_LIMIT_MAX)
    .nullish(),
  presentation: z.enum(["shelf", "feature"]).nullish(),
});

/**
 * Matches `HomepageProductGroupContent` — one hard-coded merchandising row.
 *
 * @deprecated Accepted so older clients and stored blobs still validate.
 */
const ProductGroupSchema = z
  .object({
    enabled: z.boolean(),
    title: z.string(),
    titleAr: z.string().nullish(),
    subtitle: z.string().nullish(),
    subtitleAr: z.string().nullish(),
    viewAllText: z.string(),
    viewAllTextAr: z.string().nullish(),
    viewAllLink: z.string(),
    categoryIds: z.array(z.string().uuid()).nullish(),
    productIds: z.array(z.string().uuid()).nullish(),
    limit: z.number().int().min(1).max(24).nullish(),
  })
  .nullish();

// Zod schema for validating homepage content
const HomepageContentSchema = z.object({
  meta: z.object({
    enabled: z.boolean(),
    pageTitle: z.string(),
    pageDescription: z.string(),
  }),
  hero: z.object({
    enabled: z.boolean(),
    title: z.string(),
    subtitle: z.string(),
    supportingText: z.string().nullish(),
    ctaText: z.string(),
    ctaLink: z.string(),
    backgroundImage: z.string().nullish(),
    mobileBackgroundImage: z.string().nullish(),
    heroSlides: z
      .array(
        z.object({
          id: z.string(),
          imageUrl: z.string(),
          mobileImageUrl: z.string().nullish(),
          linkUrl: z.string().nullish(),
          alt: z.string().nullish(),
        }),
      )
      .nullish(),
    media: MediaSlotSchema.nullish(),
    productMedia: MediaSlotSchema.nullish(),
    productScale: z.number().min(60).max(140).nullish(),
    mediaLayout: z.enum(["split", "full-bleed"]).nullish(),
    secondaryCtaText: z.string().nullish(),
    secondaryCtaLink: z.string().nullish(),
    align: TextAlignSchema.nullish(),
    verticalAlign: TextVerticalAlignSchema.nullish(),
    textTheme: TextThemeSchema.nullish(),
    overlayOpacity: z.number().min(0).max(100).nullish(),
  }),
  brandStatement: z.object({
    enabled: z.boolean(),
    title: z.string(),
    description: z.string(),
    image: z.string().nullish(),
  }),
  promoBanner: z.object({
    enabled: z.boolean(),
    text: z.string(),
    linkText: z.string().nullish(),
    linkUrl: z.string().nullish(),
  }),
  categories: z.object({
    enabled: z.boolean(),
    title: z.string(),
    titleAr: z.string().nullish(),
    subtitle: z.string(),
    ctaText: z.string(),
    ctaLink: z.string(),
    categoryIds: z.array(z.string().uuid()).nullish(),
    layoutVariant: z.enum(["tiles-4", "tiles-3", "tiles-2"]).nullish(),
  }),
  featuredProducts: z.object({
    enabled: z.boolean(),
    title: z.string(),
    titleAr: z.string().nullish(),
    subtitle: z.string(),
    viewAllText: z.string(),
    viewAllTextAr: z.string().nullish(),
    viewAllLink: z.string(),
    productIds: z.array(z.string().uuid()).nullish(),
  }),
  valueProps: z.object({
    enabled: z.boolean(),
    items: z.array(
      z.object({
        icon: z.nativeEnum(ValuePropIconType),
        title: z.string(),
        description: z.string(),
      }),
    ),
  }),
  newsletter: z.object({
    enabled: z.boolean(),
    title: z.string(),
    subtitle: z.string(),
    placeholderText: z.string(),
    ctaText: z.string(),
    privacyText: z.string(),
  }),
  footerCta: z.object({
    enabled: z.boolean(),
    title: z.string(),
    subtitle: z.string(),
    ctaText: z.string(),
    ctaLink: z.string(),
  }),
  discountedProducts: z
    .object({
      enabled: z.boolean(),
      title: z.string(),
      titleAr: z.string().nullish(),
      viewAllText: z.string(),
      viewAllTextAr: z.string().nullish(),
      viewAllLink: z.string(),
      productIds: z.array(z.string().uuid()).nullish(),
      limit: z
        .number()
        .int()
        .min(DISCOUNTED_LIMIT_MIN)
        .max(DISCOUNTED_LIMIT_MAX)
        .nullish(),
    })
    .nullish(),
  newArrivals: z
    .object({
      enabled: z.boolean(),
      title: z.string(),
      titleAr: z.string().nullish(),
      viewAllText: z.string(),
      viewAllTextAr: z.string().nullish(),
      viewAllLink: z.string(),
      productIds: z.array(z.string().uuid()).nullish(),
    })
    .nullish(),
  // One merchandising section per broad product group, keyed by category id.
  // The store's groups are catalogue data, so this is a list rather than a
  // field per group — a fourth group needs no schema change.
  groupSections: z.array(GroupSectionSchema).nullish(),
  // Featured — hand-picked, and its own section rather than a renamed one.
  featuredShelf: z
    .object({
      enabled: z.boolean(),
      title: z.string(),
      titleAr: z.string().nullish(),
      subtitle: z.string().nullish(),
      subtitleAr: z.string().nullish(),
      viewAllText: z.string(),
      viewAllTextAr: z.string().nullish(),
      viewAllLink: z.string(),
      productIds: z.array(z.string().uuid()).nullish(),
    })
    .nullish(),
  // Deprecated hard-coded group rows, still accepted so a client running older
  // code, or a stored blob nobody has re-saved, keeps validating.
  stacks: ProductGroupSchema,
  gymGear: ProductGroupSchema,
  marquee: z
    .object({
      enabled: z.boolean(),
      text: z.string(),
      textAr: z.string().nullish(),
      backgroundColor: z.string().nullish(),
      textColor: z.string().nullish(),
    })
    .nullish(),
  promoLine: z
    .object({
      text: z.string(),
      textAr: z.string().nullish(),
    })
    .nullish(),
  contactBanner: z
    .object({
      enabled: z.boolean(),
      slides: z.array(
        z.object({
          id: z.string(),
          imageUrl: z.string(),
          mobileImageUrl: z.string().nullish(),
          alt: z.string().nullish(),
        }),
      ),
      heading: z.string(),
      headingAr: z.string().nullish(),
      description: z.string(),
      descriptionAr: z.string().nullish(),
      directionsUrl: z.string().nullish(),
    })
    .nullish(),
  bottomCarousel: z
    .object({
      enabled: z.boolean(),
      slides: z.array(
        z.object({
          id: z.string(),
          imageUrl: z.string(),
          mobileImageUrl: z.string().nullish(),
          linkUrl: z.string().nullish(),
          alt: z.string().nullish(),
        }),
      ),
    })
    .nullish(),
  aboutUs: z
    .object({
      enabled: z.boolean(),
      title: z.string(),
      titleAr: z.string().nullish(),
      description: z.string(),
      descriptionAr: z.string().nullish(),
      imageUrl: z.string().nullish(),
    })
    .nullish(),
  returnPolicy: z
    .object({
      enabled: z.boolean(),
      title: z.string(),
      titleAr: z.string().nullish(),
      intro: z.string(),
      introAr: z.string().nullish(),
      steps: z.array(
        z.object({
          icon: z.nativeEnum(ValuePropIconType),
          title: z.string(),
          titleAr: z.string().nullish(),
          description: z.string(),
          descriptionAr: z.string().nullish(),
        }),
      ),
      detailSections: z.array(
        z.object({
          title: z.string(),
          titleAr: z.string().nullish(),
          body: z.string(),
          bodyAr: z.string().nullish(),
        }),
      ),
      footerPrefix: z.string(),
      footerPrefixAr: z.string().nullish(),
      supportEmail: z.string(),
      footerMiddle: z.string(),
      footerMiddleAr: z.string().nullish(),
      contactLinkLabel: z.string(),
      contactLinkLabelAr: z.string().nullish(),
      contactLinkUrl: z.string(),
    })
    .nullish(),
  productCarouselTitle: z.string().nullish(),
  productCarouselTitleAr: z.string().nullish(),
  testimonials: z.object({
    enabled: z.boolean(),
    title: z.string().nullish(),
    titleAr: z.string().nullish(),
    items: z.array(z.object({
      name: z.string(),
      nameAr: z.string().nullish(),
      rating: z.number().min(1).max(5),
      review: z.string(),
      reviewAr: z.string().nullish(),
    })),
  }).nullish(),

  // ── Mach storefront sections ──
  heroMarquee: z
    .object({
      enabled: z.boolean(),
      text: z.string(),
      textAr: z.string().nullish(),
      separator: z.string().nullish(),
      speedSeconds: z.number().min(4).max(240).nullish(),
      direction: z.enum(["left", "right"]).nullish(),
      invert: z.boolean().nullish(),
    })
    .nullish(),
  campaignBanners: z
    .array(
      z.object({
        id: z.string(),
        enabled: z.boolean(),
        media: MediaSlotSchema.nullish(),
        eyebrow: z.string().nullish(),
        title: z.string(),
        body: z.string().nullish(),
        ctaText: z.string().nullish(),
        ctaLink: z.string().nullish(),
        align: TextAlignSchema.nullish(),
        verticalAlign: TextVerticalAlignSchema.nullish(),
        textTheme: TextThemeSchema.nullish(),
        overlayOpacity: z.number().min(0).max(100).nullish(),
        height: z.enum(["standard", "tall"]).nullish(),
      }),
    )
    .nullish(),
  whyMach: z
    .object({
      enabled: z.boolean(),
      title: z.string(),
      titleAr: z.string().nullish(),
      subtitle: z.string(),
      subtitleAr: z.string().nullish(),
      items: z.array(
        z.object({
          id: z.string(),
          icon: z.nativeEnum(ValuePropIconType).nullish(),
          title: z.string(),
          titleAr: z.string().nullish(),
          description: z.string(),
          descriptionAr: z.string().nullish(),
          imageUrl: z.string().nullish(),
          stat: z.string().nullish(),
        }),
      ),
    })
    .nullish(),
  certificates: z
    .object({
      enabled: z.boolean(),
      title: z.string(),
      titleAr: z.string().nullish(),
      subtitle: z.string(),
      subtitleAr: z.string().nullish(),
      items: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          titleAr: z.string().nullish(),
          issuer: z.string().nullish(),
          thumbnailUrl: z.string(),
          alt: z.string().nullish(),
          documentUrl: z.string().nullish(),
          externalUrl: z.string().nullish(),
        }),
      ),
      factory: z.object({
        enabled: z.boolean(),
        heading: z.string(),
        headingAr: z.string().nullish(),
        body: z.string(),
        bodyAr: z.string().nullish(),
        media: MediaSlotSchema.nullish(),
        linkLabel: z.string(),
        linkLabelAr: z.string().nullish(),
        linkUrl: z.string(),
      }),
    })
    .nullish(),
  ugc: z
    .object({
      enabled: z.boolean(),
      title: z.string(),
      titleAr: z.string().nullish(),
      subtitle: z.string(),
      subtitleAr: z.string().nullish(),
      reviewIds: z.array(z.string().uuid()).nullish(),
    })
    .nullish(),
  sectionOrder: z.array(z.string()).nullish(),
});

export const homepageRouter = router({
  getContent: publicProcedure
    .input(
      z.object({
        merchantId: z.string().uuid(),
        templateId: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const content = await getHomepageContent(
        input.merchantId,
        input.templateId,
      );
      return {
        success: true,
        result: content,
      };
    }),

  updateContent: protectedProcedure
    .input(
      z.object({
        merchantId: z.string().uuid(),
        templateId: z.string().optional(),
        content: HomepageContentSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const content = await updateHomepageContent(
        input.merchantId,
        input.content as HomepageContent,
        input.templateId,
      );
      return {
        success: true,
        result: content,
      };
    }),

  uploadHeroImage: protectedProcedure
    .input(
      z.object({
        file: z.object({
          name: z.string(),
          type: z.string(),
          buffer: z.instanceof(Uint8Array),
        }),
        preserveAspect: z.boolean().nullish(), // For brand statement images
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = ctx.clientSession;

      // Only admins can upload homepage hero images
      if (!session || (session.role !== "admin" && session.role !== "superadmin")) {
        return {
          success: false as const,
          error: "Unauthorized. Only admins can upload homepage images.",
        };
      }

      try {
        const result = await Effect.runPromise(
          uploadHeroImage({
            buffer: input.file.buffer,
            mimeType: input.file.type,
            preserveAspect: input.preserveAspect ?? undefined,
          }),
        );

        return {
          success: true as const,
          data: result,
        };
      } catch (error) {
        console.error("Homepage hero image upload error:", error);
        return {
          success: false as const,
          error:
            error instanceof Error ? error.message : "Failed to upload image",
        };
      }
    }),

  /**
   * Generic CMS media upload for every slot added by the Mach storefront:
   * campaign banners, category artwork, Why-Mach visuals, factory photos,
   * hero video, and client-supplied certificate documents.
   *
   * Kept separate from `uploadHeroImage` on purpose — that one crops to a
   * fixed hero ratio and the existing hero controls rely on it.
   */
  uploadMedia: protectedProcedure
    .input(
      z.object({
        file: z.object({
          name: z.string(),
          type: z.string(),
          buffer: z.instanceof(Uint8Array),
        }),
        /** Filename prefix so uploads stay identifiable on disk. */
        prefix: z.string().max(24).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = ctx.clientSession;

      if (
        !session ||
        (session.role !== "admin" && session.role !== "superadmin")
      ) {
        return {
          success: false as const,
          error: "Unauthorized. Only admins can upload homepage media.",
        };
      }

      try {
        const result = await Effect.runPromise(
          uploadHomepageMedia({
            buffer: input.file.buffer,
            mimeType: input.file.type,
            prefix: input.prefix ?? undefined,
          }),
        );

        return { success: true as const, data: result };
      } catch (error) {
        console.error("Homepage media upload error:", error);
        return {
          success: false as const,
          error:
            error instanceof Error ? error.message : "Failed to upload media",
        };
      }
    }),

  uploadMobileHeroImage: protectedProcedure
    .input(
      z.object({
        file: z.object({
          name: z.string(),
          type: z.string(),
          buffer: z.instanceof(Uint8Array),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = ctx.clientSession;

      // Only admins can upload homepage hero images
      if (!session || (session.role !== "admin" && session.role !== "superadmin")) {
        return {
          success: false as const,
          error: "Unauthorized. Only admins can upload homepage images.",
        };
      }

      try {
        const result = await Effect.runPromise(
          uploadHeroImage({
            buffer: input.file.buffer,
            mimeType: input.file.type,
            filenamePrefix: "hero-mobile",
          }),
        );

        return {
          success: true as const,
          data: result,
        };
      } catch (error) {
        console.error("Mobile hero image upload error:", error);
        return {
          success: false as const,
          error:
            error instanceof Error ? error.message : "Failed to upload image",
        };
      }
    }),
});
