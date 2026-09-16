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

// ─── Window augmentation for ttq ────────────────────────────────────────────
//
// TikTok's official base code makes `window.ttq` an ARRAY that doubles as a
// command queue: `var ttq = w[t] = w[t] || []`. Every stub method pushes
// `[methodName, ...args]` onto that array (or onto the per-pixel array handed
// back by `ttq.instance(id)`), and events.js drains it once it loads.
//
// A plain object with a `.queue` property is not that shape — events.js never
// finds the pending calls, so nothing is ever sent.

type TtqQueue = unknown[] & {
  page: (...args: unknown[]) => void;
  track: (...args: unknown[]) => void;
  identify: (...args: unknown[]) => void;
};

type TtqGlobal = TtqQueue & {
  methods: string[];
  setAndDefer: (target: unknown[], method: string) => void;
  instance: (pixelId: string) => TtqQueue;
  load: (pixelId: string, options?: Record<string, unknown>) => void;
  _i: Record<string, TtqQueue>;
  _t: Record<string, number>;
  _o: Record<string, unknown>;
};

declare global {
  interface Window {
    ttq: TtqGlobal;
    TiktokAnalyticsObject: string;
  }
}

/** TikTok's base-code method list, verbatim from the official snippet. */
const TTQ_METHODS = [
  "page",
  "track",
  "identify",
  "instances",
  "debug",
  "on",
  "off",
  "once",
  "ready",
  "alias",
  "group",
  "enableCookie",
  "disableCookie",
];

const TTQ_SDK_URL = "https://analytics.tiktok.com/i18n/pixel/events.js";

/** The per-pixel script URL the official loader builds. */
function tiktokSdkUrlFor(pixelId: string): string {
  return `${TTQ_SDK_URL}?sdkid=${encodeURIComponent(pixelId)}&lib=ttq`;
}

/**
 * Marker for a bootstrap this module installed, as opposed to one a tag
 * manager put on the page. The distinction matters: our own bootstrap means
 * events.js still has to be injected for each new sdkid, while a foreign one
 * means the SDK is already live and must not be loaded a second time.
 */
const MACH_BOOTSTRAP_FLAG = "__machTtqBootstrap";

/** Whether `window.ttq` is already TikTok's real (array-backed) queue. */
function hasTtqBootstrap(): boolean {
  const existing = (window as { ttq?: unknown }).ttq;
  return (
    Array.isArray(existing) &&
    typeof (existing as Partial<TtqGlobal>).load === "function"
  );
}

/** Whether the bootstrap on the page came from a tag manager, not from us. */
function hasForeignTtqBootstrap(): boolean {
  if (!hasTtqBootstrap()) return false;
  return (
    (window.ttq as unknown as Record<string, unknown>)[MACH_BOOTSTRAP_FLAG] !==
    true
  );
}

/**
 * Install TikTok's base code if it isn't already on the page.
 *
 * Mirrors the official snippet: array-backed queue, `setAndDefer` stubs,
 * `instance()` returning a per-pixel queue, and a `load()` that records the
 * `_i`/`_t`/`_o` bookkeeping events.js reads. Script injection itself is
 * delegated to the shared loader so two TikTok pixels don't inject the same
 * file twice and so load failures are observable.
 */
function ensureTtqBootstrap(): void {
  if (typeof window === "undefined" || hasTtqBootstrap()) return;

  const w = window as Window & { ttq?: unknown };
  w.TiktokAnalyticsObject = "ttq";

  // `w[t] = w[t] || []` — preserve anything a tag manager already queued.
  const ttq = (Array.isArray(w.ttq) ? w.ttq : []) as TtqGlobal;
  w.ttq = ttq;

  (ttq as unknown as Record<string, unknown>)[MACH_BOOTSTRAP_FLAG] = true;
  ttq.methods = TTQ_METHODS;
  ttq.setAndDefer = (target: unknown[], method: string) => {
    (target as unknown as Record<string, unknown>)[method] = (
      ...args: unknown[]
    ) => {
      target.push([method, ...args]);
    };
  };
  for (const method of ttq.methods) ttq.setAndDefer(ttq, method);

  ttq.instance = (pixelId: string): TtqQueue => {
    const queue = (ttq._i?.[pixelId] ?? []) as TtqQueue;
    for (const method of ttq.methods) ttq.setAndDefer(queue, method);
    return queue;
  };

  ttq.load = (pixelId: string, options?: Record<string, unknown>) => {
    ttq._i = ttq._i ?? {};
    ttq._i[pixelId] = [] as unknown as TtqQueue;
    (ttq._i[pixelId] as unknown as { _u?: string })._u = TTQ_SDK_URL;
    ttq._t = ttq._t ?? {};
    ttq._t[pixelId] = Date.now();
    ttq._o = ttq._o ?? {};
    ttq._o[pixelId] = options ?? {};
    // The official snippet injects the <script> here; we do it through
    // loadSdkScript instead so the load/error outcome can be observed.
  };
}

// ─── TikTok-specific parameter builder ──────────────────────────────────────

function buildTikTokParams(event: TrackingEvent): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const ecom = event.ecommerce;
  if (!ecom) return params;

  if (ecom.value !== undefined) params.value = ecom.value;
  if (ecom.currency) params.currency = ecom.currency;

  if (ecom.items && ecom.items.length > 0) {
    params.contents = ecom.items.map((i: TrackingProductItem) => ({
      content_id: i.itemId,
      content_name: i.itemName,
      content_type: "product",
      quantity: i.quantity ?? 1,
      price: i.price ?? 0,
    }));
    params.content_type = "product";

    const first = ecom.items[0];
    if (first) {
      params.content_id = first.itemId;
      params.content_name = first.itemName;
    }

    params.quantity = ecom.items.reduce(
      (sum: number, i: TrackingProductItem) => sum + (i.quantity ?? 1),
      0,
    );
  }

  if (ecom.searchQuery) params.query = ecom.searchQuery;

  return params;
}

// ─── TikTok Pixel Adapter ───────────────────────────────────────────────────

const TIKTOK_EVENT_MAP = PLATFORM_EVENT_MAP[PixelPlatform.TIKTOK];

export class TikTokPixelAdapter implements PixelAdapter {
  readonly platform = PixelPlatform.TIKTOK;

  configId?: string;

  private state: PixelAdapterState = "idle";
  private loadError?: string;
  private enabled = false;
  private pixelId = "";

  initialize(config: PixelConfig): void {
    if (typeof window === "undefined") return;

    this.enabled = config.enabled;
    this.configId = config.id;

    // Idempotent: re-initializing the same pixel only refreshes `enabled`.
    // Calling ttq.load() twice for one id resets that pixel's queue and would
    // fire a second Pageview for what is still one page load.
    //
    // A failed SDK load is the exception: re-initializing is the retry path,
    // so a config refresh can recover a pixel that lost events.js to a
    // blocked request. `ttq.load()` is NOT re-run — that would clear the
    // per-pixel queue — only the script is retried.
    if (this.state === "failed") {
      this.retryScriptLoad();
      return;
    }
    if (this.state !== "idle" && this.pixelId === config.pixelId) return;

    this.pixelId = config.pixelId;

    // An SDK already installed by a tag manager is reused as-is. Our own
    // bootstrap does NOT count: each pixel id gets its own
    // events.js?sdkid=… tag, so a second configured pixel still needs one.
    const preexisting = hasForeignTtqBootstrap();
    ensureTtqBootstrap();

    // The stub queue accepts calls from here on, so nothing is dropped while
    // events.js is still in flight.
    this.state = "queued";
    this.loadError = undefined;

    window.ttq.load(this.pixelId);
    // No page() here. The initial page view is emitted by the tracking runtime
    // as a normal `page_viewed` event once adapters are registered, which
    // routes to trackPageView() below — so re-initializing (after an admin
    // config change, say) cannot fire a second Pageview for one page load.

    loadSdkScript(
      tiktokSdkUrlFor(this.pixelId),
      (outcome) => {
        if (this.state === "idle") return; // destroyed while loading
        if (outcome === "loaded") {
          this.state = "loaded";
        } else {
          this.state = "failed";
          this.loadError = "TikTok events.js failed to load";
        }
      },
      { alreadyPresent: preexisting },
    );
  }

  destroy(): void {
    // A vendor SDK cannot be unloaded once evaluated, so removing its <script>
    // would only hide state. We stop dispatching instead.
    this.state = "idle";
    this.enabled = false;
    this.loadError = undefined;
  }

  trackEvent(event: TrackingEvent): void {
    if (!this.canAcceptEvents()) return;
    if (typeof window === "undefined" || !window.ttq) return;

    const tiktokEventName =
      TIKTOK_EVENT_MAP[event.eventName as TrackingEventName];

    if (
      event.eventName === TrackingEventName.PAGE_VIEWED &&
      tiktokEventName === "Pageview"
    ) {
      // Page views use the documented ttq.page() API. The initial one is
      // fired in initialize(); client-side navigations arrive here.
      this.trackPageView();
      return;
    }

    const params = buildTikTokParams(event);
    // Documented signature: ttq.track(name, properties, { event_id }). The
    // event_id matches the one the Events API receives so TikTok can
    // deduplicate the browser/server pair.
    const options: Record<string, unknown> = { event_id: event.eventId };

    this.instance().track(tiktokEventName ?? event.eventName, params, options);
  }

  /** Fire a Pageview for this pixel only (client-side navigation). */
  trackPageView(): void {
    if (!this.canAcceptEvents()) return;
    if (typeof window === "undefined" || !window.ttq) return;
    this.instance().page();
  }

  isLoaded(): boolean {
    return this.state === "loaded";
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  canAcceptEvents(): boolean {
    // "queued" counts: TikTok's stub queue holds calls until events.js drains
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
   * Re-attempt the SDK script after a failed load, without re-running
   * `ttq.load()` (which would reset this pixel's queue and drop whatever is
   * pending in it). The loader discards its memoized failure, so this injects
   * a fresh tag.
   */
  private retryScriptLoad(): void {
    this.state = "queued";
    this.loadError = undefined;

    loadSdkScript(tiktokSdkUrlFor(this.pixelId), (outcome) => {
      if (this.state === "idle") return; // destroyed while loading
      if (outcome === "loaded") {
        this.state = "loaded";
      } else {
        this.state = "failed";
        this.loadError = "TikTok events.js failed to load";
      }
    });
  }

  /**
   * Per-pixel command target. `ttq.track(...)` on the global object fans the
   * event out to every loaded TikTok pixel; `ttq.instance(id)` scopes it to
   * this configuration.
   */
  private instance(): TtqQueue {
    if (typeof window.ttq.instance === "function") {
      return window.ttq.instance(this.pixelId);
    }
    return window.ttq as TtqQueue;
  }
}

export { buildTikTokParams, ensureTtqBootstrap, tiktokSdkUrlFor };
