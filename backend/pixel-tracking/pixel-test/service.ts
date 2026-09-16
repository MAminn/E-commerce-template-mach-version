import { query } from "#root/shared/database/drizzle/db";
import { pixelConfig } from "#root/shared/database/drizzle/schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { v7 } from "uuid";
import { ServerError } from "#root/shared/error/server";
import {
  PixelPlatform,
  TrackingEventName,
  type PixelConfig,
} from "#root/shared/types/pixel-tracking";
import type { EnrichedTrackingEvent } from "#root/backend/pixel-tracking/event-logger";
import type {
  AdapterDeliveryResult,
  ServerPixelAdapter,
} from "#root/backend/pixel-tracking/server-adapters/types";
import { metaCapiAdapter } from "#root/backend/pixel-tracking/server-adapters/meta-capi-adapter";
import { googleMPAdapter } from "#root/backend/pixel-tracking/server-adapters/google-mp-adapter";
import {
  tiktokEventsAdapter,
  serverSidePageViewEnabled,
} from "#root/backend/pixel-tracking/server-adapters/tiktok-events-adapter";
import { snapchatCapiAdapter } from "#root/backend/pixel-tracking/server-adapters/snapchat-capi-adapter";
import { pinterestCapiAdapter } from "#root/backend/pixel-tracking/server-adapters/pinterest-capi-adapter";
import { redactSecrets } from "#root/backend/pixel-tracking/server-adapters/http";

const SERVER_ADAPTERS: Partial<Record<string, ServerPixelAdapter>> = {
  meta: metaCapiAdapter,
  google_ga4: googleMPAdapter,
  tiktok: tiktokEventsAdapter,
  snapchat: snapchatCapiAdapter,
  pinterest: pinterestCapiAdapter,
};

/**
 * Events a synthetic test may send.
 *
 * `checkout_completed` is deliberately absent: a test Purchase lands in the
 * same conversion metrics the media buyer optimizes against and, once sent,
 * cannot be taken back. Test Events mode reduces but does not eliminate that
 * — some platforms still count test purchases in aggregate reporting.
 */
export const TESTABLE_EVENT_NAMES = [
  TrackingEventName.PAGE_VIEWED,
  TrackingEventName.PRODUCT_VIEWED,
  TrackingEventName.PRODUCT_ADDED_TO_CART,
  TrackingEventName.CHECKOUT_STARTED,
] as const;

export const testServerPixelSchema = z.object({
  /** The saved pixel configuration to target — exactly one. */
  configId: z.string().uuid(),
  /**
   * Defaults to product_viewed → "ViewContent", which is a documented
   * standard event on both Meta and TikTok. A page-view default would be
   * silently skipped by the TikTok adapter for a both-paths configuration,
   * and a test that sends no request proves nothing.
   */
  eventName: z
    .enum(TESTABLE_EVENT_NAMES)
    .optional()
    .default(TrackingEventName.PRODUCT_VIEWED),
  /**
   * Platform test event code (Meta "TEST12345", TikTok test_event_code).
   * Attached to this request only — it is never stored on the configuration
   * and never reaches normal production traffic.
   */
  testEventCode: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Test code may only contain letters, digits, - and _")
    .optional(),
  /** Absolute URL reported as the event source. */
  pageUrl: z.string().url().optional(),
});

export type TestServerPixelInput = z.infer<typeof testServerPixelSchema>;

/** What the admin UI is allowed to see. Never includes tokens. */
export interface ServerPixelTestResult {
  configId: string;
  platform: PixelPlatform;
  /** Pixel id, masked — enough to confirm which pixel was targeted. */
  pixelIdMasked: string;
  eventName: string;
  /** Shared browser/server id; paste into Test Events to find the event. */
  eventId: string;
  testEventCode?: string;
  /** The platform API accepted the request. NOT proof of visibility. */
  acceptedByApi: boolean;
  statusCode?: number;
  platformCode?: string;
  platformMessage?: string;
  requestId?: string;
  acceptedCount?: number;
  warnings?: string[];
  attempts?: number;
  error?: string;
  skippedReason?: string;
  /**
   * Set when the test forced an event through that normal storefront traffic
   * would NOT send for this configuration (a TikTok page view on a pixel with
   * both browser and server enabled). The API call was real; the production
   * behaviour is different.
   */
  productionWouldSkip?: string;
  /** Plain-language next step for the media buyer. */
  verifyIn: string;
}

const VERIFY_HINTS: Partial<Record<PixelPlatform, string>> = {
  [PixelPlatform.META]:
    "Events Manager → your pixel → Test Events. Match on the Event ID below.",
  [PixelPlatform.TIKTOK]:
    "TikTok Events Manager → your pixel → Test Event. Match on the Event ID below.",
  [PixelPlatform.GOOGLE_GA4]:
    "GA4 → Admin → DebugView / Realtime.",
  [PixelPlatform.SNAPCHAT]:
    "Snapchat Ads Manager → Events Manager → your pixel.",
  [PixelPlatform.PINTEREST]:
    "Pinterest Ads → Conversions → Event history.",
};

export function maskPixelId(pixelId: string): string {
  const trimmed = pixelId.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

/** Build the synthetic event sent by the test. Never persisted. */
export function buildTestEvent(
  input: TestServerPixelInput,
  eventId: string,
  pageUrl: string,
): EnrichedTrackingEvent {
  const base: EnrichedTrackingEvent = {
    eventId,
    eventName: input.eventName,
    timestamp: Date.now(),
    pageUrl,
    sessionId: `pixel-test-${eventId.slice(0, 8)}`,
    // Marks the event in any downstream inspection as operator-generated.
    customProperties: { synthetic_test: true },
    serverContext: {
      ip: "",
      ipHash: "",
      userAgent: "MachPixelTest/1.0",
    },
  };

  if (
    input.eventName === TrackingEventName.PRODUCT_VIEWED ||
    input.eventName === TrackingEventName.PRODUCT_ADDED_TO_CART ||
    input.eventName === TrackingEventName.CHECKOUT_STARTED
  ) {
    base.ecommerce = {
      currency: "USD",
      value: 1,
      items: [
        {
          itemId: "PIXEL-TEST-SKU",
          itemName: "Pixel test item",
          price: 1,
          quantity: 1,
        },
      ],
    };
  }

  return base;
}

function toResult(
  config: PixelConfig,
  input: TestServerPixelInput,
  eventId: string,
  delivery: AdapterDeliveryResult,
): ServerPixelTestResult {
  return {
    configId: config.id,
    platform: config.platform,
    pixelIdMasked: maskPixelId(config.pixelId),
    eventName: input.eventName,
    eventId,
    ...(input.testEventCode ? { testEventCode: input.testEventCode } : {}),
    acceptedByApi: delivery.success,
    ...(delivery.statusCode !== undefined
      ? { statusCode: delivery.statusCode }
      : {}),
    ...(delivery.platformCode ? { platformCode: delivery.platformCode } : {}),
    ...(delivery.platformMessage
      ? { platformMessage: redactSecrets(delivery.platformMessage) }
      : {}),
    ...(delivery.requestId ? { requestId: delivery.requestId } : {}),
    ...(delivery.acceptedCount !== undefined
      ? { acceptedCount: delivery.acceptedCount }
      : {}),
    ...(delivery.warnings?.length
      ? { warnings: delivery.warnings.map(redactSecrets) }
      : {}),
    ...(delivery.attempts !== undefined ? { attempts: delivery.attempts } : {}),
    ...(delivery.error ? { error: redactSecrets(delivery.error) } : {}),
    ...(delivery.skipped ? { skippedReason: delivery.skipped.reason } : {}),
    ...(input.eventName === TrackingEventName.PAGE_VIEWED &&
    config.platform === PixelPlatform.TIKTOK &&
    !serverSidePageViewEnabled(config)
      ? {
          productionWouldSkip:
            "This test sent the page view, but normal storefront traffic does not send server-side page views for this TikTok pixel because browser tracking is also enabled (they cannot be deduplicated). Set settings.serverSidePageView = true to change that.",
        }
      : {}),
    verifyIn:
      VERIFY_HINTS[config.platform] ??
      "Check the platform's own event inspector.",
  };
}

/**
 * Send one synthetic event to exactly one saved pixel configuration through
 * the real server adapter.
 *
 * The event is NOT written to `tracking_event`, so operator tests never move
 * the dashboard's own counters or the delivery statistics.
 */
export const testServerPixel = (input: TestServerPixelInput) =>
  Effect.gen(function* () {
    const rows = yield* query(async (db) =>
      db
        .select()
        .from(pixelConfig)
        .where(eq(pixelConfig.id, input.configId))
        .execute(),
    );

    const config = rows[0] as PixelConfig | undefined;
    if (!config) {
      return yield* Effect.fail(
        new ServerError({
          tag: "NotFound",
          message: `Pixel config ${input.configId} not found`,
          statusCode: 404,
          clientMessage: "Pixel configuration not found",
        }),
      );
    }

    if (!config.enableServerSide) {
      return yield* Effect.fail(
        new ServerError({
          tag: "BadRequest",
          message: "Server-side delivery is disabled for this configuration",
          statusCode: 400,
          clientMessage:
            "Server-side delivery is turned off for this pixel. Enable it (and add an access token) before running a server test.",
        }),
      );
    }

    const adapter = SERVER_ADAPTERS[config.platform];
    if (!adapter) {
      return yield* Effect.fail(
        new ServerError({
          tag: "BadRequest",
          message: `No server adapter for platform ${config.platform}`,
          statusCode: 400,
          clientMessage:
            "This platform has no server-side Conversions API integration.",
        }),
      );
    }

    const eventId = v7();
    const pageUrl = input.pageUrl ?? "https://example.invalid/pixel-test";
    const event = buildTestEvent(input, eventId, pageUrl);

    const delivery = yield* Effect.promise(() =>
      adapter.sendEvents([event], config, {
        ...(input.testEventCode
          ? { testEventCode: input.testEventCode }
          : {}),
        // An operator who picks "Page view" wants the API exercised, even
        // where production policy skips server page views for this config.
        // The result still reports what production would do — see
        // `productionWouldSkip` below.
        includePageViews: true,
        // A test should answer quickly and must not sit in a retry loop.
        timeoutMs: 8000,
        maxAttempts: 1,
      }),
    );

    return toResult(config, input, eventId, delivery);
  });

export { SERVER_ADAPTERS as TEST_SERVER_ADAPTERS };
