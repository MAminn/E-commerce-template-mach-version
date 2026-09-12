import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildBostaCreateDeliveryBody,
  BostaValidationError,
  cancelBostaDelivery,
  createBostaDelivery,
  normalizeEgyptPhone,
  trackBostaDelivery,
  type BostaCreateDeliveryInput,
} from "../service";
import { clearBostaDistrictsCache } from "../districts";
import { clearBostaPickupCache } from "../pickup";
import {
  clearBostaEnv,
  createDeliveryResponse,
  districtsResponse,
  DISTRICT_ID,
  jsonResponse,
  LOCATION_ID,
  ORDER_ID,
  pickupLocationsResponse,
  setBostaEnv,
  stubFetch,
  TEST_API_KEY,
  ZONE_ID,
} from "./test-utils";

const RESOLVED = {
  businessLocationId: LOCATION_ID,
  dropOff: { city: "Cairo", zoneId: ZONE_ID, districtId: DISTRICT_ID },
};

function input(overrides: Partial<BostaCreateDeliveryInput> = {}): BostaCreateDeliveryInput {
  return {
    orderId: ORDER_ID,
    receiver: { firstName: "Ahmed", lastName: "Ali", phone: "01000000000", email: "a@example.com" },
    dropOffAddress: { districtId: DISTRICT_ID, firstLine: "12 Tahrir St" },
    cod: 140,
    goodsAmount: 120,
    notes: "Ring the bell",
    itemsCount: 3,
    description: "2x Shirt, 1x Hat",
    ...overrides,
  };
}

beforeEach(() => {
  setBostaEnv();
  clearBostaDistrictsCache();
  clearBostaPickupCache();
});
afterEach(() => {
  clearBostaEnv();
  vi.unstubAllGlobals();
});

describe("normalizeEgyptPhone", () => {
  it("accepts a plain 01XXXXXXXXX number", () => {
    expect(normalizeEgyptPhone("01000000000")).toEqual({ ok: true, phone: "01000000000" });
  });

  it("31. normalises +20 numbers", () => {
    expect(normalizeEgyptPhone("+201000000000")).toEqual({ ok: true, phone: "01000000000" });
    expect(normalizeEgyptPhone("201000000000")).toEqual({ ok: true, phone: "01000000000" });
  });

  it("32. normalises 0020 numbers", () => {
    expect(normalizeEgyptPhone("00201000000000")).toEqual({ ok: true, phone: "01000000000" });
  });

  it("strips spaces, dashes and brackets", () => {
    expect(normalizeEgyptPhone("+20 (10) 0000-0000")).toEqual({ ok: true, phone: "01000000000" });
    expect(normalizeEgyptPhone("010 0000 0000")).toEqual({ ok: true, phone: "01000000000" });
  });

  it("30. rejects invalid numbers", () => {
    expect(normalizeEgyptPhone("0100000000").ok).toBe(false); // 10 digits
    expect(normalizeEgyptPhone("02000000000").ok).toBe(false); // landline prefix
    expect(normalizeEgyptPhone("abc").ok).toBe(false);
    expect(normalizeEgyptPhone("").ok).toBe(false);
    expect(normalizeEgyptPhone("+4915112345678").ok).toBe(false);
  });
});

describe("buildBostaCreateDeliveryBody", () => {
  it("25/26/27. sends businessLocationId + uniqueBusinessReference and no pickupAddress", () => {
    const body = buildBostaCreateDeliveryBody(input(), RESOLVED);
    expect(body.type).toBe(10);
    expect(body.businessLocationId).toBe(LOCATION_ID);
    expect(body.businessReference).toBe(ORDER_ID);
    expect(body.uniqueBusinessReference).toBe(ORDER_ID);
    expect(body).not.toHaveProperty("pickupAddress");
    expect(body.specs).toEqual({
      packageType: "Parcel",
      size: "SMALL",
      packageDetails: { itemsCount: 3, description: "2x Shirt, 1x Hat" },
    });
    expect(body.receiver).toEqual({
      firstName: "Ahmed",
      lastName: "Ali",
      phone: "01000000000",
      email: "a@example.com",
    });
    expect(body.dropOffAddress).toEqual({
      city: "Cairo",
      zoneId: ZONE_ID,
      districtId: DISTRICT_ID,
      firstLine: "12 Tahrir St",
    });
    expect(body.goodsInfo).toEqual({ amount: 120 });
    expect(body.notes).toBe("Ring the bell");
  });

  it("uniqueBusinessReference defaults to the order id and is otherwise sent verbatim; businessReference never changes", () => {
    const initial = buildBostaCreateDeliveryBody(input(), RESOLVED);
    expect(initial.uniqueBusinessReference).toBe(ORDER_ID);
    const resend = buildBostaCreateDeliveryBody(
      input({ uniqueBusinessReference: `${ORDER_ID}:resend:5108002` }),
      RESOLVED,
    );
    expect(resend.uniqueBusinessReference).toBe(`${ORDER_ID}:resend:5108002`);
    expect(resend.businessReference).toBe(ORDER_ID);
    expect(initial.businessReference).toBe(ORDER_ID);
  });

  it("28/29. COD amount is passed through as given (order total for COD, 0 for prepaid)", () => {
    expect(buildBostaCreateDeliveryBody(input({ cod: 140 }), RESOLVED).cod).toBe(140);
    expect(buildBostaCreateDeliveryBody(input({ cod: 0 }), RESOLVED).cod).toBe(0);
    expect(buildBostaCreateDeliveryBody(input({ cod: 99.6 }), RESOLVED).cod).toBe(100);
  });

  it("30. rejects a bad phone with a clear validation error", () => {
    expect(() =>
      buildBostaCreateDeliveryBody(
        input({ receiver: { firstName: "A", lastName: "B", phone: "12345" } }),
        RESOLVED,
      ),
    ).toThrow(BostaValidationError);
  });

  it("33. never fabricates building / floor / apartment / secondLine", () => {
    const body = buildBostaCreateDeliveryBody(
      input({ dropOffAddress: { districtId: DISTRICT_ID, firstLine: "12 Tahrir St", secondLine: "12 Tahrir St" } }),
      RESOLVED,
    );
    expect(body.dropOffAddress).not.toHaveProperty("buildingNumber");
    expect(body.dropOffAddress).not.toHaveProperty("floor");
    expect(body.dropOffAddress).not.toHaveProperty("apartment");
    expect(body.dropOffAddress).not.toHaveProperty("secondLine");

    const withParts = buildBostaCreateDeliveryBody(
      input({
        dropOffAddress: {
          districtId: DISTRICT_ID,
          firstLine: "12 Tahrir St",
          buildingNumber: "5",
          apartment: "3",
          secondLine: "Near the mosque",
        },
      }),
      RESOLVED,
    );
    expect(withParts.dropOffAddress).toMatchObject({
      buildingNumber: "5",
      apartment: "3",
      secondLine: "Near the mosque",
    });
    expect(withParts.dropOffAddress).not.toHaveProperty("floor");
  });

  it("34. rejects a short firstLine", () => {
    expect(() =>
      buildBostaCreateDeliveryBody(input({ dropOffAddress: { districtId: DISTRICT_ID, firstLine: "Giza" } }), RESOLVED),
    ).toThrow(/too short/);
  });

  it("falls back to the first name when the customer has a single-word name", () => {
    const body = buildBostaCreateDeliveryBody(
      input({ receiver: { firstName: "Ahmed", lastName: "", phone: "01000000000" } }),
      RESOLVED,
    );
    expect(body.receiver.lastName).toBe("Ahmed");
  });

  it("omits goodsInfo when there is no positive merchandise value", () => {
    expect(buildBostaCreateDeliveryBody(input({ goodsAmount: 0 }), RESOLVED)).not.toHaveProperty("goodsInfo");
    expect(buildBostaCreateDeliveryBody(input({ goodsAmount: null }), RESOLVED)).not.toHaveProperty("goodsInfo");
  });
});

describe("createBostaDelivery (mocked fetch)", () => {
  it("23/24. POSTs to /deliveries?apiVersion=1 with the exact Authorization header", async () => {
    const { calls } = stubFetch([
      { match: "/cities/getAllDistricts", respond: () => districtsResponse() },
      { match: "/pickup-locations", respond: () => pickupLocationsResponse([{ _id: LOCATION_ID, isDefault: true }]) },
      { match: "/deliveries?apiVersion=1", respond: () => createDeliveryResponse() },
    ]);

    const outcome = await createBostaDelivery(input());
    expect(outcome).toEqual({
      success: true,
      result: {
        deliveryId: "Lx9vyKBqAeiIcERQKfn6I",
        trackingNumber: "5108002",
        stateCode: 10,
        stateValue: "Pickup requested",
      },
    });

    const create = calls.find((c) => c.url.includes("/deliveries?apiVersion=1"))!;
    expect(create.url).toBe("https://app.bosta.co/api/v2/deliveries?apiVersion=1");
    expect(create.init?.method).toBe("POST");
    const headers = create.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(TEST_API_KEY);
    expect(String(headers.Authorization).startsWith("Bearer")).toBe(false);

    const body = JSON.parse(String(create.init?.body));
    expect(body.businessLocationId).toBe(LOCATION_ID);
    expect(body.uniqueBusinessReference).toBe(ORDER_ID);
    expect(body).not.toHaveProperty("pickupAddress");
    expect(body.dropOffAddress).toMatchObject({ city: "Cairo", zoneId: ZONE_ID, districtId: DISTRICT_ID });

    // Every call carried the raw key.
    for (const c of calls) {
      expect((c.init?.headers as Record<string, string>).Authorization).toBe(TEST_API_KEY);
    }
  });

  it("returns a validation failure (no network call) when the district cannot be resolved", async () => {
    const { calls } = stubFetch([
      { match: "/cities/getAllDistricts", respond: () => districtsResponse() },
    ]);
    const outcome = await createBostaDelivery(
      input({ dropOffAddress: { districtId: "does-not-exist", firstLine: "12 Tahrir St" } }),
    );
    expect(outcome).toMatchObject({ success: false, kind: "validation" });
    expect(calls.some((c) => c.url.includes("/deliveries"))).toBe(false);
  });

  it("returns a validation failure for an invalid phone without calling Bosta", async () => {
    const { calls } = stubFetch([
      { match: "/cities/getAllDistricts", respond: () => districtsResponse() },
      { match: "/pickup-locations", respond: () => pickupLocationsResponse([{ _id: LOCATION_ID, isDefault: true }]) },
    ]);
    const outcome = await createBostaDelivery(
      input({ receiver: { firstName: "A", lastName: "B", phone: "123" } }),
    );
    expect(outcome).toMatchObject({ success: false, kind: "validation" });
    expect(calls.some((c) => c.url.includes("/deliveries"))).toBe(false);
  });

  it("surfaces Bosta API errors as a failed outcome", async () => {
    stubFetch([
      { match: "/cities/getAllDistricts", respond: () => districtsResponse() },
      { match: "/pickup-locations", respond: () => pickupLocationsResponse([{ _id: LOCATION_ID, isDefault: true }]) },
      {
        match: "/deliveries?apiVersion=1",
        respond: () =>
          jsonResponse({ success: false, message: "You should have a business location before creating an order", errorCode: 1073 }, 400),
      },
    ]);
    const outcome = await createBostaDelivery(input());
    expect(outcome).toMatchObject({ success: false, kind: "api" });
    expect((outcome as { error: string }).error).toMatch(/business location/);
  });

  it("returns null when Bosta is not configured", async () => {
    clearBostaEnv();
    const { fetchMock } = stubFetch([]);
    expect(await createBostaDelivery(input())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cancelBostaDelivery", () => {
  it("35. terminates by tracking number via DELETE /deliveries/business/{tn}/terminate", async () => {
    const { calls } = stubFetch([
      { match: "/terminate", respond: () => jsonResponse({ success: true, message: "Delivery has been terminated successfully.", data: { _id: "x" } }) },
    ]);
    expect(await cancelBostaDelivery("5108002")).toEqual({ success: true });
    expect(calls[0]!.url).toBe("https://app.bosta.co/api/v2/deliveries/business/5108002/terminate");
    expect(calls[0]!.init?.method).toBe("DELETE");
  });

  it("flags a 403 (Read/Write key) as permissionDenied with a dashboard hint", async () => {
    stubFetch([
      { match: "/terminate", respond: () => jsonResponse({ success: false, message: "Access to the requested resource is forbidden", errorCode: 1008 }, 403) },
    ]);
    const outcome = await cancelBostaDelivery("5108002");
    expect(outcome).toMatchObject({ success: false, permissionDenied: true });
    expect((outcome as { error: string }).error).toMatch(/Full Access/);
  });

  it("fails clearly without a tracking number", async () => {
    const { fetchMock } = stubFetch([]);
    expect(await cancelBostaDelivery("  ")).toMatchObject({ success: false, permissionDenied: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("trackBostaDelivery", () => {
  it("36. reads GET /deliveries/business/{tn}", async () => {
    const { calls } = stubFetch([
      { match: "/deliveries/business/5108002", respond: () => jsonResponse({ success: true, data: { state: { code: 41, value: "Picked up" }, updatedAt: "x" } }) },
    ]);
    expect(await trackBostaDelivery("5108002")).toEqual({ stateCode: 41, stateValue: "Picked up", updatedAt: "x" });
    expect(calls[0]!.url).toBe("https://app.bosta.co/api/v2/deliveries/business/5108002");
    expect(calls[0]!.init?.method).toBe("GET");
  });
});
