import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "#root/shared/trpc/server";
import { getShopContent, updateShopContent } from "./service";
import type { ShopContent } from "#root/shared/types/shop-content";

/** Matches `MediaSlot` in shared/types/homepage-content.ts. */
const MediaSlotSchema = z.object({
  kind: z.enum(["image", "video"]),
  desktopUrl: z.string(),
  mobileUrl: z.string().nullish(),
  posterUrl: z.string().nullish(),
  alt: z.string().nullish(),
  focalPoint: z.object({ x: z.number(), y: z.number() }).nullish(),
});

const ShopCategoryContentSchema = z.object({
  heading: z.string().max(160).nullish(),
  description: z.string().max(2000).nullish(),
  media: MediaSlotSchema.nullish(),
});

const ShopContentSchema = z.object({
  hero: z.object({
    enabled: z.boolean(),
    media: MediaSlotSchema.nullish(),
    headline: z.string().max(160).nullish(),
    description: z.string().max(600).nullish(),
    ctaLabel: z.string().max(60).nullish(),
    ctaHref: z.string().max(500).nullish(),
  }),
  heading: z.string().max(160).nullish(),
  groupCategoryIds: z.array(z.string().uuid()).max(24).nullish(),
  intro: z.string().max(600).nullish(),
  emptyStateText: z.string().max(300).nullish(),
  countSingular: z.string().max(40).nullish(),
  countPlural: z.string().max(40).nullish(),
  categories: z.record(z.string(), ShopCategoryContentSchema).nullish(),
});

/**
 * Shop page CMS. Reads are public (the storefront needs them on every shop and
 * category view); writes are admin-only, matching the homepage CMS.
 */
export const shopContentRouter = router({
  getContent: publicProcedure
    .input(z.object({ merchantId: z.string().uuid() }))
    .query(async ({ input }) => {
      const content = await getShopContent(input.merchantId);
      return { success: true as const, result: content };
    }),

  updateContent: protectedProcedure
    .input(
      z.object({
        merchantId: z.string().uuid(),
        content: ShopContentSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const content = await updateShopContent(
        input.merchantId,
        input.content as unknown as ShopContent,
      );
      return { success: true as const, result: content };
    }),
});
