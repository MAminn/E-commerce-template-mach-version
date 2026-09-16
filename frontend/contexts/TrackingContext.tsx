import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { usePageContext } from "vike-react/usePageContext";
import { v7 } from "uuid";
import {
  TrackingEventName,
  type ConsentState,
  type TrackingEvent,
  type EcommerceEventData,
  type PixelConfig,
  type CustomTrackingEventConfig,
} from "#root/shared/types/pixel-tracking";
import {
  CONSENT_COOKIE,
  parseConsentCookieValue,
} from "#root/shared/utils/consent-gate";
import { trackingEventBus } from "#root/shared/utils/tracking-event-bus";
import { getSessionId } from "#root/shared/utils/session-id";
import { trpc } from "#root/shared/trpc/client";
import {
  TrackingRuntime,
  type TrackingRuntimeDiagnostics,
} from "#root/frontend/tracking/tracking-runtime";
import { CustomEventTriggerManager } from "#root/frontend/tracking/custom-event-triggers";
import { EngagementTracker } from "#root/frontend/pixel-adapters/engagement-tracker";

// ─── Cross-component signals ────────────────────────────────────────────────

/** Dispatched by the admin pixels page after a configuration is saved. */
export const PIXEL_CONFIGS_CHANGED_EVENT = "tracking:pixel-configs-changed";
/** Dispatched by ConsentContext when the visitor's choice changes. */
export const CONSENT_CHANGED_EVENT = "tracking:consent-changed";

// ─── UTM Parsing ────────────────────────────────────────────────────────────

interface UtmParams {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

function parseUtmParams(): UtmParams {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const utm: UtmParams = {};
  const src = params.get("utm_source");
  const med = params.get("utm_medium");
  const camp = params.get("utm_campaign");
  const term = params.get("utm_term");
  const content = params.get("utm_content");
  if (src) utm.utmSource = src;
  if (med) utm.utmMedium = med;
  if (camp) utm.utmCampaign = camp;
  if (term) utm.utmTerm = term;
  if (content) utm.utmContent = content;
  return utm;
}

// ─── Consent ────────────────────────────────────────────────────────────────

/**
 * Read the stored decision so a returning visitor keeps their choice across
 * reloads without the banner re-asking. Uses the same parser as the beacon
 * endpoint — a second implementation here is how browser and server gating
 * would quietly diverge.
 */
export function readConsentCookie(): ConsentState | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`),
  );
  return parseConsentCookieValue(match?.[1]);
}

// ─── Context Types ──────────────────────────────────────────────────────────

interface TrackingContextValue {
  trackEvent: (
    eventName: TrackingEventName | string,
    data?: {
      ecommerce?: EcommerceEventData;
      customProperties?: Record<string, unknown>;
    },
  ) => void;
  sessionId: string;
  /**
   * Fire one event at a single pixel configuration, for the admin browser
   * test. Returns whether the vendor SDK accepted the call — never whether
   * the platform received it.
   */
  dispatchToConfig: (
    configId: string,
    eventName: TrackingEventName | string,
    data?: {
      ecommerce?: EcommerceEventData;
      customProperties?: Record<string, unknown>;
    },
  ) => { dispatched: boolean; eventId: string };
  /** Re-read pixel configurations (after an admin change). */
  refreshPixelConfigs: () => Promise<void>;
  /** Adapter lifecycle snapshot for the admin diagnostics view. */
  getDiagnostics: () => TrackingRuntimeDiagnostics | null;
}

const TrackingContext = createContext<TrackingContextValue | undefined>(
  undefined,
);

// ─── Provider ───────────────────────────────────────────────────────────────

export function TrackingProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState<string>("");
  const utmRef = useRef<UtmParams>({});
  const pageContext = usePageContext();
  const currentUrl = `${pageContext.urlPathname ?? ""}${
    (pageContext as { urlParsed?: { searchOriginal?: string | null } })
      .urlParsed?.searchOriginal ?? ""
  }`;

  // Initialize session ID and UTM params once
  useEffect(() => {
    setSessionId(getSessionId());
    utmRef.current = parseUtmParams();
  }, []);

  // ── Tracking runtime (adapters, buffering, consent) ─────────────────────
  const runtimeRef = useRef<TrackingRuntime | null>(null);
  const lastPageViewUrl = useRef<string | null>(null);
  const trackEventRef = useRef<
    (
      eventName: TrackingEventName | string,
      data?: {
        ecommerce?: EcommerceEventData;
        customProperties?: Record<string, unknown>;
      },
    ) => void
  >(() => {});

  // ── Custom Event Triggers ──────────────────────────────────────────────
  const customTriggerRef = useRef<CustomEventTriggerManager | null>(null);

  // ── Engagement Tracker ─────────────────────────────────────────────────
  const engagementRef = useRef<EngagementTracker | null>(null);

  // ── Beacon Buffer ──────────────────────────────────────────────────────
  const eventBufferRef = useRef<TrackingEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Flush all buffered events to the beacon endpoint via fetch. */
  const flushBuffer = useCallback(() => {
    if (typeof window === "undefined") return;
    const buffer = eventBufferRef.current;
    if (buffer.length === 0) return;

    const batch = [...buffer];
    eventBufferRef.current = [];

    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true, // ensures delivery even during navigation
      credentials: "same-origin", // send first-party cookies (_ga, _fbp, etc.)
    }).catch(() => {
      // Silent — fire-and-forget
    });
  }, []);

  /** Add an event to the buffer; auto-flush after 250ms debounce. */
  const bufferEvent = useCallback(
    (event: TrackingEvent) => {
      eventBufferRef.current.push(event);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(flushBuffer, 250);
    },
    [flushBuffer],
  );

  // ── Visibility change: sendBeacon for guaranteed delivery ──────────────
  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        const buffer = eventBufferRef.current;
        if (buffer.length === 0) return;

        // Clear the debounce timer so we don't double-send
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }

        const payload = JSON.stringify({ events: [...buffer] });
        eventBufferRef.current = [];

        // navigator.sendBeacon is guaranteed to fire even on page unload
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          navigator.sendBeacon(
            "/api/track",
            new Blob([payload], { type: "application/json" }),
          );
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      // Flush any remaining events on unmount
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (eventBufferRef.current.length > 0) {
        const payload = JSON.stringify({
          events: [...eventBufferRef.current],
        });
        eventBufferRef.current = [];
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          navigator.sendBeacon(
            "/api/track",
            new Blob([payload], { type: "application/json" }),
          );
        }
      }
    };
  }, []);

  /** Build a canonical TrackingEvent. Callers own what happens to it. */
  const buildEvent = useCallback(
    (
      eventName: TrackingEventName | string,
      data?: {
        ecommerce?: EcommerceEventData;
        customProperties?: Record<string, unknown>;
      },
    ): TrackingEvent => ({
      eventId: v7(),
      eventName,
      timestamp: Date.now(),
      pageUrl: typeof window !== "undefined" ? window.location.href : "",
      referrer: typeof document !== "undefined" ? document.referrer : undefined,
      sessionId: sessionId || getSessionId(),
      ...utmRef.current,
      ecommerce: data?.ecommerce,
      customProperties: data?.customProperties,
    }),
    [sessionId],
  );

  const trackEvent = useCallback(
    (
      eventName: TrackingEventName | string,
      data?: {
        ecommerce?: EcommerceEventData;
        customProperties?: Record<string, unknown>;
      },
    ) => {
      const event = buildEvent(eventName, data);

      // Emit to the event bus — the runtime receives it via its subscription
      // and either dispatches it or queues it until adapters exist.
      trackingEventBus.emit(event);

      // Buffer event for server-side beacon relay
      bufferEvent(event);

      // Dev logging
      if (
        typeof window !== "undefined" &&
        window.location.hostname === "localhost"
      ) {
        console.debug("[Tracking]", event.eventName, event);
      }
    },
    [buildEvent, bufferEvent],
  );
  trackEventRef.current = trackEvent;

  useEffect(() => {
    // Only run client-side
    if (typeof window === "undefined") return;

    const runtime = new TrackingRuntime({
      loadConfigs: async () => {
        const result = await trpc.pixelTracking.config.listActive.query();
        if (!result.success) {
          throw new Error("Pixel configuration request was rejected");
        }
        return result.result as PixelConfig[];
      },
      onError: (message, error) => {
        // A silent failure here means no browser pixels at all while the
        // server beacon keeps reporting events, which reads as "tracking
        // works". Always leave a trace.
        console.error(message, error);
      },
    });
    runtimeRef.current = runtime;
    runtime.setConsent(readConsentCookie());

    // Local-development inspection hook: lets a browser session (or an
    // automated one) read adapter lifecycle state without a React handle.
    // Never installed on a real hostname.
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      (window as unknown as Record<string, unknown>).__machTracking = {
        getDiagnostics: () => runtime.getDiagnostics(),
        refresh: () => runtime.refresh(),
      };
    }

    // Subscribe the runtime to the event bus before loading configs so events
    // emitted during the request are queued rather than lost.
    const unsubscribe = trackingEventBus.subscribe((event) => {
      runtime.handleEvent(event);
    });

    const handleConsentChanged = (e: Event) => {
      const detail = (e as CustomEvent<ConsentState>).detail;
      runtime.setConsent(detail ?? readConsentCookie());
    };
    const handleConfigsChanged = () => {
      void runtime.refresh();
    };
    window.addEventListener(CONSENT_CHANGED_EVENT, handleConsentChanged);
    window.addEventListener(PIXEL_CONFIGS_CHANGED_EVENT, handleConfigsChanged);

    void runtime.initialize().finally(() => {
      // Initial page view, fired once adapters exist so it carries an event id
      // that deduplicates against the server-side event of the same name.
      if (runtimeRef.current !== runtime) return;
      if (lastPageViewUrl.current !== null) return;
      lastPageViewUrl.current =
        typeof window !== "undefined" ? window.location.href : "";
      trackEventRef.current(TrackingEventName.PAGE_VIEWED);
    });

    return () => {
      unsubscribe();
      window.removeEventListener(CONSENT_CHANGED_EVENT, handleConsentChanged);
      window.removeEventListener(
        PIXEL_CONFIGS_CHANGED_EVENT,
        handleConfigsChanged,
      );
      runtime.destroy();
      runtimeRef.current = null;
      delete (window as unknown as Record<string, unknown>).__machTracking;
    };
  }, []);

  // ── Client-side navigation page views ───────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    // The initial page view is fired by the bootstrap effect above. This only
    // covers real client-side navigations, and only when the URL changed.
    if (lastPageViewUrl.current === null) return;
    if (lastPageViewUrl.current === window.location.href) return;

    lastPageViewUrl.current = window.location.href;
    trackEventRef.current(TrackingEventName.PAGE_VIEWED);
  }, [currentUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    const manager = new CustomEventTriggerManager(
      (eventName, customProperties) => {
        trackEvent(eventName, { customProperties });
      },
    );
    customTriggerRef.current = manager;

    // Fetch active custom event configs
    trpc.pixelTracking.customEvents.listActive
      .query()
      .then((result) => {
        if (cancelled) return;
        if (!result.success) return;
        const configs = result.result as CustomTrackingEventConfig[];
        manager.loadConfigs(configs);
      })
      .catch(() => {
        if (
          typeof window !== "undefined" &&
          window.location.hostname === "localhost"
        ) {
          console.debug("[Tracking] Failed to fetch custom event configs");
        }
      });

    // Listen for test events from the dashboard
    const handleTestEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.eventName) {
        trackEvent(detail.eventName, {
          customProperties: detail.eventData ?? {},
        });
      }
    };
    window.addEventListener("tracking:custom-event-test", handleTestEvent);

    return () => {
      cancelled = true;
      window.removeEventListener("tracking:custom-event-test", handleTestEvent);
      manager.destroyAll();
      customTriggerRef.current = null;
    };
  }, [trackEvent]);

  // ── Engagement Tracker Initialization ──────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    const tracker = new EngagementTracker((eventName, customProperties) => {
      trackEvent(eventName, { customProperties });
    });
    engagementRef.current = tracker;
    tracker.start();

    return () => {
      tracker.destroy();
      engagementRef.current = null;
    };
  }, [trackEvent]);

  const dispatchToConfig = useCallback<
    TrackingContextValue["dispatchToConfig"]
  >(
    (configId, eventName, data) => {
      const event = buildEvent(eventName, data);
      const runtime = runtimeRef.current;
      if (!runtime) return { dispatched: false, eventId: event.eventId };
      return {
        dispatched: runtime.dispatchToConfig(configId, event),
        eventId: event.eventId,
      };
    },
    [buildEvent],
  );

  const refreshPixelConfigs = useCallback(async () => {
    await runtimeRef.current?.refresh();
  }, []);

  const getDiagnostics = useCallback(
    () => runtimeRef.current?.getDiagnostics() ?? null,
    [],
  );

  const value = useMemo<TrackingContextValue>(
    () => ({
      trackEvent,
      sessionId,
      dispatchToConfig,
      refreshPixelConfigs,
      getDiagnostics,
    }),
    [
      trackEvent,
      sessionId,
      dispatchToConfig,
      refreshPixelConfigs,
      getDiagnostics,
    ],
  );

  return (
    <TrackingContext.Provider value={value}>
      {children}
    </TrackingContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useTracking(): TrackingContextValue {
  const context = useContext(TrackingContext);
  if (!context) {
    throw new Error("useTracking must be used within a TrackingProvider");
  }
  return context;
}
