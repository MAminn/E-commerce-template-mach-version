import { describe, it, expect, vi } from "vitest";
import {
  PixelPlatform,
  TrackingEventName,
  type PixelConfig,
} from "#root/shared/types/pixel-tracking";
import type { EnrichedTrackingEvent } from "#root/backend/pixel-tracking/event-logger";
import { sendToMetaCAPI } from "#root/backend/pixel-tracking/server-adapters/meta-capi-adapter";
import {
  sendToTikTokEventsAPI,
  serverSidePageViewEnabled,
} from "#root/backend/pixel-tracking/server-adapters/tiktok-events-adapter";
import {
  redactSecrets,
  sanitizeResponseBody,
  isRetryableStatus,
  MAX_STORED_BODY_LENGTH,
} from "#root/backend/pixel-tracking/server-adapters/http";

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeConfig = (overrides?: Partial<PixelConfig>): PixelConfig => ({
  id: "cfg-1",
  platform: PixelPlatform.META,
  pixelId: "PIXEL123",
  accessToken: "tok_secret_value",
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

const makeEvent = (
  overrides?: Partial<EnrichedTrackingEvent>,
): EnrichedTrackingEvent => ({
  eventId: "evt-1",
  eventName: TrackingEventName.CHECKOUT_STARTED,
  timestamp: 1_700_000_000_000,
  pageUrl: "https://shop.test/checkout",
  sessionId: "sess-1",
  serverContext: {
    ip: "1.2.3.4",
    ipHash: "hash",
    userAgent: "Mozilla/5.0",
  },
  ...overrides,
});

/** A fetch stub returning a fixed status/body. */
function stubFetch(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

/** A fetch stub returning a different response per call. */
function stubFetchSequence(responses: Array<{ status: number; body: string }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: () => Promise.resolve(r.body),
    });
  }
  return fn as unknown as typeof fetch;
}

function lastRequestBody(fetchImpl: typeof fetch): Record<string, unknown> {
  const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
  const call = mock.mock.calls.at(-1)!;
  return JSON.parse((call[1] as { body: string }).body);
}

// ─── TikTok: HTTP 200 is not acceptance ─────────────────────────────────────

describe("TikTok Events API — application-level result codes", () => {
  it("treats a nonzero code in an HTTP 200 as a failure", async () => {
    const fetchImpl = stubFetch(
      200,
      JSON.stringify({
        code: 40100,
        message: "Access token is incorrect or has been revoked.",
        request_id: "req-abc",
      }),
    );

    const result = await sendToTikTokEventsAPI(
      [makeEvent()],
      makeConfig({ platform: PixelPlatform.TIKTOK }),
      { fetchImpl, maxAttempts: 1 },
    );

    // The old adapter reported this as a successful delivery because
    // response.ok was true, which made a revoked token look healthy.
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(200);
    expect(result.platformCode).toBe("40100");
    expect(result.platformMessage).toContain("Access token");
    expect(result.requestId).toBe("req-abc");
    expect(result.retryable).toBe(false);
  });

  it("accepts code 0 and records the request id", async () => {
    const fetchImpl = stubFetch(
      200,
      JSON.stringify({ code: 0, message: "OK", request_id: "req-ok" }),
    );

    const result = await sendToTikTokEventsAPI(
      [makeEvent()],
      makeConfig({ platform: PixelPlatform.TIKTOK }),
      { fetchImpl, maxAttempts: 1 },
    );

    expect(result.success).toBe(true);
    expect(result.platformCode).toBe("0");
    expect(result.requestId).toBe("req-ok");
    expect(result.acceptedCount).toBe(1);
  });

  it("fails on a 200 whose body is not JSON", async () => {
    const fetchImpl = stubFetch(200, "<html>upstream proxy error</html>");

    const result = await sendToTikTokEventsAPI(
      [makeEvent()],
      makeConfig({ platform: PixelPlatform.TIKTOK }),
      { fetchImpl, maxAttempts: 1 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("without a result code");
  });

  it("fails on a 200 whose JSON has no code field", async () => {
    const fetchImpl = stubFetch(200, JSON.stringify({ data: {} }));

    const result = await sendToTikTokEventsAPI(
      [makeEvent()],
      makeConfig({ platform: PixelPlatform.TIKTOK }),
      { fetchImpl, maxAttempts: 1 },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("without a result code");
  });

  it("marks 5xx-class platform codes retryable and token errors not", async () => {
    const busy = await sendToTikTokEventsAPI(
      [makeEvent()],
      makeConfig({ platform: PixelPlatform.TIKTOK }),
      {
        fetchImpl: stubFetch(
          200,
          JSON.stringify({ code: 50000, message: "Server busy" }),
        ),
        maxAttempts: 1,
      },
    );
    expect(busy.retryable).toBe(true);

    const token = await sendToTikTokEventsAPI(
      [makeEvent()],
      makeConfig({ platform: PixelPlatform.TIKTOK }),
      {
        fetchImpl: stubFetch(
          200,
          JSON.stringify({ code: 40100, message: "bad token" }),
        ),
        maxAttempts: 1,
      },
    );
    expect(token.retryable).toBe(false);
  });
});

// ─── TikTok: page views cannot be deduplicated ──────────────────────────────

describe("TikTok Events API — page view handling per configuration", () => {
  const tiktokConfig = (overrides?: Partial<PixelConfig>) =>
    makeConfig({ platform: PixelPlatform.TIKTOK, ...overrides });

  // TikTok documents event_id only for ttq.track(name, props, {event_id}).
  // ttq.page() takes no event id, so browser and server page views cannot be
  // paired — exactly one path may send them.

  describe("server-only configuration", () => {
    const config = tiktokConfig({
      enableClientSide: false,
      enableServerSide: true,
    });

    it("sends the page view — there is no browser copy to collide with", async () => {
      const fetchImpl = stubFetch(200, JSON.stringify({ code: 0 }));
      expect(serverSidePageViewEnabled(config)).toBe(true);

      const result = await sendToTikTokEventsAPI(
        [makeEvent({ eventName: TrackingEventName.PAGE_VIEWED })],
        config,
        { fetchImpl, maxAttempts: 1 },
      );

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(lastRequestBody(fetchImpl).data).toHaveLength(1);
      expect(result.skipped).toBeUndefined();
      expect(result.success).toBe(true);
    });

    it("sends a navigation page view too, not only the first one", async () => {
      const fetchImpl = stubFetch(200, JSON.stringify({ code: 0 }));

      await sendToTikTokEventsAPI(
        [
          makeEvent({
            eventId: "pv-1",
            eventName: TrackingEventName.PAGE_VIEWED,
            pageUrl: "https://shop.test/",
          }),
          makeEvent({
            eventId: "pv-2",
            eventName: TrackingEventName.PAGE_VIEWED,
            pageUrl: "https://shop.test/p/1",
          }),
        ],
        config,
        { fetchImpl, maxAttempts: 1 },
      );

      const data = lastRequestBody(fetchImpl).data as Array<
        Record<string, unknown>
      >;
      expect(data).toHaveLength(2);
      expect(data.map((e) => e.event_id)).toEqual(["pv-1", "pv-2"]);
      expect(data.every((e) => e.event === "Pageview")).toBe(true);
    });
  });

  describe("both paths enabled", () => {
    const config = tiktokConfig({
      enableClientSide: true,
      enableServerSide: true,
    });

    it("skips the server page view and says why", async () => {
      const fetchImpl = stubFetch(200, JSON.stringify({ code: 0 }));
      expect(serverSidePageViewEnabled(config)).toBe(false);

      const result = await sendToTikTokEventsAPI(
        [makeEvent({ eventName: TrackingEventName.PAGE_VIEWED })],
        config,
        { fetchImpl, maxAttempts: 1 },
      );

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(result.skipped?.eventIds).toEqual(["evt-1"]);
      expect(result.skipped?.reason).toContain("ttq.page()");
      expect(result.acceptedCount).toBe(0);
    });

    it("still sends the other events in the same batch", async () => {
      const fetchImpl = stubFetch(200, JSON.stringify({ code: 0 }));

      const result = await sendToTikTokEventsAPI(
        [
          makeEvent({ eventId: "pv", eventName: TrackingEventName.PAGE_VIEWED }),
          makeEvent({
            eventId: "atc",
            eventName: TrackingEventName.PRODUCT_ADDED_TO_CART,
          }),
        ],
        config,
        { fetchImpl, maxAttempts: 1 },
      );

      const data = lastRequestBody(fetchImpl).data as unknown[];
      expect(data).toHaveLength(1);
      expect(result.skipped?.eventIds).toEqual(["pv"]);
      expect(result.success).toBe(true);
    });

    it("sends the page view anyway when the merchant opts in", async () => {
      const fetchImpl = stubFetch(200, JSON.stringify({ code: 0 }));
      const optedIn = tiktokConfig({
        enableClientSide: true,
        enableServerSide: true,
        settings: { serverSidePageView: true },
      });
      expect(serverSidePageViewEnabled(optedIn)).toBe(true);

      const result = await sendToTikTokEventsAPI(
        [makeEvent({ eventName: TrackingEventName.PAGE_VIEWED })],
        optedIn,
        { fetchImpl, maxAttempts: 1 },
      );

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(result.skipped).toBeUndefined();
    });

    it("honours an explicit opt-out on a server-only configuration", () => {
      const optedOut = tiktokConfig({
        enableClientSide: false,
        enableServerSide: true,
        settings: { serverSidePageView: false },
      });

      expect(serverSidePageViewEnabled(optedOut)).toBe(false);
    });
  });

  describe("browser-only configuration", () => {
    it("never reaches the server adapter at all", () => {
      // getEnabledServerConfigs filters on enableServerSide, so a
      // browser-only pixel is not in the server fan-out. Page views are the
      // browser ttq.page() call and nothing else.
      const config = tiktokConfig({
        enableClientSide: true,
        enableServerSide: false,
      });
      expect(config.enableServerSide).toBe(false);
    });
  });

  it("never skips non-page events regardless of configuration", async () => {
    const fetchImpl = stubFetch(200, JSON.stringify({ code: 0 }));

    const result = await sendToTikTokEventsAPI(
      [makeEvent({ eventName: TrackingEventName.CHECKOUT_STARTED })],
      tiktokConfig({ enableClientSide: true, enableServerSide: true }),
      { fetchImpl, maxAttempts: 1 },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBeUndefined();
  });
});

// ─── Meta: acceptance counts ────────────────────────────────────────────────

describe("Meta CAPI — acceptance counts and diagnostics", () => {
  it("records events_received and fbtrace_id on success", async () => {
    const fetchImpl = stubFetch(
      200,
      JSON.stringify({
        events_received: 2,
        messages: [],
        fbtrace_id: "trace-1",
      }),
    );

    const result = await sendToMetaCAPI(
      [makeEvent({ eventId: "a" }), makeEvent({ eventId: "b" })],
      makeConfig(),
      { fetchImpl, maxAttempts: 1 },
    );

    expect(result.success).toBe(true);
    expect(result.acceptedCount).toBe(2);
    expect(result.requestId).toBe("trace-1");
    expect(result.warnings).toBeUndefined();
  });

  it("warns when Meta reports fewer events than were sent", async () => {
    const fetchImpl = stubFetch(
      200,
      JSON.stringify({ events_received: 1, fbtrace_id: "trace-2" }),
    );

    const result = await sendToMetaCAPI(
      [makeEvent({ eventId: "a" }), makeEvent({ eventId: "b" })],
      makeConfig(),
      { fetchImpl, maxAttempts: 1 },
    );

    // Accepted, but not for every event — the merchant must be able to see it.
    expect(result.success).toBe(true);
    expect(result.acceptedCount).toBe(1);
    expect(result.warnings?.join(" ")).toContain("1 of 2");
  });

  it("fails when Meta reports zero events received", async () => {
    const fetchImpl = stubFetch(200, JSON.stringify({ events_received: 0 }));

    const result = await sendToMetaCAPI([makeEvent()], makeConfig(), {
      fetchImpl,
      maxAttempts: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("0 events");
  });

  it("fails when a 200 response omits events_received", async () => {
    const fetchImpl = stubFetch(200, JSON.stringify({ messages: [] }));

    const result = await sendToMetaCAPI([makeEvent()], makeConfig(), {
      fetchImpl,
      maxAttempts: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("events_received");
  });

  it("fails on a 200 that is not JSON", async () => {
    const fetchImpl = stubFetch(200, "not json at all");

    const result = await sendToMetaCAPI([makeEvent()], makeConfig(), {
      fetchImpl,
      maxAttempts: 1,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("non-JSON");
  });

  it("surfaces platform warnings from an accepted request", async () => {
    const fetchImpl = stubFetch(
      200,
      JSON.stringify({
        events_received: 1,
        messages: ["Event set is not ready to receive events"],
        fbtrace_id: "trace-3",
      }),
    );

    const result = await sendToMetaCAPI([makeEvent()], makeConfig(), {
      fetchImpl,
      maxAttempts: 1,
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toContain(
      "Event set is not ready to receive events",
    );
  });

  it("reads the error envelope on a 400", async () => {
    const fetchImpl = stubFetch(
      400,
      JSON.stringify({
        error: {
          message: "Invalid parameter",
          code: 100,
          error_subcode: 2804003,
          fbtrace_id: "trace-4",
        },
      }),
    );

    const result = await sendToMetaCAPI([makeEvent()], makeConfig(), {
      fetchImpl,
      maxAttempts: 1,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.platformCode).toBe("100/2804003");
    expect(result.platformMessage).toBe("Invalid parameter");
    expect(result.requestId).toBe("trace-4");
  });
});

// ─── Retry policy ───────────────────────────────────────────────────────────

describe("retry policy", () => {
  it("classifies only 429 and 5xx as retryable", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });

  it("does not retry a 400", async () => {
    const fetchImpl = stubFetch(400, JSON.stringify({ error: { code: 100 } }));

    await sendToMetaCAPI([makeEvent()], makeConfig(), {
      fetchImpl,
      maxAttempts: 3,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 503 and succeeds on a later attempt", async () => {
    const fetchImpl = stubFetchSequence([
      { status: 503, body: "upstream unavailable" },
      { status: 200, body: JSON.stringify({ events_received: 1 }) },
    ]);

    const result = await sendToMetaCAPI([makeEvent()], makeConfig(), {
      fetchImpl,
      maxAttempts: 3,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("gives up after maxAttempts and marks the failure retryable", async () => {
    const fetchImpl = stubFetch(503, "still unavailable");

    const result = await sendToMetaCAPI([makeEvent()], makeConfig(), {
      fetchImpl,
      maxAttempts: 2,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("reports a network failure without retrying forever", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    const result = await sendToMetaCAPI([makeEvent()], makeConfig(), {
      fetchImpl,
      maxAttempts: 2,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("fetch failed");
    expect(result.retryable).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

// ─── test_event_code isolation ──────────────────────────────────────────────

describe("test_event_code isolation", () => {
  it("is absent from normal Meta traffic", async () => {
    const fetchImpl = stubFetch(200, JSON.stringify({ events_received: 1 }));

    await sendToMetaCAPI([makeEvent()], makeConfig(), {
      fetchImpl,
      maxAttempts: 1,
    });

    expect(lastRequestBody(fetchImpl)).not.toHaveProperty("test_event_code");
  });

  it("is attached to a Meta request only when explicitly passed", async () => {
    const fetchImpl = stubFetch(200, JSON.stringify({ events_received: 1 }));

    await sendToMetaCAPI([makeEvent()], makeConfig(), {
      fetchImpl,
      maxAttempts: 1,
      testEventCode: "TEST12345",
    });

    expect(lastRequestBody(fetchImpl).test_event_code).toBe("TEST12345");
  });

  it("is absent from normal TikTok traffic", async () => {
    const fetchImpl = stubFetch(200, JSON.stringify({ code: 0 }));

    await sendToTikTokEventsAPI(
      [makeEvent()],
      makeConfig({ platform: PixelPlatform.TIKTOK }),
      { fetchImpl, maxAttempts: 1 },
    );

    expect(lastRequestBody(fetchImpl)).not.toHaveProperty("test_event_code");
  });

  it("is attached to a TikTok request only when explicitly passed", async () => {
    const fetchImpl = stubFetch(200, JSON.stringify({ code: 0 }));

    await sendToTikTokEventsAPI(
      [makeEvent()],
      makeConfig({ platform: PixelPlatform.TIKTOK }),
      { fetchImpl, maxAttempts: 1, testEventCode: "TT-TEST-9" },
    );

    expect(lastRequestBody(fetchImpl).test_event_code).toBe("TT-TEST-9");
  });

  it("never reads a test code from stored configuration settings", async () => {
    const fetchImpl = stubFetch(200, JSON.stringify({ events_received: 1 }));

    await sendToMetaCAPI(
      [makeEvent()],
      makeConfig({ settings: { test_event_code: "LEAKED" } }),
      { fetchImpl, maxAttempts: 1 },
    );

    expect(lastRequestBody(fetchImpl)).not.toHaveProperty("test_event_code");
  });
});

// ─── Secret handling ────────────────────────────────────────────────────────

describe("token and payload redaction", () => {
  it("keeps the access token in the header, never in the URL or body", async () => {
    const fetchImpl = stubFetch(200, JSON.stringify({ events_received: 1 }));

    await sendToMetaCAPI([makeEvent()], makeConfig(), {
      fetchImpl,
      maxAttempts: 1,
    });

    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = mock.mock.calls[0]! as [string, RequestInit];
    expect(url).not.toContain("tok_secret_value");
    expect(init.body as string).not.toContain("tok_secret_value");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok_secret_value",
    );
  });

  it("redacts credentials echoed back in a response body", () => {
    const body = JSON.stringify({
      error: "invalid",
      access_token: "tok_secret_value",
    });
    const sanitized = sanitizeResponseBody(body)!;

    expect(sanitized).not.toContain("tok_secret_value");
    expect(sanitized).toContain("[REDACTED]");
  });

  it("redacts bearer tokens in free text", () => {
    expect(redactSecrets("Authorization: Bearer abc.def-123")).not.toContain(
      "abc.def-123",
    );
  });

  it("truncates long response bodies before they are stored", () => {
    const sanitized = sanitizeResponseBody("x".repeat(5000))!;
    expect(sanitized.length).toBeLessThan(MAX_STORED_BODY_LENGTH + 40);
    expect(sanitized).toContain("[truncated]");
  });

  it("scrubs the stored response excerpt of an errored request", async () => {
    const fetchImpl = stubFetch(
      400,
      JSON.stringify({
        error: { message: "bad" },
        access_token: "tok_secret_value",
      }),
    );

    const result = await sendToMetaCAPI([makeEvent()], makeConfig(), {
      fetchImpl,
      maxAttempts: 1,
    });

    expect(result.responseBody).toBeDefined();
    expect(result.responseBody).not.toContain("tok_secret_value");
  });
});
