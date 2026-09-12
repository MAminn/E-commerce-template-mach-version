/**
 * Shared fixtures for the Bosta unit tests. No network, no database —
 * `fetch` is stubbed per test and the drizzle client is an in-memory fake.
 */
import { vi } from "vitest";
import { order, orderItem } from "#root/shared/database/drizzle/schema";
import type { BostaDistrictEntry } from "../districts";

export const TEST_API_KEY = "test-bosta-api-key-DO-NOT-LOG";
export const TEST_WEBHOOK_SECRET = "test-bosta-webhook-secret-DO-NOT-LOG";
export const ORDER_ID = "0f6a1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
export const DISTRICT_ID = "Iy7-lFD0BE0";
export const ZONE_ID = "qWckBs-T7";
export const LOCATION_ID = "yfWPU0tP2";

const ENV_KEYS = [
  "SYN_BOSTA_KEY",
  "BOSTA_WEBHOOK_SECRET",
  "BOSTA_PICKUP_LOCATION_ID",
  "BOSTA_WEBHOOK_ALLOWED_IPS",
  "BOSTA_EGYPT_COUNTRY_ID",
] as const;

export function setBostaEnv(
  overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {},
) {
  const merged: Record<string, string | undefined> = {
    SYN_BOSTA_KEY: TEST_API_KEY,
    BOSTA_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    BOSTA_PICKUP_LOCATION_ID: undefined,
    BOSTA_WEBHOOK_ALLOWED_IPS: undefined,
    BOSTA_EGYPT_COUNTRY_ID: undefined,
    ...overrides,
  };
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

export function clearBostaEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Documented `GET /cities/getAllDistricts` payload (trimmed). */
export function districtsResponse(
  extra: Array<Record<string, unknown>> = [],
): Response {
  return jsonResponse({
    success: true,
    message: "Done successfully.",
    data: [
      {
        cityId: "FceDyHXwpSYYF9zGW",
        cityName: "Cairo",
        cityOtherName: "القاهرة",
        cityCode: "EG-01",
        districts: [
          {
            zoneId: ZONE_ID,
            zoneName: "15 May",
            zoneOtherName: "١٥ مايو",
            districtId: DISTRICT_ID,
            districtName: "15 May",
            districtOtherName: "١٥ مايو",
            pickupAvailability: true,
            dropOffAvailability: true,
          },
          {
            zoneId: "zone-maadi",
            zoneName: "ElMaadi",
            districtId: "district-maadi",
            districtName: "ElMaadi",
            districtOtherName: "المعادي",
            pickupAvailability: true,
            dropOffAvailability: true,
          },
          {
            zoneId: "zone-nodrop",
            zoneName: "No Drop Zone",
            districtId: "district-nodrop",
            districtName: "No Drop District",
            pickupAvailability: true,
            dropOffAvailability: false,
          },
          ...extra,
        ],
        pickupAvailability: true,
        dropOffAvailability: true,
      },
    ],
  });
}

/** Documented `GET /pickup-locations` payload. */
export function pickupLocationsResponse(
  list: Array<Record<string, unknown>>,
): Response {
  return jsonResponse({
    success: true,
    message: "Done successfully.",
    data: { total: list.length, list, page: 1, limit: 50, pages: 1 },
  });
}

/** Documented `POST /deliveries?apiVersion=1` 200 payload. */
export function createDeliveryResponse(
  overrides: Record<string, unknown> = {},
): Response {
  return jsonResponse({
    success: true,
    message: "Done successfully.",
    data: {
      _id: "Lx9vyKBqAeiIcERQKfn6I",
      trackingNumber: "5108002",
      businessReference: ORDER_ID,
      message: "Delivery created successfully!",
      state: { code: 10, value: "Pickup requested" },
      creationSrc: "API",
      ...overrides,
    },
  });
}

export function makeDistrictEntry(
  overrides: Partial<BostaDistrictEntry> = {},
): BostaDistrictEntry {
  return {
    cityId: "cairo-id",
    cityCode: "EG-01",
    cityName: "Cairo",
    cityOtherName: "القاهرة",
    zoneId: "zone-x",
    zoneName: "Zone X",
    districtId: "district-x",
    districtName: "District X",
    dropOffAvailability: true,
    pickupAvailability: true,
    ...overrides,
  };
}

/**
 * Install a `fetch` stub that routes by URL substring. Unmatched requests
 * throw so a test can never reach the network by accident.
 */
export function stubFetch(
  routes: Array<{ match: string | RegExp; respond: (init: RequestInit | undefined, url: string) => Response }>,
) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    for (const route of routes) {
      const hit = typeof route.match === "string" ? url.includes(route.match) : route.match.test(url);
      if (hit) return route.respond(init, url);
    }
    throw new Error(`Unexpected fetch to ${url} — Bosta unit tests must never hit the network`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

/** Minimal order row as stored by the repo (decimal strings). */
export function makeOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    customerName: "Ahmed Ali",
    customerEmail: "ahmed@example.com",
    customerPhone: "01000000000",
    shippingAddress: "12 Tahrir St (Bldg 5, Apt 3)",
    shippingCity: "15 May",
    shippingState: "Cairo",
    shippingDistrict: `bosta:${DISTRICT_ID}`,
    shippingPostalCode: "00000",
    shippingCountry: "Egypt",
    subtotal: "130.00",
    shipping: "20.00",
    tax: "0.00",
    discount: "10.00",
    total: "140.00",
    status: "pending",
    notes: null,
    paymentMethod: "cod",
    paymentStatus: "not_required",
    bostaDeliveryId: null,
    bostaTrackingNumber: null,
    bostaStatus: null,
    bostaStatusCode: null,
    bostaWebhookData: null,
    bostaStatusUpdatedAt: null,
    bostaSyncStatus: null,
    bostaSyncError: null,
    bostaSyncedAt: null,
    bostaSyncAttemptedAt: null,
    ...overrides,
  };
}

/**
 * In-memory stand-in for the drizzle client covering the chains the Bosta
 * code uses. Every test works on one order, so `where` is accepted and
 * ignored — except for the dispatch claim, whose conditional UPDATE is
 * emulated in JS (see `update`).
 */
export function makeFakeDb(state: {
  order: Record<string, unknown> | null;
  items?: Array<{ name: string; quantity: number }>;
}) {
  const updates: Array<Record<string, unknown>> = [];

  const selectChain = (table: unknown) => {
    const rows = () => {
      if (table === order) return state.order ? [{ ...state.order }] : [];
      if (table === orderItem) return (state.items ?? []).map((i) => ({ ...i }));
      return [];
    };
    const chain: Record<string, unknown> = {};
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.orderBy = () => chain;
    chain.execute = async () => rows();
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows()).then(resolve, reject);
    return chain;
  };

  const applyUpdate = (table: unknown, values: Record<string, unknown>, claim: boolean) => {
    if (table !== order || !state.order) return [];
    if (claim) {
      // Emulates dispatch.ts' claim predicate: only rows that are not
      // already pending/sent can be moved into "pending".
      const status = state.order.bostaSyncStatus as string | null;
      if (status === "pending" || status === "sent") return [];
    }
    Object.assign(state.order, values);
    updates.push(values);
    return [{ id: state.order.id }];
  };

  const db = {
    select: vi.fn(() => ({ from: (table: unknown) => selectChain(table) })),
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          execute: async () => {
            applyUpdate(table, values, false);
          },
          returning: () => ({
            execute: async () => applyUpdate(table, values, values.bostaSyncStatus === "pending"),
          }),
        }),
      }),
    })),
    insert: vi.fn(() => ({
      values: () => ({ returning: async () => [{ id: "log-1" }] }),
    })),
    updates,
  };
  return db;
}
