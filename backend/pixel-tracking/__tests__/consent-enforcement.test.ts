import { describe, it, expect, vi } from "vitest";
import {
  isConfigAllowedByConsent,
  parseConsentCookieValue,
  CONSENT_COOKIE,
} from "#root/shared/utils/consent-gate";
import {
  CONSENT_COOKIE_NAME,
  serializeConsentCookie,
  buildAcceptAllConsent,
  buildRejectAllConsent,
  getDefaultConsentState,
} from "#root/backend/pixel-tracking/consent/service";
import { extractServerContext } from "#root/server/routes/track";
import { processTrackingBeacon } from "#root/backend/pixel-tracking/delivery-pipeline";
import {
  PixelPlatform,
  TrackingEventName,
  type ConsentState,
  type PixelConfig,
  type TrackingEvent,
} from "#root/shared/types/pixel-tracking";
import type { DatabaseClient } from "#root/shared/database/drizzle/db";
import type { ServerContext } from "#root/server/routes/track";
import { metaCapiAdapter } from "#root/backend/pixel-tracking/server-adapters/meta-capi-adapter";

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeConfig = (overrides?: Partial<PixelConfig>): PixelConfig => ({
  id: "cfg-meta",
  platform: PixelPlatform.META,
  pixelId: "PIXEL123",
  accessToken: "tok",
  enabled: true,
  enableClientSide: true,
  enableServerSide: true,
  consentRequired: false,
  consentCategory: null,
  settings: null,
  createdAt: new Date(),
  updatedAt: null,
  ...overrides,
});

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

/** Minimal drizzle fake: one inserted event, a fixed server config list. */
function makeFakeDb(configs: PixelConfig[]) {
  const deliveries: Record<string, unknown>[] = [];
  const db = {
    insert(table: Record<string, unknown>) {
      const isDelivery = "skippedReason" in table;
      return {
        values(rows: Record<string, unknown> | Record<string, unknown>[]) {
          const list = Array.isArray(rows) ? rows : [rows];
          if (isDelivery) {
            deliveries.push(...list);
            return Promise.resolve(undefined);
          }
          return {
            onConflictDoNothing: () => ({
              returning: () =>
                Promise.resolve(
                  list.map((r) => ({
                    id: `db-${r.eventId}`,
                    eventId: r.eventId,
                  })),
                ),
            }),
          };
        },
      };
    },
    select: () => ({
      from: () => ({
        where: () => ({ execute: () => Promise.resolve(configs) }),
      }),
    }),
  } as unknown as DatabaseClient;
  return { db, deliveries };
}

const makeEvent = (): TrackingEvent => ({
  eventId: "evt-1",
  eventName: TrackingEventName.PRODUCT_ADDED_TO_CART,
  timestamp: Date.now(),
  pageUrl: "https://shop.test/p/1",
  sessionId: "sess-1",
});

const makeServerContext = (
  consent: ConsentState | null,
): ServerContext => ({
  ip: "1.2.3.4",
  ipHash: "hash",
  userAgent: "Mozilla/5.0",
  consent,
});

// ─── The decision function is shared, not duplicated ────────────────────────

describe("consent gate — shared decision", () => {
  it("is the same function the browser runtime uses", async () => {
    const runtime = await import("#root/frontend/tracking/tracking-runtime");
    // Two copies of this rule would drift silently: the banner would look
    // compliant while the Conversions API kept relaying.
    expect(runtime.isConfigAllowedByConsent).toBe(isConfigAllowedByConsent);
  });

  it("uses the same cookie name as the writer", () => {
    expect(CONSENT_COOKIE).toBe(CONSENT_COOKIE_NAME);
  });

  it("allows a configuration that does not require consent", () => {
    expect(isConfigAllowedByConsent(makeConfig(), null)).toBe(true);
    expect(isConfigAllowedByConsent(makeConfig(), rejectAll)).toBe(true);
  });

  it("blocks a consent-required configuration with no decision", () => {
    const config = makeConfig({
      consentRequired: true,
      consentCategory: "marketing",
    });
    expect(isConfigAllowedByConsent(config, null)).toBe(false);
  });

  it("does not treat the default state as acceptance", () => {
    const config = makeConfig({
      consentRequired: true,
      consentCategory: "marketing",
    });
    expect(isConfigAllowedByConsent(config, getDefaultConsentState())).toBe(
      false,
    );
  });

  it("follows the granted category", () => {
    const marketing = makeConfig({
      consentRequired: true,
      consentCategory: "marketing",
    });
    const analytics = makeConfig({
      consentRequired: true,
      consentCategory: "analytics",
    });
    const analyticsOnly: ConsentState = {
      given: true,
      categories: { functional: true, analytics: true, marketing: false },
      method: "settings_page",
      expiresAt: null,
    };

    expect(isConfigAllowedByConsent(marketing, acceptAll)).toBe(true);
    expect(isConfigAllowedByConsent(marketing, analyticsOnly)).toBe(false);
    expect(isConfigAllowedByConsent(analytics, analyticsOnly)).toBe(true);
  });
});

// ─── Cookie round-trip: the writer and the reader must agree ────────────────

describe("consent cookie round-trip", () => {
  it("reads back what the browser wrote for accept-all", () => {
    const written = serializeConsentCookie(buildAcceptAllConsent("banner_accept"));
    const parsed = parseConsentCookieValue(written);

    expect(parsed?.given).toBe(true);
    expect(parsed?.categories.marketing).toBe(true);
    expect(parsed?.categories.analytics).toBe(true);
  });

  it("reads back what the browser wrote for reject-all", () => {
    const written = serializeConsentCookie(buildRejectAllConsent("banner_reject"));
    const parsed = parseConsentCookieValue(written);

    expect(parsed?.given).toBe(true);
    expect(parsed?.categories.marketing).toBe(false);
    expect(parsed?.categories.analytics).toBe(false);
  });

  it("survives URL encoding, as the cookie is stored encoded", () => {
    const written = encodeURIComponent(
      serializeConsentCookie(buildAcceptAllConsent("banner_accept")),
    );
    expect(parseConsentCookieValue(written)?.categories.marketing).toBe(true);
  });

  it("treats an expired decision as no decision", () => {
    const expired = serializeConsentCookie({
      given: true,
      categories: { functional: true, analytics: true, marketing: true },
      method: "banner_accept",
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(parseConsentCookieValue(expired)).toBeNull();
  });

  it("treats a missing or malformed cookie as no decision", () => {
    expect(parseConsentCookieValue(undefined)).toBeNull();
    expect(parseConsentCookieValue("")).toBeNull();
    expect(parseConsentCookieValue("not json")).toBeNull();
  });
});

// ─── The beacon endpoint reads the decision ─────────────────────────────────

describe("beacon endpoint — consent extraction", () => {
  const baseRequest = (cookies: Record<string, string>) => ({
    ip: "1.2.3.4",
    headers: { "user-agent": "Mozilla/5.0" } as Record<string, string>,
    cookies,
  });

  it("carries the visitor's decision into the server context", () => {
    const cookie = serializeConsentCookie(buildAcceptAllConsent("banner_accept"));
    const ctx = extractServerContext(
      baseRequest({ [CONSENT_COOKIE_NAME]: cookie }),
    );

    expect(ctx.consent?.categories.marketing).toBe(true);
  });

  it("reports no decision when the cookie is absent", () => {
    const ctx = extractServerContext(baseRequest({}));
    expect(ctx.consent).toBeNull();
  });
});

// ─── Server delivery honours the same decision ──────────────────────────────

describe("server delivery — consent enforcement", () => {
  const consentedConfig = makeConfig({
    consentRequired: true,
    consentCategory: "marketing",
  });

  async function runBeacon(
    configs: PixelConfig[],
    consent: ConsentState | null,
  ) {
    const sent: string[][] = [];
    const spy = vi
      .spyOn(metaCapiAdapter, "sendEvents")
      .mockImplementation(async (events) => {
        sent.push(events.map((e) => e.eventId));
        return {
          platform: PixelPlatform.META,
          configId: "cfg-meta",
          success: true,
          statusCode: 200,
          acceptedCount: events.length,
          attempts: 1,
        };
      });
    const { db, deliveries } = makeFakeDb(configs);
    await processTrackingBeacon(
      [makeEvent()],
      makeServerContext(consent),
      db,
    );
    spy.mockRestore();
    return { sent, deliveries };
  }

  it("does not relay to a consent-required pixel when consent was rejected", async () => {
    const { sent, deliveries } = await runBeacon([consentedConfig], rejectAll);

    // The whole point: gating only the browser would let the Conversions API
    // keep sending the same conversions the visitor just declined.
    expect(sent).toHaveLength(0);
    expect(deliveries).toHaveLength(0);
  });

  it("does not relay when no decision has been made", async () => {
    const { sent } = await runBeacon([consentedConfig], null);
    expect(sent).toHaveLength(0);
  });

  it("relays once consent is granted", async () => {
    const { sent, deliveries } = await runBeacon([consentedConfig], acceptAll);

    expect(sent).toEqual([["evt-1"]]);
    expect(deliveries).toHaveLength(1);
  });

  it("still relays configurations that do not require consent", async () => {
    const { sent } = await runBeacon([makeConfig()], rejectAll);
    expect(sent).toEqual([["evt-1"]]);
  });

  it("blocks only the consent-required configuration in a mixed set", async () => {
    const spy = vi
      .spyOn(metaCapiAdapter, "sendEvents")
      .mockResolvedValue({
        platform: PixelPlatform.META,
        success: true,
        statusCode: 200,
        acceptedCount: 1,
        attempts: 1,
      });
    const { db } = makeFakeDb([
      makeConfig({ id: "free" }),
      makeConfig({
        id: "gated",
        consentRequired: true,
        consentCategory: "marketing",
      }),
    ]);

    await processTrackingBeacon(
      [makeEvent()],
      makeServerContext(rejectAll),
      db,
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1]!.id).toBe("free");
    spy.mockRestore();
  });
});
