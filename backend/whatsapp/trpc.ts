import { z } from "zod";
import {
  adminProcedure,
  provideDatabase,
  publicProcedure,
  router,
} from "#root/shared/trpc/server";
import {
  runBackendEffect,
  serializeBackendEffectResult,
} from "#root/shared/backend/effect";
import {
  WHATSAPP_MESSAGE_MAX_LENGTH,
  WHATSAPP_VISIBILITIES,
} from "#root/shared/whatsapp/config";
import {
  getPublicWhatsAppButton,
  getWhatsAppSettings,
  updateWhatsAppSettings,
} from "./service";

/**
 * Shape only. The number rules (required when enabled, international format)
 * live in `validateWhatsAppSettings`, which the service runs so the CMS gets
 * the same plain-language message it shows inline. The length caps here just
 * stop oversized payloads before they reach it.
 */
export const whatsappSettingsSchema = z.object({
  enabled: z.boolean(),
  phoneNumber: z.string().max(40),
  message: z.string().max(WHATSAPP_MESSAGE_MAX_LENGTH * 2),
  visibility: z.enum(WHATSAPP_VISIBILITIES),
});

export const whatsappRouter = router({
  /**
   * Public: the storefront button — `{ href, visibility }`, or null while the
   * feature is off or has no valid number.
   */
  getPublicButton: publicProcedure.query(async ({ ctx }) => {
    return runBackendEffect(
      getPublicWhatsAppButton().pipe(provideDatabase(ctx)),
    ).then(serializeBackendEffectResult);
  }),

  /** Admin-only: the saved settings, merged over defaults. */
  getSettings: adminProcedure.query(async ({ ctx }) => {
    return runBackendEffect(
      getWhatsAppSettings().pipe(provideDatabase(ctx)),
    ).then(serializeBackendEffectResult);
  }),

  updateSettings: adminProcedure
    .input(whatsappSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      return runBackendEffect(
        updateWhatsAppSettings(input).pipe(provideDatabase(ctx)),
      ).then(serializeBackendEffectResult);
    }),
});
