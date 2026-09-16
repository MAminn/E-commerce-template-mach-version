import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  TikTokPixelAdapter,
  buildTikTokParams,
} from "#root/frontend/pixel-adapters/tiktok-pixel-adapter";
import {
  PixelPlatform,
  TrackingEventName,
  type PixelConfig,
  type TrackingEvent,
} from "#root/shared/types/pixel-tracking";
import { installFakeDom, type FakeDom } from "./fake-dom";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<PixelConfig>): PixelConfig {
  return {
    id: "cfg-1",
    platform: PixelPlatform.TIKTOK,
    pixelId: "C1234567890",
    accessToken: null,
    enabled: true,
    enableClientSide: true,
    enableServerSide: false,
    consentRequired: false,
    consentCategory: null,
    settings: null,
    createdAt: new Date(),
    updatedAt: null,
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<TrackingEvent>): TrackingEvent {
  return {
    eventId: "evt-001",
    eventName: TrackingEventName.PAGE_VIEWED,
    timestamp: Date.now(),
    pageUrl: "https://shop.com",
    sessionId: "sess-1",
    ...overrides,
  };
}

/** The per-pixel queue events.js drains: ttq._i[pixelId]. */
function pixelQueue(dom: FakeDom, pixelId = "C1234567890"): unknown[] {
  const ttq = dom.window.ttq as { _i: Record<string, unknown[]> };
  return ttq._i[pixelId] ?? [];
}

/** Find `[method, ...args]` entries queued for a pixel. */
function queuedCalls(dom: FakeDom, method: string, pixelId?: string) {
  return pixelQueue(dom, pixelId).filter(
    (entry): entry is unknown[] =>
      Array.isArray(entry) && entry[0] === method,
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("TikTokPixelAdapter", () => {
  let adapter: TikTokPixelAdapter;
  let dom: FakeDom;

  beforeEach(() => {
    // A genuinely empty window: no pre-installed ttq, so initialize() has to
    // run the real TikTok base code.
    dom = installFakeDom();
    adapter = new TikTokPixelAdapter();
  });

  afterEach(() => {
    adapter.destroy();
    dom.restore();
  });

  it("should report correct platform", () => {
    expect(adapter.platform).toBe(PixelPlatform.TIKTOK);
  });

  // ── Bootstrap ───────────────────────────────────────────────────────────

  describe("bootstrap in a fresh window", () => {
    it("installs TikTok's array-backed command queue, not a plain object", () => {
      adapter.initialize(makeConfig());

      // events.js looks for an ARRAY at window.ttq. An object with a `.queue`
      // property never gets drained, which is why nothing reached TikTok.
      expect(Array.isArray(dom.window.ttq)).toBe(true);
      expect(dom.window.TiktokAnalyticsObject).toBe("ttq");
    });

    it("exposes the documented stub methods and setAndDefer", () => {
      adapter.initialize(makeConfig());
      const ttq = dom.window.ttq as Record<string, unknown> & {
        methods: string[];
      };

      expect(typeof ttq.setAndDefer).toBe("function");
      expect(ttq.methods).toContain("page");
      expect(ttq.methods).toContain("track");
      for (const method of ttq.methods) {
        expect(typeof ttq[method]).toBe("function");
      }
    });

    it("records _i/_t/_o bookkeeping for the pixel on load()", () => {
      adapter.initialize(makeConfig());
      const ttq = dom.window.ttq as {
        _i: Record<string, unknown[] & { _u?: string }>;
        _t: Record<string, number>;
        _o: Record<string, unknown>;
      };

      expect(Array.isArray(ttq._i.C1234567890)).toBe(true);
      expect(ttq._i.C1234567890?._u).toBe(
        "https://analytics.tiktok.com/i18n/pixel/events.js",
      );
      expect(typeof ttq._t.C1234567890).toBe("number");
      expect(ttq._o.C1234567890).toEqual({});
    });

    it("injects events.js with the pixel-specific sdkid and lib parameters", () => {
      adapter.initialize(makeConfig());

      expect(dom.scripts).toHaveLength(1);
      expect(dom.scripts[0]!.src).toBe(
        "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=C1234567890&lib=ttq",
      );
      expect(dom.scripts[0]!.async).toBe(true);
    });

    it("does not re-inject events.js for a second pixel of the same id", () => {
      adapter.initialize(makeConfig());
      const second = new TikTokPixelAdapter();
      second.initialize(makeConfig({ id: "cfg-2" }));

      expect(dom.scripts).toHaveLength(1);
      second.destroy();
    });

    it("injects a separate events.js tag for a second pixel id", () => {
      adapter.initialize(makeConfig());
      const second = new TikTokPixelAdapter();
      second.initialize(makeConfig({ id: "cfg-2", pixelId: "C9999999999" }));

      // Each sdkid needs its own tag: the bootstrap is shared, the loader
      // is not.
      expect(dom.scripts.map((s) => s.src)).toEqual([
        "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=C1234567890&lib=ttq",
        "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=C9999999999&lib=ttq",
      ]);
      second.destroy();
    });

    it("reuses an SDK a tag manager already installed", () => {
      const preinstalled: unknown[] & { load?: unknown; instance?: unknown } =
        [];
      preinstalled.load = () => {};
      preinstalled.instance = () => preinstalled;
      dom.restore();
      dom = installFakeDom({ ttq: preinstalled });
      adapter = new TikTokPixelAdapter();

      adapter.initialize(makeConfig());

      // No second events.js tag, and the existing queue object is kept.
      expect(dom.scripts).toHaveLength(0);
      expect(dom.window.ttq).toBe(preinstalled);
      expect(adapter.isLoaded()).toBe(true);
    });
  });

  // ── Lifecycle state ─────────────────────────────────────────────────────

  describe("load state", () => {
    it("accepts events while queued but does not claim the SDK is loaded", () => {
      adapter.initialize(makeConfig());

      expect(adapter.isLoaded()).toBe(false);
      expect(adapter.canAcceptEvents()).toBe(true);
      expect(adapter.getStatus().state).toBe("queued");
    });

    it("reports loaded only once events.js actually loads", () => {
      adapter.initialize(makeConfig());
      dom.loadAllScripts();

      expect(adapter.isLoaded()).toBe(true);
      expect(adapter.getStatus().state).toBe("loaded");
    });

    it("reports failure and stops dispatching when events.js is blocked", () => {
      adapter.initialize(makeConfig());
      dom.failAllScripts();

      const status = adapter.getStatus();
      expect(status.state).toBe("failed");
      expect(status.error).toContain("failed to load");
      expect(adapter.isLoaded()).toBe(false);
      expect(adapter.canAcceptEvents()).toBe(false);
    });

    it("carries the config id so the registry can hold two TikTok pixels", () => {
      adapter.initialize(makeConfig({ id: "cfg-abc" }));
      expect(adapter.configId).toBe("cfg-abc");
      expect(adapter.getStatus().configId).toBe("cfg-abc");
    });

    it("should not be enabled if config.enabled is false", () => {
      adapter.initialize(makeConfig({ enabled: false }));

      expect(adapter.isEnabled()).toBe(false);
      expect(adapter.canAcceptEvents()).toBe(false);
    });
  });

  // ── Failure recovery ────────────────────────────────────────────────────

  describe("recovery after a failed SDK load", () => {
    it("injects a fresh tag when re-initialized, instead of replaying the failure", () => {
      adapter.initialize(makeConfig());
      dom.failAllScripts();
      expect(adapter.getStatus().state).toBe("failed");

      // A config refresh re-initializes the adapter. The loader must not hand
      // back its memoized "failed" outcome, or the pixel stays dead for the
      // rest of the page even once the block is gone.
      adapter.initialize(makeConfig());

      expect(dom.scripts).toHaveLength(2);
      expect(adapter.getStatus().state).toBe("queued");
      expect(adapter.canAcceptEvents()).toBe(true);
    });

    it("reaches loaded when the retry succeeds", () => {
      adapter.initialize(makeConfig());
      dom.scripts[0]!.fireError();

      adapter.initialize(makeConfig());
      dom.scripts[1]!.fireLoad();

      expect(adapter.isLoaded()).toBe(true);
      expect(adapter.getStatus().error).toBeUndefined();
    });

    it("does not re-run ttq.load() on retry, so the pixel queue survives", () => {
      adapter.initialize(makeConfig());
      dom.loadAllScripts();
      adapter.trackEvent(
        makeEvent({
          eventId: "queued-before-failure",
          eventName: TrackingEventName.PRODUCT_ADDED_TO_CART,
        }),
      );
      expect(queuedCalls(dom, "track")).toHaveLength(1);

      // Force a failure, then retry.
      adapter.initialize(makeConfig());
      dom.scripts.at(-1)!.fireError();
      adapter.initialize(makeConfig());

      // ttq.load() resets ttq._i[pixelId]; the pending call must still be there.
      expect(queuedCalls(dom, "track")).toHaveLength(1);
    });

    it("stays failed when the retry also fails", () => {
      adapter.initialize(makeConfig());
      dom.scripts[0]!.fireError();
      adapter.initialize(makeConfig());
      dom.scripts[1]!.fireError();

      expect(adapter.getStatus().state).toBe("failed");
      expect(adapter.canAcceptEvents()).toBe(false);
    });
  });

  // ── Idempotent initialization ───────────────────────────────────────────

  describe("repeated initialization", () => {
    it("does not reload the same pixel twice", () => {
      adapter.initialize(makeConfig());
      const loadsBefore = queuedCalls(dom, "page").length;

      adapter.initialize(makeConfig());

      // ttq.load() resets _i[pixelId], so a second load would drop whatever
      // was queued. The queue must be untouched.
      expect(queuedCalls(dom, "page").length).toBe(loadsBefore);
      expect(dom.scripts).toHaveLength(1);
    });

    it("refreshes the enabled flag on re-initialization", () => {
      adapter.initialize(makeConfig({ enabled: true }));
      adapter.initialize(makeConfig({ enabled: false }));

      expect(adapter.isEnabled()).toBe(false);
    });
  });

  // ── Event dispatch ──────────────────────────────────────────────────────

  describe("event dispatch", () => {
    beforeEach(() => {
      adapter.initialize(makeConfig());
      dom.loadAllScripts();
    });

    it("fires Pageview through the documented ttq.page() API", () => {
      adapter.trackEvent(makeEvent({ eventName: TrackingEventName.PAGE_VIEWED }));

      expect(queuedCalls(dom, "page")).toHaveLength(1);
      expect(queuedCalls(dom, "track")).toHaveLength(0);
    });

    it("does not fire a Pageview during initialization", () => {
      // The runtime emits the initial page_viewed itself; firing one in
      // initialize() too would double-count every page load.
      const fresh = new TikTokPixelAdapter();
      const freshDom = installFakeDom();
      fresh.initialize(makeConfig({ pixelId: "C999" }));

      expect(queuedCalls(freshDom, "page", "C999")).toHaveLength(0);
      fresh.destroy();
      freshDom.restore();
    });

    it("scopes events to this pixel via ttq.instance(pixelId)", () => {
      adapter.trackEvent(
        makeEvent({ eventName: TrackingEventName.PRODUCT_VIEWED }),
      );

      // Queued on the per-pixel array, not the global one: a second TikTok
      // pixel on the page must not receive this event.
      expect(queuedCalls(dom, "track")).toHaveLength(1);
      const globalQueue = dom.window.ttq as unknown[];
      expect(
        globalQueue.filter(
          (e) => Array.isArray(e) && e[0] === "track",
        ),
      ).toHaveLength(0);
    });

    it("should track ViewContent for product_viewed", () => {
      adapter.trackEvent(
        makeEvent({
          eventName: TrackingEventName.PRODUCT_VIEWED,
          ecommerce: {
            items: [
              { itemId: "SKU-1", itemName: "Widget", price: 19.99, quantity: 1 },
            ],
          },
        }),
      );

      const [call] = queuedCalls(dom, "track");
      expect(call?.[1]).toBe("ViewContent");
      expect(call?.[2]).toMatchObject({
        content_id: "SKU-1",
        content_name: "Widget",
        content_type: "product",
      });
      expect(call?.[3]).toEqual({ event_id: "evt-001" });
    });

    it("should track CompletePayment for checkout_completed", () => {
      adapter.trackEvent(
        makeEvent({
          eventName: TrackingEventName.CHECKOUT_COMPLETED,
          ecommerce: {
            value: 99.99,
            currency: "USD",
            items: [
              {
                itemId: "SKU-1",
                itemName: "Widget",
                price: 49.99,
                quantity: 2,
                category: "Gadgets",
              },
            ],
          },
        }),
      );

      const [call] = queuedCalls(dom, "track");
      expect(call?.[1]).toBe("CompletePayment");
      expect(call?.[2]).toMatchObject({
        value: 99.99,
        currency: "USD",
        content_type: "product",
        quantity: 2,
      });
      expect(call?.[3]).toEqual({ event_id: "evt-001" });
    });

    it("should track Search with query param", () => {
      adapter.trackEvent(
        makeEvent({
          eventName: TrackingEventName.SEARCH_SUBMITTED,
          ecommerce: { searchQuery: "blue shoes" },
        }),
      );

      const [call] = queuedCalls(dom, "track");
      expect(call?.[1]).toBe("Search");
      expect(call?.[2]).toEqual({ query: "blue shoes" });
    });

    it("should use custom event name for unmapped events", () => {
      adapter.trackEvent(makeEvent({ eventName: "my_custom_event" }));

      const [call] = queuedCalls(dom, "track");
      expect(call?.[1]).toBe("my_custom_event");
      expect(call?.[2]).toEqual({});
      expect(call?.[3]).toEqual({ event_id: "evt-001" });
    });

    it("attaches event_id in the documented third argument for dedup", () => {
      adapter.trackEvent(
        makeEvent({
          eventId: "shared-dedup-id",
          eventName: TrackingEventName.PRODUCT_ADDED_TO_CART,
        }),
      );

      const [call] = queuedCalls(dom, "track");
      expect(call?.[3]).toEqual({ event_id: "shared-dedup-id" });
    });

    it("should not track when the SDK failed to load", () => {
      const fresh = new TikTokPixelAdapter();
      const freshDom = installFakeDom();
      fresh.initialize(makeConfig({ pixelId: "C777" }));
      freshDom.failAllScripts();

      fresh.trackEvent(
        makeEvent({ eventName: TrackingEventName.PRODUCT_VIEWED }),
      );

      expect(queuedCalls(freshDom, "track", "C777")).toHaveLength(0);
      fresh.destroy();
      freshDom.restore();
    });

    it("should not track after destroy", () => {
      adapter.destroy();
      adapter.trackEvent(
        makeEvent({ eventName: TrackingEventName.PRODUCT_VIEWED }),
      );

      expect(queuedCalls(dom, "track")).toHaveLength(0);
      expect(adapter.isEnabled()).toBe(false);
      expect(adapter.getStatus().state).toBe("idle");
    });
  });
});

// ─── buildTikTokParams ──────────────────────────────────────────────────────

describe("buildTikTokParams", () => {
  it("returns empty object when no ecommerce data", () => {
    expect(buildTikTokParams(makeEvent())).toEqual({});
  });

  it("maps ecommerce items to TikTok contents format", () => {
    const params = buildTikTokParams(
      makeEvent({
        ecommerce: {
          currency: "USD",
          value: 40,
          items: [
            { itemId: "A", itemName: "Alpha", price: 10, quantity: 2 },
            { itemId: "B", itemName: "Beta", price: 20, quantity: 1 },
          ],
        },
      }),
    );

    expect(params.currency).toBe("USD");
    expect(params.value).toBe(40);
    expect(params.quantity).toBe(3);
    expect(params.contents).toEqual([
      {
        content_id: "A",
        content_name: "Alpha",
        content_type: "product",
        quantity: 2,
        price: 10,
      },
      {
        content_id: "B",
        content_name: "Beta",
        content_type: "product",
        quantity: 1,
        price: 20,
      },
    ]);
  });

  it("maps search query", () => {
    const params = buildTikTokParams(
      makeEvent({ ecommerce: { searchQuery: "hats" } }),
    );
    expect(params.query).toBe("hats");
  });
});
