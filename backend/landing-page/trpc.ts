import { TRPCError } from "@trpc/server";
import { Effect } from "effect";
import { z } from "zod";
import {
  runBackendEffect,
  serializeBackendEffectResult,
} from "#root/shared/backend/effect";
import {
  LANDING_ALT_MAX_LENGTH,
  LANDING_CTA_TEXT_MAX_LENGTH,
  LANDING_LINK_MAX_LENGTH,
  LANDING_MAX_PRODUCTS,
  LANDING_PRODUCTS_TITLE_MAX_LENGTH,
  LANDING_SUBTITLE_MAX_LENGTH,
  LANDING_TITLE_MAX_LENGTH,
  canEditLandingPage,
} from "#root/shared/landing-page/config";
import {
  protectedProcedure,
  provideDatabase,
  router,
} from "#root/shared/trpc/server";
import { IMAGE_TYPES, uploadHomepageMedia } from "../homepage/upload-media";
import {
  getLandingPageEditorState,
  updateLandingPageSettings,
} from "./service";

/**
 * Landing 2 content editing — admins, superadmins and media buyers.
 *
 * This is the only tRPC surface a media buyer can use beyond what any
 * signed-in customer can. It reads and writes `landing_page_config` and
 * uploads hero images; nothing else.
 */
export const landingPageEditorProcedure = protectedProcedure.use(
  async ({ ctx, next }) => {
    if (!canEditLandingPage(ctx.clientSession.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have access to the landing page settings",
      });
    }
    return next({ ctx });
  },
);

/**
 * Shape only. Content rules (required headline, safe links and media URLs,
 * product cap) live in `validateLandingPageSettings`, which the service runs so
 * the dashboard gets the same message it shows inline. The caps here just
 * stop oversized payloads before they reach it.
 */
const mediaSlotSchema = z.object({
  kind: z.enum(["image", "video"]),
  desktopUrl: z.string().max(LANDING_LINK_MAX_LENGTH),
  mobileUrl: z.string().max(LANDING_LINK_MAX_LENGTH).optional(),
  posterUrl: z.string().max(LANDING_LINK_MAX_LENGTH).optional(),
  alt: z.string().max(LANDING_ALT_MAX_LENGTH * 2).optional(),
  focalPoint: z
    .object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })
    .optional(),
});

export const landingPageSettingsSchema = z.object({
  hero: z.object({
    media: mediaSlotSchema,
    title: z.string().max(LANDING_TITLE_MAX_LENGTH * 2),
    subtitle: z.string().max(LANDING_SUBTITLE_MAX_LENGTH * 2),
    ctaText: z.string().max(LANDING_CTA_TEXT_MAX_LENGTH * 2),
    ctaLink: z.string().max(LANDING_LINK_MAX_LENGTH),
    align: z.enum(["left", "center", "right"]),
    verticalAlign: z.enum(["top", "middle", "bottom"]),
    textTheme: z.enum(["light", "dark"]),
    overlayOpacity: z.number().min(0).max(100),
  }),
  productsTitle: z.string().max(LANDING_PRODUCTS_TITLE_MAX_LENGTH * 2),
  productIds: z.array(z.string().uuid()).max(LANDING_MAX_PRODUCTS),
});

export const landingPageRouter = router({
  /** The saved settings, plus a status line for every selected product. */
  getSettings: landingPageEditorProcedure.query(async ({ ctx }) => {
    return runBackendEffect(
      getLandingPageEditorState().pipe(provideDatabase(ctx)),
    ).then(serializeBackendEffectResult);
  }),

  updateSettings: landingPageEditorProcedure
    .input(landingPageSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      return runBackendEffect(
        updateLandingPageSettings(input).pipe(provideDatabase(ctx)),
      ).then(serializeBackendEffectResult);
    }),

  /**
   * Hero images (desktop, mobile, video poster). Same pipeline and directory
   * as `homepage.uploadMedia`, restricted to images: videos stream to
   * `LANDING_MEDIA_VIDEO_ENDPOINT`, and nothing else belongs on this page.
   */
  uploadImage: landingPageEditorProcedure
    .input(
      z.object({
        file: z.object({
          name: z.string(),
          type: z.string(),
          buffer: z.instanceof(Uint8Array),
        }),
      }),
    )
    .mutation(async ({ input }) => {
      if (!IMAGE_TYPES.includes(input.file.type.toLowerCase())) {
        return {
          success: false as const,
          error: "Unsupported image type. Allowed: JPG, PNG, WebP, AVIF.",
        };
      }
      try {
        const result = await Effect.runPromise(
          uploadHomepageMedia({
            buffer: input.file.buffer,
            mimeType: input.file.type,
            prefix: "landing",
          }),
        );
        return { success: true as const, data: result };
      } catch (error) {
        console.error("Landing page image upload error:", error);
        return {
          success: false as const,
          error:
            error instanceof Error ? error.message : "Failed to upload image",
        };
      }
    }),
});
