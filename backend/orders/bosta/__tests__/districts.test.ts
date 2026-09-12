import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBostaDistrictsCache,
  encodeBostaDistrictRef,
  findDistrictByNames,
  flattenDistrictsPayload,
  getBostaCheckoutLocations,
  groupDistrictsForCheckout,
  loadDistricts,
  parseBostaDistrictRef,
  resolveBostaDropOffDistrict,
  type BostaDistrictEntry,
} from "../districts";
import {
  clearBostaEnv,
  districtsResponse,
  DISTRICT_ID,
  makeDistrictEntry,
  setBostaEnv,
  stubFetch,
} from "./test-utils";

// A slice of real Bosta production data shape, chosen to reproduce the
// inconsistent-spacing pattern ("ElMaadi" vs "Ein Shams") plus a duplicated
// district name across two zones to exercise ambiguity handling.
const districts: BostaDistrictEntry[] = [
  makeDistrictEntry({ zoneId: "zone-maadi", zoneName: "ElMaadi", districtId: "district-maadi", districtName: "ElMaadi", districtOtherName: "المعادي" }),
  makeDistrictEntry({ zoneId: "zone-nozha", zoneName: "ElNozha", districtId: "district-nozha", districtName: "ElNozha", districtOtherName: "النزهة" }),
  makeDistrictEntry({ zoneId: "zone-einshams", zoneName: "Ein Shams", districtId: "district-einshams", districtName: "Ein Shams" }),
  makeDistrictEntry({ zoneId: "zone-nasrcity", zoneName: "Nasr City", districtId: "district-nasrcity-1", districtName: "First Settlement" }),
  makeDistrictEntry({ zoneId: "zone-nasrcity", zoneName: "Nasr City", districtId: "district-nasrcity-2", districtName: "ElManteqa El Oula", districtOtherName: "المنطقة الأولى" }),
  makeDistrictEntry({ zoneId: "zone-dup-a", zoneName: "Dup A", districtId: "district-dup-a", districtName: "Central" }),
  makeDistrictEntry({ zoneId: "zone-dup-b", zoneName: "Dup B", districtId: "district-dup-b", districtName: "Central" }),
  makeDistrictEntry({ cityId: "giza-id", cityCode: "EG-02", cityName: "Giza", cityOtherName: "الجيزة", zoneId: "zone-october", zoneName: "6 October", districtId: "district-october", districtName: "6 October" }),
  makeDistrictEntry({ cityId: "giza-id", cityCode: "EG-02", cityName: "Giza", zoneId: "zone-giza-maadi", zoneName: "ElMaadi", districtId: "district-giza-maadi", districtName: "ElMaadi" }),
];

beforeEach(() => {
  setBostaEnv();
  clearBostaDistrictsCache();
});
afterEach(() => {
  clearBostaEnv();
  vi.unstubAllGlobals();
});

describe("district reference encoding", () => {
  it("round-trips a district id through shipping_district", () => {
    expect(encodeBostaDistrictRef(" abc ")).toBe("bosta:abc");
    expect(parseBostaDistrictRef("bosta:abc")).toBe("abc");
    expect(parseBostaDistrictRef("Maadi")).toBeNull();
    expect(parseBostaDistrictRef("")).toBeNull();
    expect(parseBostaDistrictRef("bosta:")).toBeNull();
  });
});

describe("flattenDistrictsPayload / loadDistricts", () => {
  it("parses the documented getAllDistricts shape and keeps availability flags", () => {
    stubFetch([]);
    const entries = flattenDistrictsPayload(JSON.parse(JSON.stringify({
      success: true,
      data: [{ cityId: "c", cityName: "Cairo", cityCode: "EG-01", districts: [
        { zoneId: "z", zoneName: "Z", districtId: "d", districtName: "D", pickupAvailability: true, dropOffAvailability: false },
      ] }],
    })));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ cityId: "c", districtId: "d", dropOffAvailability: false });
  });

  it("42. excludes districts that cannot receive drop-offs", async () => {
    stubFetch([{ match: "/cities/getAllDistricts", respond: () => districtsResponse() }]);
    const loaded = await loadDistricts();
    expect(loaded.map((d) => d.districtId)).toEqual([DISTRICT_ID, "district-maadi"]);
    expect(loaded.some((d) => d.districtId === "district-nodrop")).toBe(false);

    const cities = await getBostaCheckoutLocations();
    expect(cities).toHaveLength(1);
    const ids = cities[0]!.zones.flatMap((z) => z.districts.map((d) => d.districtId));
    expect(ids).not.toContain("district-nodrop");
  });

  it("returns an empty list when Bosta is not configured", async () => {
    clearBostaEnv();
    const { fetchMock } = stubFetch([]);
    expect(await loadDistricts()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes stable ids in the checkout tree", () => {
    const tree = groupDistrictsForCheckout(districts);
    const cairo = tree.find((c) => c.cityName === "Cairo")!;
    expect(cairo.cityId).toBe("cairo-id");
    const nasr = cairo.zones.find((z) => z.zoneId === "zone-nasrcity")!;
    expect(nasr.districts.map((d) => d.districtId).sort()).toEqual(["district-nasrcity-1", "district-nasrcity-2"]);
  });
});

describe("resolveBostaDropOffDistrict", () => {
  it("43. an exact district id resolves and wins over any names", async () => {
    stubFetch([{ match: "/cities/getAllDistricts", respond: () => districtsResponse() }]);
    const result = await resolveBostaDropOffDistrict({
      districtId: "district-maadi",
      city: "Giza",
      zone: "Something else",
    });
    expect(result).toMatchObject({ ok: true, via: "id" });
    if (result.ok) expect(result.entry.districtId).toBe("district-maadi");
  });

  it("fails when the id is unknown instead of guessing", async () => {
    stubFetch([{ match: "/cities/getAllDistricts", respond: () => districtsResponse() }]);
    const result = await resolveBostaDropOffDistrict({ districtId: "nope", city: "Cairo", zone: "15 May" });
    expect(result.ok).toBe(false);
  });

  it("fails when there is neither an id nor a city", async () => {
    stubFetch([{ match: "/cities/getAllDistricts", respond: () => districtsResponse() }]);
    expect((await resolveBostaDropOffDistrict({ city: "" })).ok).toBe(false);
  });
});

describe("findDistrictByNames (legacy orders only)", () => {
  it("matches exact city + zone names", () => {
    const hit = findDistrictByNames(districts, { city: "Cairo", zone: "ElMaadi" });
    expect(hit).toMatchObject({ ok: true, via: "legacy-names" });
    if (hit.ok) expect(hit.entry.districtId).toBe("district-maadi");
  });

  it("tolerates Bosta's inconsistent spacing ('el maadi' vs 'ElMaadi')", () => {
    const hit = findDistrictByNames(districts, { city: "Cairo", zone: "el maadi" });
    if (hit.ok) expect(hit.entry.districtId).toBe("district-maadi");
    else throw new Error(hit.reason);
  });

  it("uses the district hint to disambiguate districts sharing a zone", () => {
    const hit = findDistrictByNames(districts, { city: "Cairo", zone: "Nasr City", districtHint: "ElManteqa El Oula" });
    if (hit.ok) expect(hit.entry.districtId).toBe("district-nasrcity-2");
    else throw new Error(hit.reason);
  });

  it("matches the Arabic district name", () => {
    const hit = findDistrictByNames(districts, { city: "القاهرة", districtHint: "المعادي" });
    if (hit.ok) expect(hit.entry.districtId).toBe("district-maadi");
    else throw new Error(hit.reason);
  });

  it("44. no first-district-in-city fallback when nothing matches", () => {
    const result = findDistrictByNames(districts, { city: "Cairo", zone: "some unknown area" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/select the exact delivery district/);
  });

  it("45. ambiguous names fail instead of picking one", () => {
    const result = findDistrictByNames(districts, { city: "Cairo", districtHint: "Central" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/matches 2/);
  });

  it("46. no cross-Egypt fallback — an unknown city fails even if the area exists elsewhere", () => {
    const result = findDistrictByNames(districts, { city: "Nowhere", zone: "ElMaadi" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a Bosta city/);
  });

  it("does not substring-match ('Nasr' must not resolve to Nasr City)", () => {
    expect(findDistrictByNames(districts, { city: "Cairo", zone: "Nasr" }).ok).toBe(false);
  });

  it("the same area name in two cities resolves per city", () => {
    const giza = findDistrictByNames(districts, { city: "Giza", zone: "ElMaadi" });
    if (giza.ok) expect(giza.entry.districtId).toBe("district-giza-maadi");
    else throw new Error(giza.reason);
  });
});
