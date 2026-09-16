import {
  PixelPlatform,
  TrackingEventName,
  PLATFORM_EVENT_MAP,
  type PixelConfig,
  type TrackingEvent,
  type TrackingProductItem,
} from "#root/shared/types/pixel-tracking";
import type {
  PixelAdapter,
  PixelAdapterState,
  PixelAdapterStatus,
} from "./types";
import { loadSdkScript } from "./sdk-loader";

// ─── Window augmentation for fbq ────────────────────────────────────────────

declare global {
  interface Window {
    fbq: FbqFunction;
    _fbq: FbqFunction;
  }
}

type FbqFunction = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: unknown;
  loaded?: boolean;
  version?: string;
};

const FBEVENTS_URL = "https://connect.facebook.net/en_US/fbevents.js";

/**
 * Install Meta's base code if it isn't already on the page.
 *
 * Matches the official snippet field for field:
 *
 *   n = f.fbq = function(){ n.callMethod ? n.callMethod.apply(n, arguments)
 *                                        : n.queue.push(arguments) };
 *   if (!f._fbq) f._fbq = n;
 *   n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
 *
 * `push`, `loaded` and `version` are not decoration — fbevents.js reads them
 * when it takes over the stub, and other tags (GTM, partner scripts) feature-
 * detect on `fbq.loaded` / `fbq.version`.
 */
function ensureFbqBootstrap(): void {
  if (typeof window === "undefined") return;
  if (typeof window.fbq === "function") return;

  const fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) {
      fbq.callMethod.apply(fbq, args);
    } else {
      fbq.queue.push(args);
    }
  }) as FbqFunction;

  if (!window._fbq) window._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];

  window.fbq = fbq;
}

// ─── Meta-specific parameter builder ────────────────────────────────────────

function buildMetaParams(event: TrackingEvent): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const ecom = event.ecommerce;
  if (!ecom) return params;

  if (ecom.value !== undefined) params.value = ecom.value;
  if (ecom.currency) params.currency = ecom.currency;
  if (ecom.searchQuery) params.search_string = ecom.searchQuery;

  if (ecom.items && ecom.items.length > 0) {
    params.content_ids = ecom.items.map((i: TrackingProductItem) => i.itemId);
    params.contents = ecom.items.map((i: TrackingProductItem) => ({
      id: i.itemId,
      quantity: i.quantity ?? 1,
    }));
    params.content_type = "product";

    // Use the first item's category/name as top-level fields (Meta convention)
    const first = ecom.items[0];
    if (first?.category) params.content_category = first.category;
    if (first?.itemName) params.content_name = first.itemName;

    // num_items = sum of all item quantities (or count if no quantities)
    params.num_items = ecom.items.reduce(
      (sum: number, i: TrackingProductItem) => sum + (i.quantity ?? 1),
      0,
    );
  }

  return params;
}

// ─── Meta Pixel Adapter ─────────────────────────────────────────────────────

const META_EVENT_MAP = PLATFORM_EVENT_MAP[PixelPlatform.META];

export class MetaPixelAdapter implements PixelAdapter {
  readonly platform = PixelPlatform.META;

  configId?: string;

  private state: PixelAdapterState = "idle";
  private loadError?: string;
  private enabled = false;
  private pixelId = "";

  initialize(config: PixelConfig): void {
    if (typeof window === "undefined") return;

    this.enabled = config.enabled;
    this.configId = config.id;

    // Idempotent: `fbq('init', id)` twice for the same id re-registers the
    // pixel and makes Meta's own diagnostics report duplicate initialization.
    //
    // A failed SDK load is the exception: re-initializing is the retry path,
    // so a config refresh (or a later navigation) can recover a pixel that
    // lost fbevents.js to a blocked request. `fbq('init')` is not re-sent in
    // that case — the stub already holds it — only the script is retried.
    if (this.state === "failed") {
      this.retryScriptLoad();
      return;
    }
    if (this.state !== "idle" && this.pixelId === config.pixelId) return;

    this.pixelId = config.pixelId;

    // fbevents.js already installed by a tag manager? Reuse it.
    const preexisting = typeof window.fbq === "function";
    ensureFbqBootstrap();

    // The stub queues calls until fbevents.js takes over, so events fired
    // between now and script load are not lost.
    this.state = "queued";
    this.loadError = undefined;

    window.fbq("init", this.pixelId);
    // No PageView here. The initial page view is emitted by the tracking
    // runtime as a normal `page_viewed` event once adapters are registered,
    // so it carries an eventID and deduplicates against the CAPI event —
    // and re-initializing (after an admin config change, say) cannot fire a
    // second one for the same page load.

    loadSdkScript(
      FBEVENTS_URL,
      (outcome) => {
        if (this.state === "idle") return; // destroyed while loading
        if (outcome === "loaded") {
          this.state = "loaded";
        } else {
          this.state = "failed";
          this.loadError = "Meta fbevents.js failed to load";
        }
      },
      { alreadyPresent: preexisting },
    );
  }

  destroy(): void {
    // fbevents.js cannot be unloaded once evaluated; removing its <script>
    // would only hide state. We stop dispatching instead.
    this.state = "idle";
    this.enabled = false;
    this.loadError = undefined;
  }

  trackEvent(event: TrackingEvent): void {
    if (!this.canAcceptEvents()) return;
    if (typeof window === "undefined" || typeof window.fbq !== "function")
      return;

    const metaEventName = META_EVENT_MAP[event.eventName as TrackingEventName];
    const params = buildMetaParams(event);

    // eventID pairs this call with the CAPI event carrying the same id so
    // Meta deduplicates the two.
    const options: Record<string, unknown> = { eventID: event.eventId };

    if (metaEventName) {
      this.dispatch("trackSingle", metaEventName, params, options);
    } else {
      this.dispatch("trackSingleCustom", event.eventName, params, options);
    }
  }

  isLoaded(): boolean {
    return this.state === "loaded";
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  canAcceptEvents(): boolean {
    // "queued" counts: fbq's stub queue holds calls until fbevents.js drains
    // them. "failed" does not — those calls would sit in a queue forever.
    return this.enabled && (this.state === "queued" || this.state === "loaded");
  }

  getStatus(): PixelAdapterStatus {
    return {
      platform: this.platform,
      configId: this.configId,
      pixelId: this.pixelId,
      state: this.state,
      ...(this.loadError ? { error: this.loadError } : {}),
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Re-attempt the SDK script after a failed load, without touching the
   * bootstrap or re-running `fbq('init')`. The loader discards its memoized
   * failure, so this injects a fresh tag.
   */
  private retryScriptLoad(): void {
    this.state = "queued";
    this.loadError = undefined;

    loadSdkScript(FBEVENTS_URL, (outcome) => {
      if (this.state === "idle") return; // destroyed while loading
      if (outcome === "loaded") {
        this.state = "loaded";
      } else {
        this.state = "failed";
        this.loadError = "Meta fbevents.js failed to load";
      }
    });
  }

  /**
   * `fbq('track', …)` sends to EVERY pixel initialized on the page, so with
   * two configured pixels each event is counted twice and reaches an account
   * it was never meant for. Meta's documented fix is trackSingle /
   * trackSingleCustom, which take the pixel id as the second argument.
   */
  private dispatch(
    command: "trackSingle" | "trackSingleCustom",
    eventName: string,
    params: Record<string, unknown>,
    options: Record<string, unknown>,
  ): void {
    window.fbq(command, this.pixelId, eventName, params, options);
  }
}

export { buildMetaParams, ensureFbqBootstrap, FBEVENTS_URL };
