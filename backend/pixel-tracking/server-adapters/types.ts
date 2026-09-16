import type {
  PixelConfig,
  PixelPlatform,
} from "#root/shared/types/pixel-tracking";
import type { EnrichedTrackingEvent } from "#root/backend/pixel-tracking/event-logger";

/**
 * Result of a server-side adapter delivery attempt.
 *
 * `success` means the platform's API accepted the request — HTTP success AND,
 * where the platform has one, an application-level success code. It does NOT
 * mean the events are visible in Events Manager: platforms
 * accept requests they later drop for stale timestamps, bad identifiers, or
 * pixel/token mismatches. Anything we can prove is carried in the fields
 * below so the admin UI can say exactly what is known.
 */
export interface AdapterDeliveryResult {
  platform: PixelPlatform;

  /** The `pixel_config` row these events were sent to. */
  configId?: string;

  /** Platform API accepted the request (transport + application level). */
  success: boolean;

  /** Final HTTP status, when a response was received. */
  statusCode?: number;

  /** Application-level code: TikTok `code`, Meta `error.code`. */
  platformCode?: string;

  /** Platform-supplied message, sanitized. */
  platformMessage?: string;

  /** `fbtrace_id` (Meta) or `request_id` (TikTok) — what support asks for. */
  requestId?: string;

  /**
   * Events the platform stated it received. `undefined` when the response
   * does not report a count — never assume one.
   */
  acceptedCount?: number;

  /** Non-fatal diagnostics the platform returned. */
  warnings?: string[];

  /** HTTP attempts made, including the first. */
  attempts?: number;

  /** Whether the failure looked transient (worth retrying later). */
  retryable?: boolean;

  /** Truncated, secret-scrubbed response excerpt. */
  responseBody?: string;

  error?: string;

  /** Events deliberately not sent, and why. */
  skipped?: { eventIds: string[]; reason: string };
}

/** Per-request options that must never leak into normal production traffic. */
export interface SendEventsOptions {
  /**
   * Platform test event code, attached to THIS request only. Set by the admin
   * server test; never read from stored configuration.
   */
  testEventCode?: string;
  /**
   * Send page views even where the configuration's policy would skip them
   * (TikTok with both browser and server enabled). Set by the admin server
   * test only, so that choosing "Page view" there still exercises a real API
   * request; production traffic never sets it.
   */
  includePageViews?: boolean;
  /** Per-attempt HTTP timeout. */
  timeoutMs?: number;
  /** Total HTTP attempts (1 = no retries). */
  maxAttempts?: number;
  /** Injectable fetch, for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Server-side pixel adapter interface.
 *
 * Each platform (Meta CAPI, Google MP, TikTok Events API, etc.)
 * implements this to send enriched events from the server.
 */
export interface ServerPixelAdapter {
  platform: PixelPlatform;

  /**
   * Send a batch of enriched tracking events to the platform's server API.
   * Returns a delivery result per-call (not per-event) — see the note on
   * `AdapterDeliveryResult` about what a success does and does not prove.
   */
  sendEvents(
    events: EnrichedTrackingEvent[],
    config: PixelConfig,
    options?: SendEventsOptions,
  ): Promise<AdapterDeliveryResult>;
}
