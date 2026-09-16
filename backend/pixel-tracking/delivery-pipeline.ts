import type { ServerContext } from "#root/server/routes/track";
import type {
  TrackingEvent,
  PixelConfig,
} from "#root/shared/types/pixel-tracking";
import type { DatabaseClient } from "#root/shared/database/drizzle/db";
import {
  enrichEvents,
  type EnrichedTrackingEvent,
} from "#root/backend/pixel-tracking/event-logger";
import {
  pixelConfig,
  trackingEvent,
  trackingEventDelivery,
} from "#root/shared/database/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { v7 } from "uuid";
import { isConfigAllowedByConsent } from "#root/shared/utils/consent-gate";

// Server-side adapters
import { metaCapiAdapter } from "#root/backend/pixel-tracking/server-adapters/meta-capi-adapter";
import { googleMPAdapter } from "#root/backend/pixel-tracking/server-adapters/google-mp-adapter";
import { tiktokEventsAdapter } from "#root/backend/pixel-tracking/server-adapters/tiktok-events-adapter";
import { snapchatCapiAdapter } from "#root/backend/pixel-tracking/server-adapters/snapchat-capi-adapter";
import { pinterestCapiAdapter } from "#root/backend/pixel-tracking/server-adapters/pinterest-capi-adapter";
import type {
  ServerPixelAdapter,
  AdapterDeliveryResult,
} from "#root/backend/pixel-tracking/server-adapters/types";

/**
 * Map of platform → server-side adapter.
 */
const SERVER_ADAPTERS: Partial<Record<string, ServerPixelAdapter>> = {
  meta: metaCapiAdapter,
  google_ga4: googleMPAdapter,
  tiktok: tiktokEventsAdapter,
  snapchat: snapchatCapiAdapter,
  pinterest: pinterestCapiAdapter,
};

/**
 * Persist enriched events to the tracking_event table using a direct DB call.
 * Returns the inserted row IDs so we can link delivery records.
 *
 * `onConflictDoNothing` on `event_id` makes this the deduplication point for
 * repeated beacons: the same event id delivered twice (a retried sendBeacon, a
 * page restored from bfcache) inserts once and returns one row.
 */
async function persistEvents(
  events: EnrichedTrackingEvent[],
  db: DatabaseClient,
): Promise<{ id: string; eventId: string }[]> {
  if (events.length === 0) return [];

  const rows = events.map((event) => ({
    id: v7(),
    sessionId: event.sessionId,
    userId: event.userId ?? null,
    eventName: event.eventName,
    eventId: event.eventId,
    eventData: event as unknown as Record<string, unknown>,
    pageUrl: event.pageUrl,
    referrer: event.referrer ?? null,
    utmSource: event.utmSource ?? null,
    utmMedium: event.utmMedium ?? null,
    utmCampaign: event.utmCampaign ?? null,
    userAgent: event.serverContext.userAgent || null,
    ipHash: event.serverContext.ipHash || null,
    deviceType: null,
  }));

  const result = await db
    .insert(trackingEvent)
    .values(rows)
    .onConflictDoNothing({ target: trackingEvent.eventId })
    .returning({ id: trackingEvent.id, eventId: trackingEvent.eventId });

  return result;
}

/**
 * Fetch all pixel configs that have server-side enabled.
 */
async function getEnabledServerConfigs(
  db: DatabaseClient,
): Promise<PixelConfig[]> {
  const configs = await db
    .select()
    .from(pixelConfig)
    .where(
      and(
        eq(pixelConfig.enabled, true),
        eq(pixelConfig.enableServerSide, true),
      ),
    )
    .execute();

  return configs as unknown as PixelConfig[];
}

/**
 * Log one delivery attempt against one tracking event.
 *
 * Everything the platform told us is kept: HTTP status, application code and
 * message, the trace/request id support will ask for, how many events it
 * reported receiving, and which pixel configuration was targeted. The adapter
 * has already scrubbed secrets out of these fields.
 */
async function logDeliveryResult(
  db: DatabaseClient,
  trackingEventDbId: string,
  result: AdapterDeliveryResult,
  options?: { skippedReason?: string },
): Promise<void> {
  const sent = options?.skippedReason ? false : result.success;

  await db.insert(trackingEventDelivery).values({
    id: v7(),
    trackingEventId: trackingEventDbId,
    platform:
      result.platform as (typeof pixelConfig.platform.enumValues)[number],
    pixelConfigId: result.configId ?? null,
    sent,
    sentAt: sent ? new Date() : null,
    platformEventId: null,
    statusCode: result.statusCode ?? null,
    platformCode: result.platformCode ?? null,
    platformMessage: result.platformMessage ?? null,
    requestId: result.requestId ?? null,
    acceptedCount: result.acceptedCount ?? null,
    attempts: result.attempts ?? null,
    skippedReason: options?.skippedReason ?? null,
    error: options?.skippedReason ? null : (result.error ?? null),
  });
}

/**
 * Send enriched events to a single server adapter and log delivery.
 * Never throws — failures are logged.
 *
 * The adapter result describes one API call for the whole batch, which is all
 * these APIs report. Each event gets its own row so the log stays per-event,
 * but every row carries the same batch-level diagnostics rather than implying
 * the platform confirmed that specific event.
 */
async function sendToAdapterAndLog(
  adapter: ServerPixelAdapter,
  events: EnrichedTrackingEvent[],
  config: PixelConfig,
  insertedRows: { id: string; eventId: string }[],
  db: DatabaseClient,
): Promise<void> {
  const write = async (
    rowId: string,
    result: AdapterDeliveryResult,
    skippedReason?: string,
  ) => {
    try {
      await logDeliveryResult(
        db,
        rowId,
        result,
        skippedReason ? { skippedReason } : undefined,
      );
    } catch (logErr) {
      console.error(
        `[Delivery Pipeline] Failed to log delivery for event ${rowId}:`,
        logErr,
      );
    }
  };

  try {
    const result = await adapter.sendEvents(events, config);
    const skippedIds = new Set(result.skipped?.eventIds ?? []);

    for (const row of insertedRows) {
      if (skippedIds.has(row.eventId)) {
        await write(row.id, result, result.skipped?.reason);
      } else {
        await write(row.id, result);
      }
    }
  } catch (err) {
    console.error(`[Delivery Pipeline] Adapter ${adapter.platform} threw:`, err);
    const errorResult: AdapterDeliveryResult = {
      platform: adapter.platform,
      configId: config.id,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
    for (const row of insertedRows) {
      await write(row.id, errorResult);
    }
  }
}

/**
 * Process a batch of tracking events received via the beacon endpoint.
 *
 * Flow: enrich → persist (dedup) → consent gate → fan-out (parallel) → log.
 *
 * Only events that the insert actually created are forwarded. A duplicate
 * beacon carrying event ids we already stored used to be re-sent to every
 * platform, which inflates Purchase counts on any platform whose dedup window
 * has passed; now those events are dropped at the database boundary and the
 * still-new events in the same batch are delivered normally.
 *
 * DELIVERY RETRY — what exists and what does not:
 *
 *   Within one request, `postJsonWithRetry` retries transient failures
 *   (429/5xx/network) up to its attempt limit. That is the whole of the retry
 *   behaviour.
 *
 *   A delivery that still fails after those attempts is NOT re-sent later.
 *   It is recorded in `tracking_event_delivery` with sent = false plus the
 *   HTTP status, platform code/message, request id and attempt count, and it
 *   is counted in the admin delivery statistics as failed. There is no
 *   background queue and no automatic re-delivery.
 *
 *   Duplicate suppression above is NOT that retry path and must not be read
 *   as one. A repeat beacon for an event whose first delivery failed is
 *   dropped here, because the event row already exists — the platform call is
 *   not attempted again. Re-delivering failed events is a separate piece of
 *   work; until it exists, the failure count in the admin is the signal.
 */
export async function processTrackingBeacon(
  events: TrackingEvent[],
  serverContext: ServerContext,
  db: DatabaseClient,
): Promise<void> {
  if (events.length === 0) return;

  // 1. Enrich events with server context
  const enriched = enrichEvents(events, serverContext);

  // 2. Persist to tracking_event table (dedups on event_id)
  let insertedRows: { id: string; eventId: string }[];
  try {
    insertedRows = await persistEvents(enriched, db);
  } catch (err) {
    console.error("[Delivery Pipeline] Failed to persist events:", err);
    return; // Can't proceed without DB rows for delivery logging
  }

  // Every event was a duplicate — already stored, already attempted once.
  // Nothing is re-sent; see the retry note above.
  if (insertedRows.length === 0) return;

  // 3. Forward only the newly accepted events.
  const insertedIds = new Set(insertedRows.map((row) => row.eventId));
  const newEvents = enriched.filter((event) => insertedIds.has(event.eventId));
  if (newEvents.length === 0) return;

  // 4. Get enabled server-side configs
  let serverConfigs: PixelConfig[];
  try {
    serverConfigs = await getEnabledServerConfigs(db);
  } catch (err) {
    console.error("[Delivery Pipeline] Failed to fetch server configs:", err);
    return;
  }

  if (serverConfigs.length === 0) return;

  // 5. Apply the visitor's consent decision to the SERVER path too.
  //
  // Gating only the browser pixel would be worse than not gating at all: the
  // visitor sees no pixel, believes marketing tracking is off, and the
  // Conversions API relays the same conversions anyway. Same cookie, same
  // rule, same configuration as the browser — see shared/utils/consent-gate.
  const consent = serverContext.consent ?? null;
  const allowedConfigs = serverConfigs.filter((config) =>
    isConfigAllowedByConsent(config, consent),
  );

  if (allowedConfigs.length === 0) return;

  // 6. Fan-out to adapters in parallel, one call per configuration.
  const adapterPromises = allowedConfigs
    .map((config) => {
      const adapter = SERVER_ADAPTERS[config.platform];
      if (!adapter) return null;
      return sendToAdapterAndLog(adapter, newEvents, config, insertedRows, db);
    })
    .filter(Boolean);

  await Promise.allSettled(adapterPromises as Promise<void>[]);
}

// Re-export for testing
export {
  persistEvents,
  getEnabledServerConfigs,
  logDeliveryResult,
  sendToAdapterAndLog,
  SERVER_ADAPTERS,
};
