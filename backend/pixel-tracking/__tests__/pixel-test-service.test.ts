import { describe, it, expect, vi } from "vitest";
import { Effect, Exit } from "effect";
import {
  testServerPixel,
  testServerPixelSchema,
  buildTestEvent,
  maskPixelId,
  TESTABLE_EVENT_NAMES,
} from "#root/backend/pixel-tracking/pixel-test/service";
import { pixelTestRouter } from "#root/backend/pixel-tracking/pixel-test/trpc";
import {
  DatabaseClientService,
  type DatabaseClient,
} from "#root/shared/database/drizzle/db";
import {
  PixelPlatform,
  TrackingEventName,
  type PixelConfig,
} from "#root/shared/types/pixel-tracking";
import { metaCapiAdapter } from "#root/backend/pixel-tracking/server-adapters/meta-capi-adapter";
import {
  tiktokEventsAdapter,
  sendToTikTokEventsAPI,
} from "#root/backend/pixel-tracking/server-adapters/tiktok-events-adapter";

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeConfig = (overrides?: Partial<PixelConfig>): PixelConfig => ({
  id: "11111111-1111-7111-8111-111111111111",
  platform: PixelPlatform.META,
  pixelId: "1234567890123",
  accessToken: "tok_super_secret",
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

/**
 * A db whose select() returns `rows` and records which id was looked up.
 */
function makeDb(rows: PixelConfig[]) {
  const inserts: unknown[] = [];
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return { execute: () => Promise.resolve(rows) };
            },
          };
        },
      };
    },
    insert() {
      return {
        values(v: unknown) {
          inserts.push(v);
          return Promise.resolve(undefined);
        },
      };
    },
  } as unknown as DatabaseClient;
  return { db, inserts };
}

function run(effect: Effect.Effect<unknown, unknown, DatabaseClientService>, db: DatabaseClient) {
  return Effect.runPromiseExit(
    Effect.provideService(effect, DatabaseClientService, db),
  );
}

// ─── Input validation ───────────────────────────────────────────────────────

describe("server pixel test — input contract", () => {
  it("requires a single configuration id", () => {
    expect(testServerPixelSchema.safeParse({}).success).toBe(false);
    expect(
      testServerPixelSchema.safeParse({ configId: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("defaults to ViewContent, a standard event on both Meta and TikTok", () => {
    const parsed = testServerPixelSchema.parse({
      configId: "11111111-1111-7111-8111-111111111111",
    });
    // A page-view default would be skipped by the TikTok both-paths policy
    // and the "test" would send nothing.
    expect(parsed.eventName).toBe(TrackingEventName.PRODUCT_VIEWED);
  });

  it("does not allow a synthetic Purchase", () => {
    // A test purchase lands in the same conversion metrics campaigns optimize
    // against, and cannot be withdrawn once sent.
    expect(TESTABLE_EVENT_NAMES).not.toContain(
      TrackingEventName.CHECKOUT_COMPLETED,
    );
    expect(
      testServerPixelSchema.safeParse({
        configId: "11111111-1111-7111-8111-111111111111",
        eventName: TrackingEventName.CHECKOUT_COMPLETED,
      }).success,
    ).toBe(false);
  });

  it("rejects a test code that is not a plain token", () => {
    const base = { configId: "11111111-1111-7111-8111-111111111111" };
    expect(
      testServerPixelSchema.safeParse({ ...base, testEventCode: "TEST_123-x" })
        .success,
    ).toBe(true);
    expect(
      testServerPixelSchema.safeParse({
        ...base,
        testEventCode: '"; DROP TABLE',
      }).success,
    ).toBe(false);
  });
});

// ─── Authorization ──────────────────────────────────────────────────────────

describe("server pixel test — authorization", () => {
  it("is exposed only as an admin-gated mutation", async () => {
    const { pixelConfigRouter } = await import(
      "#root/backend/pixel-tracking/pixel-config/trpc"
    );
    const procedure = (
      pixelTestRouter as unknown as {
        _def: {
          procedures: Record<
            string,
            { _def: { mutation?: boolean; middlewares: unknown[] } }
          >;
        };
      }
    )._def.procedures.server!;
    const publicProc = (
      pixelConfigRouter as unknown as {
        _def: {
          procedures: Record<string, { _def: { middlewares: unknown[] } }>;
        };
      }
    )._def.procedures.listActive!;

    // A state-changing call that spends the merchant's access token must not
    // be a query, and must not be reachable on the public procedure chain.
    expect(procedure._def.mutation).toBe(true);
    expect(procedure._def.middlewares.length).toBeGreaterThan(
      publicProc._def.middlewares.length,
    );
  });

  it("is reachable through the pixelTracking router as test.server", async () => {
    const { pixelTrackingRouter } = await import(
      "#root/backend/pixel-tracking/trpc"
    );
    const procedures = (
      pixelTrackingRouter as unknown as {
        _def: { procedures: Record<string, unknown> };
      }
    )._def.procedures;
    expect(procedures["test.server"]).toBeDefined();
  });
});

// ─── Target selection ───────────────────────────────────────────────────────

describe("server pixel test — targeting", () => {
  it("fails when the configuration does not exist", async () => {
    const { db } = makeDb([]);
    const exit = await run(
      testServerPixel(
        testServerPixelSchema.parse({
          configId: "11111111-1111-7111-8111-111111111111",
        }),
      ),
      db,
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("refuses a configuration with server-side delivery disabled", async () => {
    const { db } = makeDb([makeConfig({ enableServerSide: false })]);
    const exit = await run(
      testServerPixel(
        testServerPixelSchema.parse({
          configId: "11111111-1111-7111-8111-111111111111",
        }),
      ),
      db,
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("sends to exactly one configuration's adapter", async () => {
    const config = makeConfig();
    const { db } = makeDb([config]);
    const spy = vi
      .spyOn(metaCapiAdapter, "sendEvents")
      .mockResolvedValue({
        platform: PixelPlatform.META,
        configId: config.id,
        success: true,
        statusCode: 200,
        acceptedCount: 1,
        requestId: "trace-1",
        attempts: 1,
      });
    const tiktokSpy = vi.spyOn(tiktokEventsAdapter, "sendEvents");

    const exit = await run(
      testServerPixel(
        testServerPixelSchema.parse({ configId: config.id }),
      ),
      db,
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1]!.id).toBe(config.id);
    expect(tiktokSpy).not.toHaveBeenCalled();

    spy.mockRestore();
    tiktokSpy.mockRestore();
  });

  it("passes the test code through for this request only", async () => {
    const config = makeConfig();
    const { db } = makeDb([config]);
    const spy = vi.spyOn(metaCapiAdapter, "sendEvents").mockResolvedValue({
      platform: PixelPlatform.META,
      success: true,
      statusCode: 200,
      acceptedCount: 1,
      attempts: 1,
    });

    await run(
      testServerPixel(
        testServerPixelSchema.parse({
          configId: config.id,
          testEventCode: "TEST12345",
        }),
      ),
      db,
    );

    expect(spy.mock.calls[0]![2]).toMatchObject({
      testEventCode: "TEST12345",
      maxAttempts: 1,
    });
    spy.mockRestore();
  });

  it("does not persist the synthetic event", async () => {
    const config = makeConfig();
    const { db, inserts } = makeDb([config]);
    const spy = vi.spyOn(metaCapiAdapter, "sendEvents").mockResolvedValue({
      platform: PixelPlatform.META,
      success: true,
      statusCode: 200,
      acceptedCount: 1,
      attempts: 1,
    });

    await run(
      testServerPixel(testServerPixelSchema.parse({ configId: config.id })),
      db,
    );

    // Operator tests must not move the dashboard's own event counters.
    expect(inserts).toHaveLength(0);
    spy.mockRestore();
  });
});

// ─── Result sanitization ────────────────────────────────────────────────────

describe("server pixel test — result", () => {
  async function runWith(delivery: Record<string, unknown>) {
    const config = makeConfig();
    const { db } = makeDb([config]);
    const spy = vi
      .spyOn(metaCapiAdapter, "sendEvents")
      .mockResolvedValue(delivery as never);
    const exit = await run(
      testServerPixel(testServerPixelSchema.parse({ configId: config.id })),
      db,
    );
    spy.mockRestore();
    if (!Exit.isSuccess(exit)) throw new Error("expected success");
    return exit.value as Record<string, unknown>;
  }

  it("reports API acceptance separately from platform visibility", async () => {
    const result = await runWith({
      platform: PixelPlatform.META,
      success: true,
      statusCode: 200,
      acceptedCount: 1,
      requestId: "trace-9",
      attempts: 1,
    });

    expect(result.acceptedByApi).toBe(true);
    expect(result.requestId).toBe("trace-9");
    // The UI must point the operator at the platform's own tool rather than
    // claiming the event is visible.
    expect(String(result.verifyIn)).toContain("Test Events");
  });

  it("reports a rejected request as not accepted", async () => {
    const result = await runWith({
      platform: PixelPlatform.META,
      success: false,
      statusCode: 400,
      platformCode: "100/2804003",
      platformMessage: "Invalid parameter",
      error: "Invalid parameter",
      attempts: 1,
    });

    expect(result.acceptedByApi).toBe(false);
    expect(result.platformCode).toBe("100/2804003");
  });

  it("never returns the access token, even if the platform echoes it", async () => {
    const result = await runWith({
      platform: PixelPlatform.META,
      success: false,
      statusCode: 400,
      error: 'rejected for access_token=tok_super_secret',
      platformMessage: 'access_token: tok_super_secret',
      responseBody: '{"access_token":"tok_super_secret"}',
      attempts: 1,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("tok_super_secret");
    expect(serialized).toContain("[REDACTED]");
    // The raw response body is not forwarded to the browser at all.
    expect(result).not.toHaveProperty("responseBody");
  });

  it("masks the pixel id in the result", async () => {
    const result = await runWith({
      platform: PixelPlatform.META,
      success: true,
      statusCode: 200,
      acceptedCount: 1,
      attempts: 1,
    });

    expect(result.pixelIdMasked).toBe("1234••••0123");
    expect(maskPixelId("12345678")).toBe("12345678");
  });

  it("surfaces a skipped-event reason instead of a bare success", async () => {
    const result = await runWith({
      platform: PixelPlatform.TIKTOK,
      success: true,
      statusCode: 200,
      acceptedCount: 0,
      skipped: { eventIds: ["x"], reason: "page views carry no event_id" },
      attempts: 0,
    });

    expect(result.skippedReason).toBe("page views carry no event_id");
  });
});

// ─── TikTok: the admin test must reach the Events API through the real
//     adapter, not be policy-skipped ──────────────────────────────────────────

describe("server pixel test — TikTok through the real adapter", () => {
  const tiktokBothPaths = (): PixelConfig =>
    makeConfig({
      id: "22222222-2222-7222-8222-222222222222",
      platform: PixelPlatform.TIKTOK,
      pixelId: "CTESTPIXEL0001",
      accessToken: "tt_secret",
      enableClientSide: true,
      enableServerSide: true,
    });

  /** Capture the HTTP request the real adapter makes. */
  function captureFetch(body: Record<string, unknown>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      };
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it("sends the default event as a real ViewContent request", async () => {
    const config = tiktokBothPaths();
    const { db, inserts } = makeDb([config]);
    const { fetchImpl, calls } = captureFetch({
      code: 0,
      message: "OK",
      request_id: "req-tt-1",
    });
    // Route the real adapter's fetch through the capture without stubbing the
    // adapter itself.
    const spy = vi
      .spyOn(tiktokEventsAdapter, "sendEvents")
      .mockImplementation((events, cfg, options) =>
        sendToTikTokEventsAPI(events, cfg, { ...options, fetchImpl }),
      );

    const exit = await run(
      testServerPixel(testServerPixelSchema.parse({ configId: config.id })),
      db,
    );
    spy.mockRestore();

    expect(Exit.isSuccess(exit)).toBe(true);
    const result = (exit as { value: Record<string, unknown> }).value;

    // A real request went out, to the Events API, for this pixel.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("business-api.tiktok.com/open_api/v1.3/event/track");
    const payload = JSON.parse(calls[0]!.init.body as string) as {
      event_source_id: string;
      data: Array<{ event: string; event_id: string }>;
      test_event_code?: string;
    };
    expect(payload.event_source_id).toBe("CTESTPIXEL0001");
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]!.event).toBe("ViewContent");
    expect(payload.data[0]!.event_id).toBe(result.eventId);
    expect(payload).not.toHaveProperty("test_event_code");

    // Token in the header only; the result carries none of it.
    expect((calls[0]!.init.headers as Record<string, string>)["Access-Token"]).toBe("tt_secret");
    expect(JSON.stringify(result)).not.toContain("tt_secret");

    // Not policy-skipped, not persisted, reported as accepted with the
    // platform's own identifiers.
    expect(result.skippedReason).toBeUndefined();
    expect(result.productionWouldSkip).toBeUndefined();
    expect(result.acceptedByApi).toBe(true);
    expect(result.platformCode).toBe("0");
    expect(result.requestId).toBe("req-tt-1");
    expect(inserts).toHaveLength(0);
  });

  it("still sends an explicit Page view test, and says production would not", async () => {
    const config = tiktokBothPaths();
    const { db } = makeDb([config]);
    const { fetchImpl, calls } = captureFetch({ code: 0, request_id: "r2" });
    const spy = vi
      .spyOn(tiktokEventsAdapter, "sendEvents")
      .mockImplementation((events, cfg, options) =>
        sendToTikTokEventsAPI(events, cfg, { ...options, fetchImpl }),
      );

    const exit = await run(
      testServerPixel(
        testServerPixelSchema.parse({
          configId: config.id,
          eventName: TrackingEventName.PAGE_VIEWED,
        }),
      ),
      db,
    );
    spy.mockRestore();

    const result = (exit as { value: Record<string, unknown> }).value;
    expect(calls).toHaveLength(1); // the request was real
    expect(
      (JSON.parse(calls[0]!.init.body as string) as { data: { event: string }[] })
        .data[0]!.event,
    ).toBe("Pageview");
    expect(result.acceptedByApi).toBe(true);
    // ...but the operator is told production traffic behaves differently.
    expect(String(result.productionWouldSkip)).toContain("does not send");
  });

  it("passes the test code through to the TikTok request only when given", async () => {
    const config = tiktokBothPaths();
    const { db } = makeDb([config]);
    const { fetchImpl, calls } = captureFetch({ code: 0 });
    const spy = vi
      .spyOn(tiktokEventsAdapter, "sendEvents")
      .mockImplementation((events, cfg, options) =>
        sendToTikTokEventsAPI(events, cfg, { ...options, fetchImpl }),
      );

    await run(
      testServerPixel(
        testServerPixelSchema.parse({
          configId: config.id,
          testEventCode: "TT-CODE-1",
        }),
      ),
      db,
    );
    spy.mockRestore();

    const payload = JSON.parse(calls[0]!.init.body as string) as {
      test_event_code?: string;
    };
    expect(payload.test_event_code).toBe("TT-CODE-1");
  });

  it("reports a TikTok application-level rejection as not accepted", async () => {
    const config = tiktokBothPaths();
    const { db } = makeDb([config]);
    const { fetchImpl } = captureFetch({
      code: 40100,
      message: "Access token is incorrect",
      request_id: "req-bad",
    });
    const spy = vi
      .spyOn(tiktokEventsAdapter, "sendEvents")
      .mockImplementation((events, cfg, options) =>
        sendToTikTokEventsAPI(events, cfg, { ...options, fetchImpl }),
      );

    const exit = await run(
      testServerPixel(testServerPixelSchema.parse({ configId: config.id })),
      db,
    );
    spy.mockRestore();

    const result = (exit as { value: Record<string, unknown> }).value;
    expect(result.acceptedByApi).toBe(false);
    expect(result.statusCode).toBe(200);
    expect(result.platformCode).toBe("40100");
    expect(result.requestId).toBe("req-bad");
  });
});

// ─── Synthetic event shape ──────────────────────────────────────────────────

describe("buildTestEvent", () => {
  it("marks the event as operator-generated", () => {
    const event = buildTestEvent(
      testServerPixelSchema.parse({
        configId: "11111111-1111-7111-8111-111111111111",
      }),
      "evt-test",
      "https://shop.test",
    );

    expect(event.customProperties).toEqual({ synthetic_test: true });
    expect(event.sessionId).toContain("pixel-test");
  });

  it("adds a nominal 1-unit basket for commerce events", () => {
    const event = buildTestEvent(
      testServerPixelSchema.parse({
        configId: "11111111-1111-7111-8111-111111111111",
        eventName: TrackingEventName.PRODUCT_ADDED_TO_CART,
      }),
      "evt-test",
      "https://shop.test",
    );

    expect(event.ecommerce?.value).toBe(1);
    expect(event.ecommerce?.items?.[0]?.itemId).toBe("PIXEL-TEST-SKU");
  });

  it("sends no server-side identifiers for a synthetic visitor", () => {
    const event = buildTestEvent(
      testServerPixelSchema.parse({
        configId: "11111111-1111-7111-8111-111111111111",
      }),
      "evt-test",
      "https://shop.test",
    );

    expect(event.serverContext.ip).toBe("");
    expect(event.serverContext.fbp).toBeUndefined();
  });
});
