import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBostaPickupCache,
  resolveBostaBusinessLocationId,
  selectPickupLocation,
} from "../pickup";
import {
  clearBostaEnv,
  LOCATION_ID,
  pickupLocationsResponse,
  setBostaEnv,
  stubFetch,
} from "./test-utils";

beforeEach(() => {
  setBostaEnv();
  clearBostaPickupCache();
});
afterEach(() => {
  clearBostaEnv();
  vi.unstubAllGlobals();
});

describe("resolveBostaBusinessLocationId", () => {
  it("37. explicit BOSTA_PICKUP_LOCATION_ID wins without any API call", async () => {
    setBostaEnv({ BOSTA_PICKUP_LOCATION_ID: "LN498564956" });
    const { fetchMock } = stubFetch([]);
    expect(await resolveBostaBusinessLocationId()).toBe("LN498564956");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a placeholder BOSTA_PICKUP_LOCATION_ID", async () => {
    setBostaEnv({ BOSTA_PICKUP_LOCATION_ID: "your-location-id" });
    stubFetch([
      { match: "/pickup-locations", respond: () => pickupLocationsResponse([{ _id: LOCATION_ID, isDefault: true }]) },
    ]);
    expect(await resolveBostaBusinessLocationId()).toBe(LOCATION_ID);
  });

  it("38. selects the location flagged isDefault (documented response shape)", async () => {
    const { calls } = stubFetch([
      {
        match: "/pickup-locations",
        respond: () =>
          pickupLocationsResponse([
            { _id: "5f0a7def4a839b00139d6203", locationName: "Original Business Location", address: { firstLine: "1st settlement" } },
            {
              locationName: "business101",
              address: { firstLine: "el-mohandseen", city: { _id: "FceDyHXwpSYYF9zGW", name: "cairo" }, district: "cairo" },
              _id: LOCATION_ID,
              isDefault: true,
            },
          ]),
      },
    ]);
    expect(await resolveBostaBusinessLocationId()).toBe(LOCATION_ID);
    expect(calls[0]!.url).toBe("https://app.bosta.co/api/v2/pickup-locations");
    // cached
    expect(await resolveBostaBusinessLocationId()).toBe(LOCATION_ID);
    expect(calls).toHaveLength(1);
  });

  it("39. uses the only location when there is exactly one (even without isDefault)", async () => {
    stubFetch([
      { match: "/pickup-locations", respond: () => pickupLocationsResponse([{ _id: "only-one", locationName: "Warehouse" }]) },
    ]);
    expect(await resolveBostaBusinessLocationId()).toBe("only-one");
  });

  it("40. fails loudly with several locations and no default", async () => {
    stubFetch([
      {
        match: "/pickup-locations",
        respond: () => pickupLocationsResponse([{ _id: "a", locationName: "A" }, { _id: "b", locationName: "B" }]),
      },
    ]);
    await expect(resolveBostaBusinessLocationId()).rejects.toThrow(/none is marked default/);
  });

  it("41. fails clearly when the account has no locations", async () => {
    stubFetch([{ match: "/pickup-locations", respond: () => pickupLocationsResponse([]) }]);
    await expect(resolveBostaBusinessLocationId()).rejects.toThrow(/No pickup location/);
  });
});

describe("selectPickupLocation (pure)", () => {
  it("never silently picks list[0]", () => {
    const result = selectPickupLocation([
      { id: "a", name: "A", isDefault: false },
      { id: "b", name: "B", isDefault: false },
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects multiple defaults", () => {
    const result = selectPickupLocation([
      { id: "a", name: "A", isDefault: true },
      { id: "b", name: "B", isDefault: true },
    ]);
    expect(result).toMatchObject({ ok: false });
  });
});
