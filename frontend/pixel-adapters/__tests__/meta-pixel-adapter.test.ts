import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MetaPixelAdapter,
  buildMetaParams,
} from "#root/frontend/pixel-adapters/meta-pixel-adapter";
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
    platform: PixelPlatform.META,
    pixelId: "123456789",
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

/** Calls sitting in fbq's stub queue, as arrays of arguments. */
function fbqQueue(dom: FakeDom): unknown[][] {
  const fbq = dom.window.fbq as { queue: unknown[][] };
  return fbq.queue;
}

function queuedCommands(dom: FakeDom, command: string): unknown[][] {
  return fbqQueue(dom).filter((args) => args[0] === command);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("MetaPixelAdapter", () => {
  let adapter: MetaPixelAdapter;
  let dom: FakeDom;

  beforeEach(() => {
    // A genuinely empty window, so initialize() has to install the real
    // Meta base code rather than finding a pre-made mock.
    dom = installFakeDom();
    adapter = new MetaPixelAdapter();
  });

  afterEach(() => {
    adapter.destroy();
    dom.restore();
  });

  it("should report correct platform", () => {
    expect(adapter.platform).toBe(PixelPlatform.META);
  });

  // ── Bootstrap ───────────────────────────────────────────────────────────

  describe("bootstrap in a fresh window", () => {
    it("installs every field of Meta's official stub", () => {
      adapter.initialize(makeConfig());
      const fbq = dom.window.fbq as {
        push: unknown;
        loaded?: boolean;
        version?: string;
        queue: unknown[];
        callMethod?: unknown;
      };

      expect(typeof dom.window.fbq).toBe("function");
      // fbevents.js and third-party tags read these; the previous bootstrap
      // omitted all three.
      expect(fbq.push).toBe(dom.window.fbq);
      expect(fbq.loaded).toBe(true);
      expect(fbq.version).toBe("2.0");
      expect(Array.isArray(fbq.queue)).toBe(true);
      expect(dom.window._fbq).toBe(dom.window.fbq);
    });

    it("queues calls until fbevents.js takes over via callMethod", () => {
      adapter.initialize(makeConfig());
      expect(queuedCommands(dom, "init")).toHaveLength(1);

      // Simulate fbevents.js installing callMethod.
      const callMethod = vi.fn();
      (dom.window.fbq as { callMethod?: unknown }).callMethod = callMethod;
      adapter.trackEvent(
        makeEvent({ eventName: TrackingEventName.PRODUCT_VIEWED }),
      );

      expect(callMethod).toHaveBeenCalledTimes(1);
    });

    it("injects fbevents.js once", () => {
      adapter.initialize(makeConfig());

      expect(dom.scripts).toHaveLength(1);
      expect(dom.scripts[0]!.src).toBe(
        "https://connect.facebook.net/en_US/fbevents.js",
      );
      expect(dom.scripts[0]!.async).toBe(true);
    });

    it("does not inject fbevents.js twice for a second Meta pixel", () => {
      adapter.initialize(makeConfig());
      const second = new MetaPixelAdapter();
      second.initialize(makeConfig({ id: "cfg-2", pixelId: "987654321" }));

      expect(dom.scripts).toHaveLength(1);
      expect(queuedCommands(dom, "init")).toHaveLength(2);
      second.destroy();
    });

    it("reuses an fbq a tag manager already installed", () => {
      const existing = Object.assign(vi.fn(), { queue: [] as unknown[] });
      dom.restore();
      dom = installFakeDom({ fbq: existing });
      adapter = new MetaPixelAdapter();

      adapter.initialize(makeConfig());

      expect(dom.window.fbq).toBe(existing);
      expect(dom.scripts).toHaveLength(0);
      expect(existing).toHaveBeenCalledWith("init", "123456789");
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

    it("reports loaded only once fbevents.js actually loads", () => {
      adapter.initialize(makeConfig());
      dom.loadAllScripts();

      expect(adapter.isLoaded()).toBe(true);
      expect(adapter.getStatus().state).toBe("loaded");
    });

    it("reports failure and stops dispatching when fbevents.js is blocked", () => {
      adapter.initialize(makeConfig());
      dom.failAllScripts();

      const status = adapter.getStatus();
      expect(status.state).toBe("failed");
      expect(status.error).toContain("failed to load");
      expect(adapter.canAcceptEvents()).toBe(false);

      const before = queuedCommands(dom, "trackSingle").length;
      adapter.trackEvent(
        makeEvent({ eventName: TrackingEventName.PRODUCT_VIEWED }),
      );
      expect(queuedCommands(dom, "trackSingle")).toHaveLength(before);
    });

    it("carries the config id so the registry can hold two Meta pixels", () => {
      adapter.initialize(makeConfig({ id: "cfg-xyz" }));
      expect(adapter.configId).toBe("cfg-xyz");
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

    it("does not re-send fbq('init') on retry", () => {
      adapter.initialize(makeConfig());
      dom.scripts[0]!.fireError();
      adapter.initialize(makeConfig());

      // A second init for the same pixel id is what makes Meta report a
      // duplicate installation.
      expect(queuedCommands(dom, "init")).toHaveLength(1);
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
    it("does not re-init the same pixel id", () => {
      adapter.initialize(makeConfig());
      adapter.initialize(makeConfig());

      // A second fbq('init', id) makes Meta's own diagnostics report a
      // duplicate pixel installation.
      expect(queuedCommands(dom, "init")).toHaveLength(1);
    });

    it("does not fire a PageView during initialization", () => {
      adapter.initialize(makeConfig());

      // The runtime emits the initial page_viewed, so it carries an eventID
      // and dedupes with CAPI; firing one here too would double-count.
      expect(queuedCommands(dom, "trackSingle")).toHaveLength(0);
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

    it("should track a standard PageView event scoped to this pixel", () => {
      adapter.trackEvent(makeEvent({ eventName: TrackingEventName.PAGE_VIEWED }));

      // trackSingle, not track: fbq('track', …) broadcasts to every pixel
      // initialized on the page.
      expect(queuedCommands(dom, "track")).toHaveLength(0);
      const [call] = queuedCommands(dom, "trackSingle");
      expect(call?.[1]).toBe("123456789");
      expect(call?.[2]).toBe("PageView");
      expect(call?.[4]).toEqual({ eventID: "evt-001" });
    });

    it("should track Purchase event with ecommerce data", () => {
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

      const [call] = queuedCommands(dom, "trackSingle");
      expect(call?.[2]).toBe("Purchase");
      expect(call?.[3]).toMatchObject({
        value: 99.99,
        currency: "USD",
        content_ids: ["SKU-1"],
        content_type: "product",
        num_items: 2,
      });
    });

    it("should track Search event with search_string", () => {
      adapter.trackEvent(
        makeEvent({
          eventName: TrackingEventName.SEARCH_SUBMITTED,
          ecommerce: { searchQuery: "blue shoes" },
        }),
      );

      const [call] = queuedCommands(dom, "trackSingle");
      expect(call?.[2]).toBe("Search");
      expect(call?.[3]).toEqual({ search_string: "blue shoes" });
    });

    it("should use trackSingleCustom for unmapped events", () => {
      adapter.trackEvent(makeEvent({ eventName: "my_custom_event" }));

      expect(queuedCommands(dom, "trackCustom")).toHaveLength(0);
      const [call] = queuedCommands(dom, "trackSingleCustom");
      expect(call?.[1]).toBe("123456789");
      expect(call?.[2]).toBe("my_custom_event");
      expect(call?.[4]).toEqual({ eventID: "evt-001" });
    });

    it("attaches eventID for server-side dedup", () => {
      adapter.trackEvent(
        makeEvent({
          eventId: "shared-dedup-id",
          eventName: TrackingEventName.PRODUCT_ADDED_TO_CART,
        }),
      );

      const [call] = queuedCommands(dom, "trackSingle");
      expect(call?.[4]).toEqual({ eventID: "shared-dedup-id" });
    });

    it("sends each pixel only its own events", () => {
      const second = new MetaPixelAdapter();
      second.initialize(makeConfig({ id: "cfg-2", pixelId: "987654321" }));

      adapter.trackEvent(
        makeEvent({ eventName: TrackingEventName.PRODUCT_VIEWED }),
      );

      const calls = queuedCommands(dom, "trackSingle");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toBe("123456789");
      second.destroy();
    });

    it("should not track after destroy", () => {
      adapter.destroy();
      adapter.trackEvent(
        makeEvent({ eventName: TrackingEventName.PRODUCT_VIEWED }),
      );

      expect(queuedCommands(dom, "trackSingle")).toHaveLength(0);
      expect(adapter.getStatus().state).toBe("idle");
    });
  });
});

// ─── buildMetaParams ────────────────────────────────────────────────────────

describe("buildMetaParams", () => {
  it("returns empty object when no ecommerce data", () => {
    expect(buildMetaParams(makeEvent())).toEqual({});
  });

  it("maps items to content_ids, contents and num_items", () => {
    const params = buildMetaParams(
      makeEvent({
        ecommerce: {
          currency: "EUR",
          value: 30,
          items: [
            { itemId: "A", itemName: "Alpha", quantity: 2, category: "Cat" },
            { itemId: "B", itemName: "Beta" },
          ],
        },
      }),
    );

    expect(params.currency).toBe("EUR");
    expect(params.value).toBe(30);
    expect(params.content_ids).toEqual(["A", "B"]);
    expect(params.contents).toEqual([
      { id: "A", quantity: 2 },
      { id: "B", quantity: 1 },
    ]);
    expect(params.num_items).toBe(3);
    expect(params.content_category).toBe("Cat");
    expect(params.content_name).toBe("Alpha");
  });
});
