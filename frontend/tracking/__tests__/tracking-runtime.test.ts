import { describe, it, expect, vi } from "vitest";
import {
  TrackingRuntime,
  isConfigAllowedByConsent,
} from "#root/frontend/tracking/tracking-runtime";
import type {
  PixelAdapter,
  PixelAdapterStatus,
} from "#root/frontend/pixel-adapters/types";
import {
  PixelPlatform,
  TrackingEventName,
  type ConsentState,
  type PixelConfig,
  type TrackingEvent,
} from "#root/shared/types/pixel-tracking";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<PixelConfig>): PixelConfig {
  return {
    id: "cfg-meta",
    platform: PixelPlatform.META,
    pixelId: "PIXEL-1",
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
    eventId: "evt-1",
    eventName: TrackingEventName.PRODUCT_ADDED_TO_CART,
    timestamp: Date.now(),
    pageUrl: "https://shop.test/p/1",
    sessionId: "sess-1",
    ...overrides,
  };
}

interface FakeAdapter extends PixelAdapter {
  events: TrackingEvent[];
  initCount: number;
  destroyCount: number;
}

function makeFakeAdapter(platform = PixelPlatform.META): FakeAdapter {
  const adapter: FakeAdapter = {
    platform,
    configId: undefined,
    events: [],
    initCount: 0,
    destroyCount: 0,
    initialize(config) {
      adapter.initCount += 1;
      (adapter as { configId?: string }).configId = config.id;
      (adapter as { enabled?: boolean }).enabled = config.enabled;
    },
    destroy() {
      adapter.destroyCount += 1;
      (adapter as { enabled?: boolean }).enabled = false;
    },
    trackEvent(event) {
      adapter.events.push(event);
    },
    isLoaded: () => true,
    isEnabled: () => (adapter as { enabled?: boolean }).enabled !== false,
    canAcceptEvents: () =>
      (adapter as { enabled?: boolean }).enabled !== false,
    getStatus: (): PixelAdapterStatus => ({
      platform,
      configId: adapter.configId,
      pixelId: "PIXEL-1",
      state: "loaded",
    }),
  };
  return adapter;
}

/** A loadConfigs that resolves only when the test says so. */
function deferredConfigs(configs: PixelConfig[]) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    loadConfigs: async () => {
      await gate;
      return configs;
    },
    release,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("TrackingRuntime — early events", () => {
  it("replays commerce events emitted before configs finish loading", async () => {
    const adapter = makeFakeAdapter();
    const { loadConfigs, release } = deferredConfigs([makeConfig()]);
    const runtime = new TrackingRuntime({
      loadConfigs,
      createAdapter: () => adapter,
    });

    const pending = runtime.initialize();

    // A shopper adds to cart while the config request is still in flight.
    // This used to reach /api/track and nothing else.
    runtime.handleEvent(makeEvent({ eventId: "early-atc" }));
    expect(adapter.events).toHaveLength(0);

    release();
    await pending;

    expect(adapter.events.map((e) => e.eventId)).toEqual(["early-atc"]);
    expect(runtime.getDiagnostics().replayedEventCount).toBe(1);
  });

  it("preserves the original event id on replay so dedup still works", async () => {
    const adapter = makeFakeAdapter();
    const { loadConfigs, release } = deferredConfigs([makeConfig()]);
    const runtime = new TrackingRuntime({
      loadConfigs,
      createAdapter: () => adapter,
    });

    const pending = runtime.initialize();
    runtime.handleEvent(makeEvent({ eventId: "shared-id-42" }));
    release();
    await pending;

    // The same id was already sent to /api/track by the caller; a regenerated
    // id here would break browser/server deduplication.
    expect(adapter.events[0]!.eventId).toBe("shared-id-42");
  });

  it("bounds the queue and counts what it drops", async () => {
    const adapter = makeFakeAdapter();
    const { loadConfigs, release } = deferredConfigs([makeConfig()]);
    const runtime = new TrackingRuntime({
      loadConfigs,
      createAdapter: () => adapter,
      maxQueuedEvents: 3,
    });

    const pending = runtime.initialize();
    for (let i = 0; i < 6; i++) {
      runtime.handleEvent(makeEvent({ eventId: `e${i}` }));
    }
    release();
    await pending;

    expect(adapter.events.map((e) => e.eventId)).toEqual(["e3", "e4", "e5"]);
    expect(runtime.getDiagnostics().droppedEventCount).toBe(3);
  });

  it("dispatches directly once initialization is done", async () => {
    const adapter = makeFakeAdapter();
    const runtime = new TrackingRuntime({
      loadConfigs: async () => [makeConfig()],
      createAdapter: () => adapter,
    });

    await runtime.initialize();
    runtime.handleEvent(makeEvent({ eventId: "later" }));

    expect(adapter.events.map((e) => e.eventId)).toEqual(["later"]);
    expect(runtime.getDiagnostics().replayedEventCount).toBe(0);
  });
});

describe("TrackingRuntime — config load failure", () => {
  it("reports the failure instead of degrading silently", async () => {
    const onError = vi.fn();
    const runtime = new TrackingRuntime({
      loadConfigs: async () => {
        throw new Error("network down");
      },
      createAdapter: () => makeFakeAdapter(),
      onError,
    });

    await runtime.initialize();

    const diagnostics = runtime.getDiagnostics();
    expect(diagnostics.phase).toBe("config-failed");
    expect(diagnostics.configError).toContain("network down");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("drops the queue rather than holding events forever", async () => {
    const runtime = new TrackingRuntime({
      loadConfigs: async () => {
        throw new Error("nope");
      },
      createAdapter: () => makeFakeAdapter(),
      maxQueuedEvents: 5,
    });

    const pending = runtime.initialize();
    runtime.handleEvent(makeEvent());
    await pending;

    expect(runtime.getDiagnostics().replayedEventCount).toBe(0);
  });

  it("recovers on a later refresh", async () => {
    const adapter = makeFakeAdapter();
    let shouldFail = true;
    const runtime = new TrackingRuntime({
      loadConfigs: async () => {
        if (shouldFail) throw new Error("temporary");
        return [makeConfig()];
      },
      createAdapter: () => adapter,
    });

    await runtime.initialize();
    expect(runtime.getDiagnostics().phase).toBe("config-failed");

    shouldFail = false;
    await runtime.refresh();

    expect(runtime.getDiagnostics().phase).toBe("ready");
    expect(runtime.getDiagnostics().activeConfigCount).toBe(1);
  });
});

describe("TrackingRuntime — configuration changes", () => {
  it("does not re-create an adapter for an unchanged config", async () => {
    const adapter = makeFakeAdapter();
    const createAdapter = vi.fn(() => adapter);
    const runtime = new TrackingRuntime({
      loadConfigs: async () => [makeConfig()],
      createAdapter,
    });

    await runtime.initialize();
    await runtime.refresh();
    await runtime.refresh();

    expect(createAdapter).toHaveBeenCalledTimes(1);
    expect(adapter.destroyCount).toBe(0);
  });

  it("starts an adapter for a newly added configuration", async () => {
    const meta = makeFakeAdapter(PixelPlatform.META);
    const tiktok = makeFakeAdapter(PixelPlatform.TIKTOK);
    let configs = [makeConfig()];
    const runtime = new TrackingRuntime({
      loadConfigs: async () => configs,
      createAdapter: (platform) =>
        platform === PixelPlatform.TIKTOK ? tiktok : meta,
    });

    await runtime.initialize();
    configs = [
      makeConfig(),
      makeConfig({
        id: "cfg-tiktok",
        platform: PixelPlatform.TIKTOK,
        pixelId: "C1",
      }),
    ];
    await runtime.refresh();

    expect(runtime.getDiagnostics().activeConfigCount).toBe(2);
    expect(tiktok.initCount).toBe(1);
  });

  it("destroys an adapter whose configuration was removed or disabled", async () => {
    const adapter = makeFakeAdapter();
    let configs = [makeConfig()];
    const runtime = new TrackingRuntime({
      loadConfigs: async () => configs,
      createAdapter: () => adapter,
    });

    await runtime.initialize();
    configs = [makeConfig({ enabled: false })];
    await runtime.refresh();

    expect(adapter.destroyCount).toBe(1);
    expect(runtime.getDiagnostics().activeConfigCount).toBe(0);
  });

  it("ignores configurations with client-side tracking turned off", async () => {
    const createAdapter = vi.fn(() => makeFakeAdapter());
    const runtime = new TrackingRuntime({
      loadConfigs: async () => [makeConfig({ enableClientSide: false })],
      createAdapter,
    });

    await runtime.initialize();

    expect(createAdapter).not.toHaveBeenCalled();
  });
});

describe("TrackingRuntime — page views", () => {
  it("sends the initial page view exactly once through the adapters", async () => {
    const adapter = makeFakeAdapter();
    const runtime = new TrackingRuntime({
      loadConfigs: async () => [makeConfig()],
      createAdapter: () => adapter,
    });

    await runtime.initialize();
    runtime.handleEvent(
      makeEvent({ eventId: "pv-1", eventName: TrackingEventName.PAGE_VIEWED }),
    );

    const pageViews = adapter.events.filter(
      (e) => e.eventName === TrackingEventName.PAGE_VIEWED,
    );
    expect(pageViews).toHaveLength(1);
  });

  it("does not duplicate the page view when configs are refreshed", async () => {
    const adapter = makeFakeAdapter();
    const runtime = new TrackingRuntime({
      loadConfigs: async () => [makeConfig()],
      createAdapter: () => adapter,
    });

    await runtime.initialize();
    runtime.handleEvent(
      makeEvent({ eventId: "pv-1", eventName: TrackingEventName.PAGE_VIEWED }),
    );
    await runtime.refresh();

    // Re-initialization must not synthesize a second page view, and the
    // adapter must not be re-created (which is where the old code fired one).
    expect(
      adapter.events.filter(
        (e) => e.eventName === TrackingEventName.PAGE_VIEWED,
      ),
    ).toHaveLength(1);
    expect(adapter.initCount).toBe(2);
  });

  it("passes each client-side navigation page view through with its own id", async () => {
    const adapter = makeFakeAdapter();
    const runtime = new TrackingRuntime({
      loadConfigs: async () => [makeConfig()],
      createAdapter: () => adapter,
    });

    await runtime.initialize();
    runtime.handleEvent(
      makeEvent({ eventId: "pv-1", eventName: TrackingEventName.PAGE_VIEWED }),
    );
    runtime.handleEvent(
      makeEvent({ eventId: "pv-2", eventName: TrackingEventName.PAGE_VIEWED }),
    );

    expect(
      adapter.events
        .filter((e) => e.eventName === TrackingEventName.PAGE_VIEWED)
        .map((e) => e.eventId),
    ).toEqual(["pv-1", "pv-2"]);
  });
});

describe("TrackingRuntime — consent", () => {
  const acceptAll: ConsentState = {
    given: true,
    categories: { functional: true, analytics: true, marketing: true },
    method: "banner_accept",
    expiresAt: null,
  };
  const rejectAll: ConsentState = {
    given: true,
    categories: { functional: true, analytics: false, marketing: false },
    method: "banner_reject",
    expiresAt: null,
  };

  it("runs configurations that do not require consent", () => {
    expect(isConfigAllowedByConsent(makeConfig(), null)).toBe(true);
  });

  it("holds back a consent-required config until consent is known", () => {
    const config = makeConfig({
      consentRequired: true,
      consentCategory: "marketing",
    });
    expect(isConfigAllowedByConsent(config, null)).toBe(false);
    expect(isConfigAllowedByConsent(config, rejectAll)).toBe(false);
    expect(isConfigAllowedByConsent(config, acceptAll)).toBe(true);
  });

  it("matches the analytics category independently of marketing", () => {
    const config = makeConfig({
      consentRequired: true,
      consentCategory: "analytics",
    });
    const analyticsOnly: ConsentState = {
      given: true,
      categories: { functional: true, analytics: true, marketing: false },
      method: "settings_page",
      expiresAt: null,
    };
    expect(isConfigAllowedByConsent(config, analyticsOnly)).toBe(true);
  });

  it("requires an explicit decision when no category is set", () => {
    const config = makeConfig({
      consentRequired: true,
      consentCategory: null,
    });
    expect(isConfigAllowedByConsent(config, null)).toBe(false);
    expect(isConfigAllowedByConsent(config, acceptAll)).toBe(true);
  });

  it("does not initialize a blocked pixel and reports it as blocked", async () => {
    const createAdapter = vi.fn(() => makeFakeAdapter());
    const runtime = new TrackingRuntime({
      loadConfigs: async () => [
        makeConfig({ consentRequired: true, consentCategory: "marketing" }),
      ],
      createAdapter,
    });

    await runtime.initialize();

    expect(createAdapter).not.toHaveBeenCalled();
    expect(runtime.getDiagnostics().consentBlockedConfigIds).toEqual([
      "cfg-meta",
    ]);
  });

  it("starts the pixel once consent is granted", async () => {
    const adapter = makeFakeAdapter();
    const runtime = new TrackingRuntime({
      loadConfigs: async () => [
        makeConfig({ consentRequired: true, consentCategory: "marketing" }),
      ],
      createAdapter: () => adapter,
    });

    await runtime.initialize();
    expect(runtime.getDiagnostics().activeConfigCount).toBe(0);

    runtime.setConsent(acceptAll);

    expect(runtime.getDiagnostics().activeConfigCount).toBe(1);
    expect(adapter.initCount).toBe(1);
  });

  it("stops the pixel when consent is withdrawn", async () => {
    const adapter = makeFakeAdapter();
    const runtime = new TrackingRuntime({
      loadConfigs: async () => [
        makeConfig({ consentRequired: true, consentCategory: "marketing" }),
      ],
      createAdapter: () => adapter,
    });

    await runtime.initialize();
    runtime.setConsent(acceptAll);
    runtime.setConsent(rejectAll);

    expect(adapter.destroyCount).toBe(1);
    expect(runtime.getDiagnostics().activeConfigCount).toBe(0);
  });

  it("does not deliver events to a consent-blocked pixel", async () => {
    const adapter = makeFakeAdapter();
    const runtime = new TrackingRuntime({
      loadConfigs: async () => [
        makeConfig({ consentRequired: true, consentCategory: "marketing" }),
      ],
      createAdapter: () => adapter,
    });

    await runtime.initialize();
    runtime.handleEvent(makeEvent());

    expect(adapter.events).toHaveLength(0);
  });
});

describe("TrackingRuntime — per-configuration dispatch", () => {
  it("sends a test event only to the selected configuration", async () => {
    const meta = makeFakeAdapter(PixelPlatform.META);
    const tiktok = makeFakeAdapter(PixelPlatform.TIKTOK);
    const runtime = new TrackingRuntime({
      loadConfigs: async () => [
        makeConfig(),
        makeConfig({
          id: "cfg-tiktok",
          platform: PixelPlatform.TIKTOK,
          pixelId: "C1",
        }),
      ],
      createAdapter: (platform) =>
        platform === PixelPlatform.TIKTOK ? tiktok : meta,
    });

    await runtime.initialize();
    const dispatched = runtime.dispatchToConfig(
      "cfg-tiktok",
      makeEvent({ eventId: "test-1" }),
    );

    expect(dispatched).toBe(true);
    expect(tiktok.events.map((e) => e.eventId)).toEqual(["test-1"]);
    expect(meta.events).toHaveLength(0);
  });

  it("reports false for a configuration with no running adapter", async () => {
    const runtime = new TrackingRuntime({
      loadConfigs: async () => [],
      createAdapter: () => makeFakeAdapter(),
    });

    await runtime.initialize();

    expect(runtime.dispatchToConfig("cfg-missing", makeEvent())).toBe(false);
  });
});

describe("TrackingRuntime — teardown", () => {
  it("destroys adapters and stops accepting events", async () => {
    const adapter = makeFakeAdapter();
    const runtime = new TrackingRuntime({
      loadConfigs: async () => [makeConfig()],
      createAdapter: () => adapter,
    });

    await runtime.initialize();
    runtime.destroy();
    runtime.handleEvent(makeEvent({ eventId: "after-destroy" }));

    expect(adapter.destroyCount).toBe(1);
    expect(adapter.events).toHaveLength(0);
  });
});
