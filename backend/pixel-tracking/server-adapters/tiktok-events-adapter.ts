import {
  PixelPlatform,
  PLATFORM_EVENT_MAP,
  TrackingEventName,
  type PixelConfig,
} from "#root/shared/types/pixel-tracking";
import type { EnrichedTrackingEvent } from "#root/backend/pixel-tracking/event-logger";
import type {
  ServerPixelAdapter,
  AdapterDeliveryResult,
  SendEventsOptions,
} from "./types";
import {
  parseJsonBody,
  postJsonWithRetry,
  sanitizeResponseBody,
} from "./http";

/** TikTok Events API v1.3 endpoint */
const TIKTOK_API_URL =
  "https://business-api.tiktok.com/open_api/v1.3/event/track/";

/**
 * Whether this configuration should send `Pageview` to the Events API.
 *
 * TikTok documents `event_id` deduplication only for
 * `ttq.track(name, properties, { event_id })`. Page views are reported by
 * `ttq.page()`, whose documented signature takes no event id, and "Pageview"
 * is not in TikTok's published Standard Events list. So a browser page view
 * and a server page view cannot be paired — only one of the two paths may
 * send them.
 *
 * That gives three cases, and only the third suppresses anything:
 *
 *   browser-only (enableClientSide, no server)
 *       Browser sends ttq.page(). Server sends nothing — it isn't running.
 *
 *   server-only (enableServerSide, no client)
 *       No browser page view exists, so the server MUST send Pageview or the
 *       merchant loses page views entirely. Sent.
 *
 *   both enabled
 *       The browser already sent ttq.page(). Sending a server copy would
 *       double-count, with no way to deduplicate it. Skipped by default and
 *       reported as skipped, never silently dropped.
 *
 * The last case is overridable per configuration for merchants who would
 * rather have the server-side signal and accept the double count (for
 * example while the browser pixel is blocked for most of their traffic):
 *
 *   pixel_config.settings = { "serverSidePageView": true }
 */
function serverSidePageViewEnabled(config: PixelConfig): boolean {
  // Explicit opt-in always wins.
  if (config.settings?.serverSidePageView === true) return true;
  // Explicit opt-out always wins too.
  if (config.settings?.serverSidePageView === false) return false;
  // Otherwise: send unless the browser pixel is also running for this config.
  return !config.enableClientSide;
}

/**
 * Map our internal event name to TikTok's event name.
 */
function mapEventName(eventName: string): string {
  const mapped =
    PLATFORM_EVENT_MAP[PixelPlatform.TIKTOK][eventName as TrackingEventName];
  return mapped ?? eventName;
}

/**
 * Build the TikTok `user` object from server context.
 */
function buildUserData(event: EnrichedTrackingEvent): Record<string, unknown> {
  const ctx = event.serverContext;
  const user: Record<string, unknown> = {};

  if (ctx.ip) user.ip = ctx.ip;
  if (ctx.userAgent) user.user_agent = ctx.userAgent;
  if (ctx.ttp) user.ttp = ctx.ttp;

  return user;
}

/**
 * Build the TikTok `properties` object from ecommerce data.
 */
function buildProperties(
  event: EnrichedTrackingEvent,
): Record<string, unknown> | undefined {
  const ecom = event.ecommerce;
  if (!ecom) return undefined;

  const props: Record<string, unknown> = {};

  if (ecom.value !== undefined) props.value = ecom.value;
  if (ecom.currency) props.currency = ecom.currency;

  if (ecom.items && ecom.items.length > 0) {
    props.contents = ecom.items.map((item) => ({
      content_id: item.itemId,
      content_type: "product",
      content_name: item.itemName,
      quantity: item.quantity ?? 1,
      price: item.price ?? 0,
    }));
    props.content_type = "product";

    const first = ecom.items[0];
    if (first) {
      props.content_id = first.itemId;
    }
  }

  if (ecom.searchQuery) props.query = ecom.searchQuery;

  return Object.keys(props).length > 0 ? props : undefined;
}

/**
 * Build a single TikTok Events API data object.
 */
function buildTikTokEvent(
  event: EnrichedTrackingEvent,
): Record<string, unknown> {
  const tiktokEvent: Record<string, unknown> = {
    event: mapEventName(event.eventName),
    event_time: Math.floor(event.timestamp / 1000),
    event_id: event.eventId,
    user: buildUserData(event),
    page: {
      url: event.pageUrl,
      referrer: event.referrer ?? undefined,
    },
  };

  const properties = buildProperties(event);
  if (properties) tiktokEvent.properties = properties;

  return tiktokEvent;
}

/** Shape of the parts of TikTok's response we interpret. */
interface TikTokResponseFacts {
  code?: number;
  message?: string;
  requestId?: string;
}

/**
 * Read TikTok's response envelope.
 *
 * TikTok answers HTTP 200 for application-level failures too:
 *
 *   { "code": 0,     "message": "OK",               "request_id": "…" }
 *   { "code": 40100, "message": "Access token …",   "request_id": "…" }
 *
 * Only `code === 0` is success. Treating `response.ok` as success is what
 * makes an invalid token or a mismatched pixel id look like a healthy
 * integration in the delivery log.
 */
export function readTikTokResponse(
  body: string | undefined,
): TikTokResponseFacts | undefined {
  const json = parseJsonBody(body);
  if (!json) return undefined;

  const facts: TikTokResponseFacts = {};
  if (typeof json.code === "number") facts.code = json.code;
  if (typeof json.message === "string") facts.message = json.message;
  if (typeof json.request_id === "string") facts.requestId = json.request_id;
  return facts;
}

/**
 * Send events to TikTok's Events API.
 */
async function sendToTikTokEventsAPI(
  events: EnrichedTrackingEvent[],
  config: PixelConfig,
  options?: SendEventsOptions,
): Promise<AdapterDeliveryResult> {
  const base = { platform: PixelPlatform.TIKTOK, configId: config.id } as const;

  const accessToken = config.accessToken;
  if (!accessToken) {
    return {
      ...base,
      success: false,
      error: "Missing access token for TikTok Events API",
      retryable: false,
    };
  }

  const sendable =
    serverSidePageViewEnabled(config) || options?.includePageViews === true
      ? events
    : events.filter(
        (event) => event.eventName !== TrackingEventName.PAGE_VIEWED,
      );
  const skippedIds = events
    .filter((event) => !sendable.includes(event))
    .map((event) => event.eventId);
  const skipped =
    skippedIds.length > 0
      ? {
          skipped: {
            eventIds: skippedIds,
            reason:
              "Browser tracking is enabled for this TikTok pixel, so the page view was already sent by ttq.page(). TikTok documents no event_id for page views, so a server copy could not be deduplicated. Set settings.serverSidePageView = true to send it anyway and accept the double count.",
          },
        }
      : {};

  if (sendable.length === 0) {
    return { ...base, success: true, acceptedCount: 0, attempts: 0, ...skipped };
  }

  const payload: Record<string, unknown> = {
    event_source: "web",
    event_source_id: config.pixelId,
    data: sendable.map(buildTikTokEvent),
  };
  // Only ever set for an explicit admin test request.
  if (options?.testEventCode) payload.test_event_code = options.testEventCode;

  const attempt = await postJsonWithRetry({
    url: TIKTOK_API_URL,
    headers: {
      "Content-Type": "application/json",
      "Access-Token": accessToken,
    },
    body: JSON.stringify(payload),
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.maxAttempts !== undefined
      ? { maxAttempts: options.maxAttempts }
      : {}),
    ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  const responseBody = sanitizeResponseBody(attempt.body);
  const facts = readTikTokResponse(attempt.body);

  if (attempt.networkError) {
    return {
      ...base,
      success: false,
      error: attempt.networkError,
      attempts: attempt.attempts,
      retryable: attempt.retryable,
      ...skipped,
    };
  }

  const status = attempt.status ?? 0;
  const httpOk = status >= 200 && status < 300;

  if (!httpOk) {
    return {
      ...base,
      success: false,
      statusCode: status,
      ...(facts?.code !== undefined ? { platformCode: String(facts.code) } : {}),
      ...(facts?.message ? { platformMessage: facts.message } : {}),
      ...(facts?.requestId ? { requestId: facts.requestId } : {}),
      ...(responseBody ? { responseBody } : {}),
      error: facts?.message ?? `TikTok Events API returned ${status}`,
      attempts: attempt.attempts,
      retryable: attempt.retryable,
      ...skipped,
    };
  }

  if (!facts || facts.code === undefined) {
    return {
      ...base,
      success: false,
      statusCode: status,
      ...(facts?.requestId ? { requestId: facts.requestId } : {}),
      ...(responseBody ? { responseBody } : {}),
      error: "TikTok Events API returned a response without a result code",
      attempts: attempt.attempts,
      retryable: false,
      ...skipped,
    };
  }

  if (facts.code !== 0) {
    return {
      ...base,
      success: false,
      statusCode: status,
      platformCode: String(facts.code),
      ...(facts.message ? { platformMessage: facts.message } : {}),
      ...(facts.requestId ? { requestId: facts.requestId } : {}),
      ...(responseBody ? { responseBody } : {}),
      error: facts.message
        ? `TikTok Events API error ${facts.code}: ${facts.message}`
        : `TikTok Events API error ${facts.code}`,
      attempts: attempt.attempts,
      // TikTok's rate-limit / server-busy codes are the only retryable class; the
      // rest (bad token, unknown pixel) repeat identically.
      retryable: facts.code === 40100 ? false : facts.code >= 50000,
      ...skipped,
    };
  }

  return {
    ...base,
    success: true,
    statusCode: status,
    platformCode: "0",
    ...(facts.message ? { platformMessage: facts.message } : {}),
    ...(facts.requestId ? { requestId: facts.requestId } : {}),
    // TikTok's envelope reports no per-event count, so we record only what we
    // sent — it is not evidence that every event was accepted.
    acceptedCount: sendable.length,
    ...(responseBody ? { responseBody } : {}),
    attempts: attempt.attempts,
    retryable: false,
    ...skipped,
  };
}

export {
  mapEventName,
  buildUserData,
  buildProperties,
  buildTikTokEvent,
  sendToTikTokEventsAPI,
  serverSidePageViewEnabled,
  TIKTOK_API_URL,
};

export const tiktokEventsAdapter: ServerPixelAdapter = {
  platform: PixelPlatform.TIKTOK,

  async sendEvents(
    events: EnrichedTrackingEvent[],
    config: PixelConfig,
    options?: SendEventsOptions,
  ): Promise<AdapterDeliveryResult> {
    return sendToTikTokEventsAPI(events, config, options);
  },
};
