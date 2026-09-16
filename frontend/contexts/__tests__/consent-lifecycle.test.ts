import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readConsentCookie } from "#root/frontend/contexts/TrackingContext";
import { TrackingRuntime } from "#root/frontend/tracking/tracking-runtime";
import { CONSENT_COOKIE } from "#root/shared/utils/consent-gate";
import {
  serializeConsentCookie,
  buildAcceptAllConsent,
  buildRejectAllConsent,
  getDefaultConsentState,
} from "#root/backend/pixel-tracking/consent/service";
import type { PixelAdapter } from "#root/frontend/pixel-adapters/types";
import {
  PixelPlatform,
  TrackingEventName,
  type PixelConfig,
  type TrackingEvent,
} from "#root/shared/types/pixel-tracking";

// ─── Helpers ────────────────────────────────────────────────────────────────

function setCookie(value: string | null): void {
  const doc = (globalThis as Record<string, unknown>).document as {
    cookie: string;
  };
  doc.cookie = value === null ? "" : `${CONSENT_COOKIE}=${encodeURIComponent(value)}`;
}

function makeConfig(overrides?: Partial<PixelConfig>): PixelConfig {
  return {
    id: "cfg-marketing",
    platform: PixelPlatform.META,
    pixelId: "PIXEL-1",
    accessToken: null,
    enabled: true,
    enableClientSide: true,
    enableServerSide: false,
    consentRequired: true,
    consentCategory: "marketing",
    settings: null,
    createdAt: new Date(),
    updatedAt: null,
    ...overrides,
  };
}

const makeEvent = (eventId = "evt-1"): TrackingEvent => ({
  eventId,
  eventName: TrackingEventName.PRODUCT_ADDED_TO_CART,
  timestamp: Date.now(),
  pageUrl: "https://shop.test/p/1",
  sessionId: "sess-1",
});

interface FakeAdapter extends PixelAdapter {
  events: TrackingEvent[];
  initCount: number;
  destroyCount: number;
}

function makeFakeAdapter(): FakeAdapter {
  const adapter: FakeAdapter = {
    platform: PixelPlatform.META,
    configId: undefined,
    events: [],
    initCount: 0,
    destroyCount: 0,
    initialize(config) {
      adapter.initCount += 1;
      (adapter as { configId?: string }).configId = config.id;
      (adapter as { off?: boolean }).off = false;
    },
    destroy() {
      adapter.destroyCount += 1;
      (adapter as { off?: boolean }).off = true;
    },
    trackEvent(event) {
      adapter.events.push(event);
    },
    isLoaded: () => true,
    isEnabled: () => (adapter as { off?: boolean }).off !== true,
    canAcceptEvents: () => (adapter as { off?: boolean }).off !== true,
  };
  return adapter;
}

// ─── Reload persistence ─────────────────────────────────────────────────────

describe("consent decision persists across a reload", () => {
  let previousDocument: unknown;

  beforeEach(() => {
    previousDocument = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).document = { cookie: "" };
  });

  afterEach(() => {
    if (previousDocument === undefined) {
      delete (globalThis as Record<string, unknown>).document;
    } else {
      (globalThis as Record<string, unknown>).document = previousDocument;
    }
  });

  it("reads back an acceptance written by the banner", () => {
    setCookie(serializeConsentCookie(buildAcceptAllConsent("banner_accept")));

    const restored = readConsentCookie();
    expect(restored?.given).toBe(true);
    expect(restored?.categories.marketing).toBe(true);
  });

  it("reads back a rejection written by the banner", () => {
    setCookie(serializeConsentCookie(buildRejectAllConsent("banner_reject")));

    const restored = readConsentCookie();
    // A rejection is a decision: the banner must not re-ask, and the pixel
    // must stay off.
    expect(restored?.given).toBe(true);
    expect(restored?.categories.marketing).toBe(false);
  });

  it("reads back a partial (analytics-only) decision", () => {
    setCookie(
      serializeConsentCookie({
        given: true,
        categories: { functional: true, analytics: true, marketing: false },
        method: "settings_page",
        expiresAt: null,
      }),
    );

    const restored = readConsentCookie();
    expect(restored?.categories.analytics).toBe(true);
    expect(restored?.categories.marketing).toBe(false);
  });

  it("returns no decision when nothing was stored", () => {
    setCookie(null);
    expect(readConsentCookie()).toBeNull();
  });

  it("returns no decision when the stored one expired", () => {
    setCookie(
      serializeConsentCookie({
        ...buildAcceptAllConsent("banner_accept"),
        expiresAt: new Date(Date.now() - 60_000),
      }),
    );
    expect(readConsentCookie()).toBeNull();
  });

  it("does not read a default (undecided) state as acceptance", () => {
    setCookie(serializeConsentCookie(getDefaultConsentState()));
    expect(readConsentCookie()?.given).toBe(false);
  });
});

// ─── Runtime lifecycle: accept → reject → accept again ──────────────────────

describe("consent lifecycle drives the browser pixels", () => {
  async function makeRuntime(adapter: FakeAdapter, config = makeConfig()) {
    const runtime = new TrackingRuntime({
      loadConfigs: async () => [config],
      createAdapter: () => adapter,
    });
    return runtime;
  }

  it("does not load the pixel before a decision is made", async () => {
    const adapter = makeFakeAdapter();
    const runtime = await makeRuntime(adapter);

    await runtime.initialize();

    expect(adapter.initCount).toBe(0);
    expect(runtime.getDiagnostics().consentBlockedConfigIds).toEqual([
      "cfg-marketing",
    ]);
  });

  it("loads the pixel on acceptance", async () => {
    const adapter = makeFakeAdapter();
    const runtime = await makeRuntime(adapter);
    await runtime.initialize();

    runtime.setConsent(buildAcceptAllConsent("banner_accept"));

    expect(adapter.initCount).toBe(1);
    runtime.handleEvent(makeEvent("after-accept"));
    expect(adapter.events.map((e) => e.eventId)).toEqual(["after-accept"]);
  });

  it("keeps the pixel off on rejection", async () => {
    const adapter = makeFakeAdapter();
    const runtime = await makeRuntime(adapter);
    await runtime.initialize();

    runtime.setConsent(buildRejectAllConsent("banner_reject"));

    expect(adapter.initCount).toBe(0);
    runtime.handleEvent(makeEvent("after-reject"));
    expect(adapter.events).toHaveLength(0);
  });

  it("tears the pixel down when consent is withdrawn", async () => {
    const adapter = makeFakeAdapter();
    const runtime = await makeRuntime(adapter);
    await runtime.initialize();

    runtime.setConsent(buildAcceptAllConsent("banner_accept"));
    runtime.handleEvent(makeEvent("while-granted"));

    runtime.setConsent(buildRejectAllConsent("banner_reject"));
    runtime.handleEvent(makeEvent("after-withdrawal"));

    expect(adapter.destroyCount).toBe(1);
    expect(adapter.events.map((e) => e.eventId)).toEqual(["while-granted"]);
    expect(runtime.getDiagnostics().activeConfigCount).toBe(0);
  });

  it("can be granted again after a withdrawal", async () => {
    const adapter = makeFakeAdapter();
    const runtime = await makeRuntime(adapter);
    await runtime.initialize();

    runtime.setConsent(buildAcceptAllConsent("banner_accept"));
    runtime.setConsent(buildRejectAllConsent("banner_reject"));
    runtime.setConsent(buildAcceptAllConsent("settings_page"));

    runtime.handleEvent(makeEvent("after-regrant"));
    expect(adapter.events.map((e) => e.eventId)).toEqual(["after-regrant"]);
  });

  it("restores a stored decision on the next page load", async () => {
    const previousDocument = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).document = { cookie: "" };
    setCookie(serializeConsentCookie(buildAcceptAllConsent("banner_accept")));

    const adapter = makeFakeAdapter();
    const runtime = await makeRuntime(adapter);
    // This is what TrackingProvider does on mount.
    runtime.setConsent(readConsentCookie());
    await runtime.initialize();

    expect(adapter.initCount).toBe(1);

    if (previousDocument === undefined) {
      delete (globalThis as Record<string, unknown>).document;
    } else {
      (globalThis as Record<string, unknown>).document = previousDocument;
    }
  });

  it("an analytics-only decision does not start a marketing pixel", async () => {
    const adapter = makeFakeAdapter();
    const runtime = await makeRuntime(adapter);
    await runtime.initialize();

    runtime.setConsent({
      given: true,
      categories: { functional: true, analytics: true, marketing: false },
      method: "settings_page",
      expiresAt: null,
    });

    expect(adapter.initCount).toBe(0);
  });

  it("leaves a pixel that does not require consent running throughout", async () => {
    const adapter = makeFakeAdapter();
    const runtime = await makeRuntime(
      adapter,
      makeConfig({ consentRequired: false, consentCategory: null }),
    );
    await runtime.initialize();

    expect(adapter.initCount).toBe(1);
    runtime.setConsent(buildRejectAllConsent("banner_reject"));

    expect(adapter.destroyCount).toBe(0);
    runtime.handleEvent(makeEvent("ungated"));
    expect(adapter.events.map((e) => e.eventId)).toEqual(["ungated"]);
  });
});
