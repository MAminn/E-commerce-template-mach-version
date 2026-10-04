import { query } from "#root/shared/database/drizzle/db";
import { storeSettings } from "#root/shared/database/drizzle/schema";
import { ServerError } from "#root/shared/error/server";
import {
  normalizeWhatsAppSettings,
  toPublicWhatsAppButton,
  validateWhatsAppSettings,
  type WhatsAppSettings,
} from "#root/shared/whatsapp/config";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

/**
 * Store-wide floating WhatsApp button settings, in their own
 * `store_settings.whatsapp_config` column. Mirrors backend/upsells/service.ts.
 */

export const getWhatsAppSettings = () =>
  Effect.gen(function* ($) {
    const rows = yield* $(
      query(async (db) =>
        db
          .select({ whatsappConfig: storeSettings.whatsappConfig })
          .from(storeSettings)
          .where(eq(storeSettings.key, "default"))
          .limit(1),
      ),
    );
    return normalizeWhatsAppSettings(rows[0]?.whatsappConfig);
  });

/**
 * The storefront's view: a ready wa.me link and its visibility, or null.
 * Built server-side so the client never assembles (or mis-assembles) a link,
 * and a hand-edited bad number renders nothing instead of a broken button.
 */
export const getPublicWhatsAppButton = () =>
  getWhatsAppSettings().pipe(Effect.map(toPublicWhatsAppButton));

export const updateWhatsAppSettings = (input: WhatsAppSettings) =>
  Effect.gen(function* ($) {
    const validation = validateWhatsAppSettings(input);
    if (!validation.ok) {
      const firstError = Object.values(validation.errors)[0];
      return yield* $(
        Effect.fail(
          new ServerError({
            tag: "InvalidWhatsAppSettings",
            statusCode: 400,
            clientMessage: firstError ?? "Invalid WhatsApp settings",
          }),
        ),
      );
    }
    const config = validation.settings;

    const updated = yield* $(
      query(async (db) =>
        db
          .update(storeSettings)
          .set({ whatsappConfig: config, updatedAt: new Date() })
          .where(eq(storeSettings.key, "default"))
          .returning({ whatsappConfig: storeSettings.whatsappConfig }),
      ),
    );
    if (updated.length > 0) {
      return normalizeWhatsAppSettings(updated[0]!.whatsappConfig);
    }

    // No settings row yet (fresh install) — create it carrying just this config.
    const inserted = yield* $(
      query(async (db) =>
        db
          .insert(storeSettings)
          .values({ key: "default", whatsappConfig: config })
          .returning({ whatsappConfig: storeSettings.whatsappConfig }),
      ),
    );
    if (!inserted[0]) {
      return yield* $(
        Effect.fail(
          new ServerError({
            tag: "FailedToUpdateWhatsAppSettings",
            statusCode: 500,
            clientMessage: "Failed to save WhatsApp settings",
          }),
        ),
      );
    }
    return normalizeWhatsAppSettings(inserted[0].whatsappConfig);
  });
