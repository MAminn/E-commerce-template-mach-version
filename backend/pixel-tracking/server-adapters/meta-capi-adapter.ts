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

/** Meta Conversions API version */
const META_API_VERSION = "v21.0";

/**
 * Build the Meta CAPI `user_data` object from server context.
 */
function buildUserData(event: EnrichedTrackingEvent): Record<string, unknown> {
  const userData: Record<string, unknown> = {};
  const ctx = event.serverContext;

  if (ctx.ip) userData.client_ip_address = ctx.ip;
  if (ctx.userAgent) userData.client_user_agent = ctx.userAgent;
  if (ctx.fbp) userData.fbp = ctx.fbp;
  if (ctx.fbc) userData.fbc = ctx.fbc;

  return userData;
}

/**
 * Build the Meta CAPI `custom_data` object from ecommerce data.
 */
function buildCustomData(
  event: EnrichedTrackingEvent,
): Record<string, unknown> | undefined {
  const ecom = event.ecommerce;
  if (!ecom) return undefined;

  const customData: Record<string, unknown> = {};

  if (ecom.value !== undefined) customData.value = ecom.value;
  if (ecom.currency) customData.currency = ecom.currency;

  if (ecom.items && ecom.items.length > 0) {
    customData.content_ids = ecom.items.map((item) => item.itemId);
    customData.contents = ecom.items.map((item) => ({
      id: item.itemId,
      quantity: item.quantity ?? 1,
    }));
    customData.content_type = "product";
    customData.num_items = ecom.items.reduce(
      (sum, item) => sum + (item.quantity ?? 1),
      0,
    );
  }

  if (ecom.transactionId) customData.order_id = ecom.transactionId;
  if (ecom.searchQuery) customData.search_string = ecom.searchQuery;

  return Object.keys(customData).length > 0 ? customData : undefined;
}

/**
 * Map our internal event name to Meta's standard event name.
 * Falls back to the raw event name (sent as custom event).
 */
function mapEventName(eventName: string): string {
  const mapped =
    PLATFORM_EVENT_MAP[PixelPlatform.META][eventName as TrackingEventName];
  return mapped ?? eventName;
}

/**
 * Build a single Meta CAPI event data object.
 */
function buildMetaEvent(event: EnrichedTrackingEvent): Record<string, unknown> {
  const metaEvent: Record<string, unknown> = {
    event_name: mapEventName(event.eventName),
    event_time: Math.floor(event.timestamp / 1000), // Unix seconds
    event_id: event.eventId, // Shared with client pixel for dedup
    event_source_url: event.pageUrl,
    action_source: "website",
    user_data: buildUserData(event),
  };

  const customData = buildCustomData(event);
  if (customData) metaEvent.custom_data = customData;

  return metaEvent;
}

/** Shape of the parts of Meta's response we interpret. */
interface MetaResponseFacts {
  eventsReceived?: number;
  messages: string[];
  fbtraceId?: string;
  errorMessage?: string;
  errorCode?: string;
}

/**
 * Read Meta's response.
 *
 * Success:  { "events_received": 1, "messages": [], "fbtrace_id": "…" }
 * Failure:  { "error": { "message", "type", "code", "error_subcode",
 *                        "fbtrace_id" } }
 *
 * `messages` carries non-fatal warnings on an otherwise-accepted request.
 */
export function readMetaResponse(
  body: string | undefined,
): MetaResponseFacts | undefined {
  const json = parseJsonBody(body);
  if (!json) return undefined;

  const facts: MetaResponseFacts = { messages: [] };

  if (typeof json.events_received === "number") {
    facts.eventsReceived = json.events_received;
  }
  if (typeof json.fbtrace_id === "string") {
    facts.fbtraceId = json.fbtrace_id;
  }
  if (Array.isArray(json.messages)) {
    facts.messages = json.messages.map((m) =>
      typeof m === "string" ? m : JSON.stringify(m),
    );
  }

  const error = json.error;
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    if (typeof e.message === "string") facts.errorMessage = e.message;
    if (typeof e.code === "number" || typeof e.code === "string") {
      facts.errorCode =
        e.error_subcode !== undefined
          ? `${e.code}/${String(e.error_subcode)}`
          : String(e.code);
    }
    if (typeof e.fbtrace_id === "string") facts.fbtraceId = e.fbtrace_id;
  }

  return facts;
}

/**
 * Send events to Meta's Conversions API.
 *
 * HTTP 200 alone is not treated as acceptance: Meta reports what it took in
 * `events_received`, and a 200 that reports fewer events than we sent (or
 * reports none) is a partial failure the merchant needs to see.
 */
async function sendToMetaCAPI(
  events: EnrichedTrackingEvent[],
  config: PixelConfig,
  options?: SendEventsOptions,
): Promise<AdapterDeliveryResult> {
  const base = { platform: PixelPlatform.META, configId: config.id } as const;

  const accessToken = config.accessToken;
  if (!accessToken) {
    return {
      ...base,
      success: false,
      error: "Missing access token for Meta CAPI",
      retryable: false,
    };
  }
  if (events.length === 0) {
    return { ...base, success: true, acceptedCount: 0, attempts: 0 };
  }

  const url = `https://graph.facebook.com/${META_API_VERSION}/${config.pixelId}/events`;
  const payload: Record<string, unknown> = { data: events.map(buildMetaEvent) };
  // Only ever set for an explicit admin test request — attaching it to normal
  // traffic would route live conversions into Test Events.
  if (options?.testEventCode) payload.test_event_code = options.testEventCode;

  const attempt = await postJsonWithRetry({
    url,
    headers: {
      "Content-Type": "application/json",
      // Token travels in the header, never in the URL, so it cannot end up in
      // an access log or a stored diagnostic.
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.maxAttempts !== undefined
      ? { maxAttempts: options.maxAttempts }
      : {}),
    ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  const responseBody = sanitizeResponseBody(attempt.body);
  const facts = readMetaResponse(attempt.body);

  if (attempt.networkError) {
    return {
      ...base,
      success: false,
      error: attempt.networkError,
      attempts: attempt.attempts,
      retryable: attempt.retryable,
    };
  }

  const status = attempt.status ?? 0;
  const httpOk = status >= 200 && status < 300;

  if (!httpOk) {
    return {
      ...base,
      success: false,
      statusCode: status,
      ...(facts?.errorCode ? { platformCode: facts.errorCode } : {}),
      ...(facts?.errorMessage
        ? { platformMessage: facts.errorMessage }
        : {}),
      ...(facts?.fbtraceId ? { requestId: facts.fbtraceId } : {}),
      ...(responseBody ? { responseBody } : {}),
      error: facts?.errorMessage ?? `Meta CAPI returned ${status}`,
      attempts: attempt.attempts,
      retryable: attempt.retryable,
    };
  }

  // HTTP 2xx from here on.
  if (!facts) {
    return {
      ...base,
      success: false,
      statusCode: status,
      ...(responseBody ? { responseBody } : {}),
      error: "Meta CAPI returned a non-JSON response",
      attempts: attempt.attempts,
      retryable: false,
    };
  }

  if (facts.errorMessage) {
    // Meta can return an error object with a 200 in some proxy setups.
    return {
      ...base,
      success: false,
      statusCode: status,
      ...(facts.errorCode ? { platformCode: facts.errorCode } : {}),
      platformMessage: facts.errorMessage,
      ...(facts.fbtraceId ? { requestId: facts.fbtraceId } : {}),
      ...(responseBody ? { responseBody } : {}),
      error: facts.errorMessage,
      attempts: attempt.attempts,
      retryable: false,
    };
  }

  if (facts.eventsReceived === undefined) {
    return {
      ...base,
      success: false,
      statusCode: status,
      ...(facts.fbtraceId ? { requestId: facts.fbtraceId } : {}),
      ...(responseBody ? { responseBody } : {}),
      error: "Meta CAPI response did not report events_received",
      attempts: attempt.attempts,
      retryable: false,
    };
  }

  const warnings = [...facts.messages];
  if (facts.eventsReceived < events.length) {
    warnings.push(
      `Meta reported ${facts.eventsReceived} of ${events.length} events received`,
    );
  }

  return {
    ...base,
    // Meta took at least one event. Per-event acceptance is not something the
    // response can establish, so acceptedCount is reported as-is.
    success: facts.eventsReceived > 0,
    statusCode: status,
    acceptedCount: facts.eventsReceived,
    ...(facts.fbtraceId ? { requestId: facts.fbtraceId } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(responseBody ? { responseBody } : {}),
    ...(facts.eventsReceived === 0
      ? { error: "Meta CAPI accepted 0 events" }
      : {}),
    attempts: attempt.attempts,
    retryable: false,
  };
}

// ─── Exported adapter ──────────────────────────────────────────────────────

export {
  buildUserData,
  buildCustomData,
  buildMetaEvent,
  mapEventName,
  sendToMetaCAPI,
  META_API_VERSION,
};

/**
 * Meta Conversions API server-side adapter.
 */
export const metaCapiAdapter: ServerPixelAdapter = {
  platform: PixelPlatform.META,

  async sendEvents(
    events: EnrichedTrackingEvent[],
    config: PixelConfig,
    options?: SendEventsOptions,
  ): Promise<AdapterDeliveryResult> {
    return sendToMetaCAPI(events, config, options);
  },
};
