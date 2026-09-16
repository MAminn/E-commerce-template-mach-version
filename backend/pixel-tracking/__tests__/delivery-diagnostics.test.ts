import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  processTrackingBeacon,
  logDeliveryResult,
  sendToAdapterAndLog,
} from "#root/backend/pixel-tracking/delivery-pipeline";
import {
  PixelPlatform,
  TrackingEventName,
  type PixelConfig,
  type TrackingEvent,
} from "#root/shared/types/pixel-tracking";
import type { DatabaseClient } from "#root/shared/database/drizzle/db";
import type { ServerContext } from "#root/server/routes/track";
import type {
  AdapterDeliveryResult,
  ServerPixelAdapter,
} from "#root/backend/pixel-tracking/server-adapters/types";
import type { EnrichedTrackingEvent } from "#root/backend/pixel-tracking/event-logger";

// ─── A minimal fake of the drizzle chains the pipeline uses ─────────────────

interface FakeDb {
  db: DatabaseClient;
  /** Rows written to tracking_event_delivery. */
  deliveries: Record<string, unknown>[];
  /** Event ids the tracking_event insert will claim to have created. */
  insertedEventIds: string[];
  /** Configs returned by the server-config select. */
  configs: PixelConfig[];
  /** Event ids the tracking_event insert was asked to write. */
  attemptedEventIds: string[];
}

function makeFakeDb(options?: {
  insertedEventIds?: string[];
  configs?: PixelConfig[];
}): FakeDb {
  const state: FakeDb = {
    deliveries: [],
    insertedEventIds: options?.insertedEventIds ?? [],
    configs: options?.configs ?? [],
    attemptedEventIds: [],
    db: undefined as unknown as DatabaseClient,
  };

  state.db = {
    insert(table: { _: { name?: string } } & Record<string, unknown>) {
      const isDelivery = "skippedReason" in table;
      return {
        values(rows: Record<string, unknown> | Record<string, unknown>[]) {
          const list = Array.isArray(rows) ? rows : [rows];
          if (isDelivery) {
            state.deliveries.push(...list);
            return Promise.resolve(undefined);
          }
          for (const row of list) {
            state.attemptedEventIds.push(row.eventId as string);
          }
          return {
            onConflictDoNothing() {
              return {
                returning() {
                  return Promise.resolve(
                    list
                      .filter((row) =>
                        state.insertedEventIds.includes(row.eventId as string),
                      )
                      .map((row) => ({
                        id: `db-${row.eventId}`,
                        eventId: row.eventId,
                      })),
                  );
                },
              };
            },
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return { execute: () => Promise.resolve(state.configs) };
            },
          };
        },
      };
    },
  } as unknown as DatabaseClient;

  return state;
}

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

const makeEvent = (overrides?: Partial<TrackingEvent>): TrackingEvent => ({
  eventId: "evt-1",
  eventName: TrackingEventName.CHECKOUT_COMPLETED,
  timestamp: Date.now(),
  pageUrl: "https://shop.test/thanks",
  sessionId: "sess-1",
  ...overrides,
});

const serverContext: ServerContext = {
  ip: "1.2.3.4",
  ipHash: "hash",
  userAgent: "Mozilla/5.0",
};

function makeAdapter(result: Partial<AdapterDeliveryResult>): {
  adapter: ServerPixelAdapter;
  received: EnrichedTrackingEvent[][];
} {
  const received: EnrichedTrackingEvent[][] = [];
  const adapter: ServerPixelAdapter = {
    platform: PixelPlatform.META,
    async sendEvents(events) {
      received.push(events);
      return {
        platform: PixelPlatform.META,
        success: true,
        ...result,
      } as AdapterDeliveryResult;
    },
  };
  return { adapter, received };
}

// ─── Duplicate beacons ──────────────────────────────────────────────────────

describe("processTrackingBeacon — duplicate beacon handling", () => {
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi.fn();
  });

  async function runBeacon(fake: FakeDb, events: TrackingEvent[]) {
    const { metaCapiAdapter } = await import(
      "#root/backend/pixel-tracking/server-adapters/meta-capi-adapter"
    );
    const spy = vi
      .spyOn(metaCapiAdapter, "sendEvents")
      .mockImplementation(async (received) => {
        sendSpy(received.map((e) => e.eventId));
        return {
          platform: PixelPlatform.META,
          configId: "cfg-meta",
          success: true,
          statusCode: 200,
          acceptedCount: received.length,
          requestId: "trace-1",
          attempts: 1,
        };
      });
    await processTrackingBeacon(events, serverContext, fake.db);
    spy.mockRestore();
  }

  it("forwards nothing when every event in the batch is a duplicate", async () => {
    const fake = makeFakeDb({
      insertedEventIds: [], // conflict on all
      configs: [makeConfig()],
    });

    await runBeacon(fake, [makeEvent({ eventId: "dupe" })]);

    // The old pipeline re-sent these to every platform on each retry, which
    // inflates Purchase counts once a platform's dedup window has passed.
    expect(sendSpy).not.toHaveBeenCalled();
    expect(fake.deliveries).toHaveLength(0);
  });

  it("forwards only the newly accepted events from a mixed batch", async () => {
    const fake = makeFakeDb({
      insertedEventIds: ["fresh"],
      configs: [makeConfig()],
    });

    await runBeacon(fake, [
      makeEvent({ eventId: "dupe" }),
      makeEvent({ eventId: "fresh" }),
    ]);

    expect(sendSpy).toHaveBeenCalledWith(["fresh"]);
    expect(fake.deliveries).toHaveLength(1);
    expect(fake.deliveries[0]!.trackingEventId).toBe("db-fresh");
  });

  it("forwards everything when nothing was a duplicate", async () => {
    const fake = makeFakeDb({
      insertedEventIds: ["a", "b"],
      configs: [makeConfig()],
    });

    await runBeacon(fake, [
      makeEvent({ eventId: "a" }),
      makeEvent({ eventId: "b" }),
    ]);

    expect(sendSpy).toHaveBeenCalledWith(["a", "b"]);
    expect(fake.deliveries).toHaveLength(2);
  });
});

// ─── Failed delivery is recorded, not retried by the duplicate path ─────────

describe("failed delivery — what happens next", () => {
  async function runWithResult(
    fake: FakeDb,
    events: TrackingEvent[],
    result: Partial<AdapterDeliveryResult>,
    calls: string[][],
  ) {
    const { metaCapiAdapter } = await import(
      "#root/backend/pixel-tracking/server-adapters/meta-capi-adapter"
    );
    const spy = vi
      .spyOn(metaCapiAdapter, "sendEvents")
      .mockImplementation(async (received) => {
        calls.push(received.map((e) => e.eventId));
        return {
          platform: PixelPlatform.META,
          configId: "cfg-meta",
          ...result,
        } as AdapterDeliveryResult;
      });
    await processTrackingBeacon(events, serverContext, fake.db);
    spy.mockRestore();
  }

  const failure: Partial<AdapterDeliveryResult> = {
    success: false,
    statusCode: 400,
    platformCode: "190",
    platformMessage: "Invalid OAuth access token",
    requestId: "trace-fail",
    attempts: 1,
    retryable: false,
    error: "Invalid OAuth access token",
  };

  it("records the failure with enough detail to act on it", async () => {
    const fake = makeFakeDb({
      insertedEventIds: ["e1"],
      configs: [makeConfig()],
    });
    const calls: string[][] = [];

    await runWithResult(fake, [makeEvent({ eventId: "e1" })], failure, calls);

    expect(calls).toEqual([["e1"]]);
    const row = fake.deliveries[0]!;
    expect(row.sent).toBe(false);
    expect(row.skippedReason).toBeNull(); // a failure, not a deliberate skip
    expect(row.statusCode).toBe(400);
    expect(row.platformCode).toBe("190");
    expect(row.requestId).toBe("trace-fail");
    expect(row.error).toContain("Invalid OAuth");
  });

  it("does NOT re-attempt delivery when the same beacon arrives again", async () => {
    const calls: string[][] = [];

    // First beacon: the insert creates the row, delivery fails.
    const first = makeFakeDb({
      insertedEventIds: ["e1"],
      configs: [makeConfig()],
    });
    await runWithResult(first, [makeEvent({ eventId: "e1" })], failure, calls);
    expect(calls).toHaveLength(1);

    // Second beacon with the same event id: the insert conflicts, so nothing
    // is forwarded. Duplicate suppression is not a retry mechanism, and the
    // admin failure count stays the only signal that the event was lost.
    const second = makeFakeDb({
      insertedEventIds: [],
      configs: [makeConfig()],
    });
    await runWithResult(second, [makeEvent({ eventId: "e1" })], failure, calls);

    expect(calls).toHaveLength(1);
    expect(second.deliveries).toHaveLength(0);
  });

  it("keeps a failure distinguishable from a deliberate skip", async () => {
    const fake = makeFakeDb({
      insertedEventIds: ["pv"],
      configs: [makeConfig()],
    });
    const calls: string[][] = [];

    await runWithResult(
      fake,
      [makeEvent({ eventId: "pv" })],
      {
        success: true,
        statusCode: 200,
        acceptedCount: 0,
        attempts: 0,
        skipped: { eventIds: ["pv"], reason: "not deduplicable" },
      },
      calls,
    );

    const row = fake.deliveries[0]!;
    expect(row.sent).toBe(false);
    expect(row.skippedReason).toBe("not deduplicable");
    expect(row.error).toBeNull();
  });
});

// ─── Delivery diagnostics ───────────────────────────────────────────────────

describe("delivery logging — diagnostics are preserved", () => {
  it("stores status, platform code, request id, count and target config", async () => {
    const fake = makeFakeDb();

    await logDeliveryResult(fake.db, "row-1", {
      platform: PixelPlatform.TIKTOK,
      configId: "cfg-tiktok",
      success: false,
      statusCode: 200,
      platformCode: "40100",
      platformMessage: "Access token is incorrect",
      requestId: "req-9",
      acceptedCount: 0,
      attempts: 2,
      error: "TikTok Events API error 40100",
    });

    const row = fake.deliveries[0]!;
    expect(row.sent).toBe(false);
    expect(row.pixelConfigId).toBe("cfg-tiktok");
    expect(row.statusCode).toBe(200);
    expect(row.platformCode).toBe("40100");
    expect(row.platformMessage).toBe("Access token is incorrect");
    expect(row.requestId).toBe("req-9");
    expect(row.acceptedCount).toBe(0);
    expect(row.attempts).toBe(2);
    expect(row.error).toContain("40100");
  });

  it("records a skipped event as not-sent with its reason, not as an error", async () => {
    const fake = makeFakeDb();

    await logDeliveryResult(
      fake.db,
      "row-2",
      {
        platform: PixelPlatform.TIKTOK,
        configId: "cfg-tiktok",
        success: true,
        statusCode: 200,
      },
      { skippedReason: "page views cannot be deduplicated" },
    );

    const row = fake.deliveries[0]!;
    expect(row.sent).toBe(false);
    expect(row.skippedReason).toBe("page views cannot be deduplicated");
    expect(row.error).toBeNull();
  });

  it("attributes each row to the configuration that was targeted", async () => {
    const fake = makeFakeDb();
    const { adapter } = makeAdapter({
      configId: "cfg-second",
      statusCode: 200,
      acceptedCount: 1,
      requestId: "trace-b",
    });

    await sendToAdapterAndLog(
      adapter,
      [
        {
          ...makeEvent({ eventId: "x" }),
          serverContext,
        } as EnrichedTrackingEvent,
      ],
      makeConfig({ id: "cfg-second" }),
      [{ id: "db-x", eventId: "x" }],
      fake.db,
    );

    expect(fake.deliveries[0]!.pixelConfigId).toBe("cfg-second");
    expect(fake.deliveries[0]!.requestId).toBe("trace-b");
  });

  it("marks only the skipped events as skipped within one batch", async () => {
    const fake = makeFakeDb();
    const { adapter } = makeAdapter({
      configId: "cfg-tiktok",
      statusCode: 200,
      acceptedCount: 1,
      skipped: { eventIds: ["pv"], reason: "no event_id on ttq.page()" },
    });

    await sendToAdapterAndLog(
      adapter,
      [],
      makeConfig({ id: "cfg-tiktok" }),
      [
        { id: "db-pv", eventId: "pv" },
        { id: "db-atc", eventId: "atc" },
      ],
      fake.db,
    );

    const byRow = Object.fromEntries(
      fake.deliveries.map((d) => [d.trackingEventId, d]),
    );
    expect(byRow["db-pv"]!.skippedReason).toBe("no event_id on ttq.page()");
    expect(byRow["db-pv"]!.sent).toBe(false);
    expect(byRow["db-atc"]!.skippedReason).toBeNull();
    expect(byRow["db-atc"]!.sent).toBe(true);
  });

  it("logs an adapter that throws as a failed delivery for every event", async () => {
    const fake = makeFakeDb();
    const adapter: ServerPixelAdapter = {
      platform: PixelPlatform.META,
      sendEvents: async () => {
        throw new Error("boom");
      },
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await sendToAdapterAndLog(
      adapter,
      [],
      makeConfig(),
      [{ id: "db-1", eventId: "e1" }],
      fake.db,
    );

    expect(fake.deliveries[0]!.sent).toBe(false);
    expect(fake.deliveries[0]!.error).toBe("boom");
    expect(fake.deliveries[0]!.pixelConfigId).toBe("cfg-meta");
    errorSpy.mockRestore();
  });
});
