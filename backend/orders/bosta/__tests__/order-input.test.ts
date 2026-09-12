import { describe, expect, it } from "vitest";
import {
  buildBostaInputFromOrder,
  computeCodAmount,
  computeUniqueBusinessReference,
  computeGoodsAmount,
  parseStoredShippingAddress,
  splitCustomerName,
  summarizeItems,
} from "../order-input";
import { DISTRICT_ID, makeOrderRow, ORDER_ID } from "./test-utils";

const items = [
  { name: "Shirt", quantity: 2 },
  { name: "Hat", quantity: 1 },
];

describe("buildBostaInputFromOrder (canonical builder)", () => {
  it("maps a COD order row into the delivery input from trusted DB values", () => {
    const result = buildBostaInputFromOrder(makeOrderRow() as never, items);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toEqual({
      orderId: ORDER_ID,
      uniqueBusinessReference: ORDER_ID,
      receiver: { firstName: "Ahmed", lastName: "Ali", phone: "01000000000", email: "ahmed@example.com" },
      dropOffAddress: {
        districtId: DISTRICT_ID,
        city: "Cairo",
        zone: "15 May",
        districtHint: null,
        firstLine: "12 Tahrir St",
        buildingNumber: "5",
        apartment: "3",
      },
      cod: 140,
      goodsAmount: 120,
      notes: null,
      itemsCount: 3,
      description: "2x Shirt, 1x Hat",
    });
  });

  it("28. COD = trusted DB order total for cash orders", () => {
    expect(computeCodAmount({ paymentMethod: "cod", total: "140.00" })).toBe(140);
    const r = buildBostaInputFromOrder(makeOrderRow({ total: "999.50" }) as never, items);
    if (r.ok) expect(r.input.cod).toBe(999.5);
  });

  it("29. COD = 0 for every prepaid method", () => {
    for (const method of ["stripe", "paymob", "fawaterak"]) {
      expect(computeCodAmount({ paymentMethod: method as never, total: "140.00" })).toBe(0);
      const r = buildBostaInputFromOrder(makeOrderRow({ paymentMethod: method, paymentStatus: "paid" }) as never, items);
      if (r.ok) expect(r.input.cod, method).toBe(0);
    }
  });

  it("goods amount = subtotal − discount (never shipping, never negative)", () => {
    expect(computeGoodsAmount({ subtotal: "130.00", discount: "10.00" })).toBe(120);
    expect(computeGoodsAmount({ subtotal: "130.00", discount: null })).toBe(130);
    expect(computeGoodsAmount({ subtotal: "10.00", discount: "50.00" })).toBe(0);
  });

  it("uses the same city/zone routing regardless of caller (governorate = Bosta city)", () => {
    const r = buildBostaInputFromOrder(
      makeOrderRow({ shippingDistrict: "", shippingState: "Giza", shippingCity: "6 October" }) as never,
      items,
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.dropOffAddress).toMatchObject({ districtId: null, city: "Giza", zone: "6 October", districtHint: null });
  });

  it("keeps legacy free-text shipping_district as a hint (not an id)", () => {
    const r = buildBostaInputFromOrder(makeOrderRow({ shippingDistrict: "ElMaadi" }) as never, items);
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.dropOffAddress.districtId).toBeNull();
    expect(r.input.dropOffAddress.districtHint).toBe("ElMaadi");
  });

  it("fails without a customer name", () => {
    expect(buildBostaInputFromOrder(makeOrderRow({ customerName: "  " }) as never, items).ok).toBe(false);
  });
});

describe("computeUniqueBusinessReference", () => {
  it("initial = order id; resend = deterministic key from the terminated delivery", () => {
    expect(computeUniqueBusinessReference(ORDER_ID)).toBe(ORDER_ID);
    expect(computeUniqueBusinessReference(ORDER_ID, null)).toBe(ORDER_ID);
    expect(computeUniqueBusinessReference(ORDER_ID, "  ")).toBe(ORDER_ID);
    expect(computeUniqueBusinessReference(ORDER_ID, "5108002")).toBe(`${ORDER_ID}:resend:5108002`);
    expect(computeUniqueBusinessReference(ORDER_ID, "5108002")).toBe(
      computeUniqueBusinessReference(ORDER_ID, " 5108002 "),
    );
    expect(computeUniqueBusinessReference(ORDER_ID, "A")).not.toBe(computeUniqueBusinessReference(ORDER_ID, "B"));
  });

  it("the builder threads previousTrackingNumber through and keeps orderId as businessReference", () => {
    const r = buildBostaInputFromOrder(makeOrderRow() as never, items, { previousTrackingNumber: "A" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.input.orderId).toBe(ORDER_ID);
    expect(r.input.uniqueBusinessReference).toBe(`${ORDER_ID}:resend:A`);
  });
});

describe("helpers", () => {
  it("splitCustomerName", () => {
    expect(splitCustomerName("Ahmed Mohamed Ali")).toEqual({ firstName: "Ahmed", lastName: "Mohamed Ali" });
    expect(splitCustomerName("Ahmed")).toEqual({ firstName: "Ahmed", lastName: "" });
  });

  it("parseStoredShippingAddress recovers what create-order stored (nothing invented)", () => {
    expect(parseStoredShippingAddress("12 Tahrir St (Bldg 5, Apt 3)")).toEqual({ street: "12 Tahrir St", buildingNumber: "5", apartment: "3" });
    expect(parseStoredShippingAddress("12 Tahrir St (Bldg 5)")).toEqual({ street: "12 Tahrir St", buildingNumber: "5", apartment: undefined });
    expect(parseStoredShippingAddress("12 Tahrir St (Apt 3)")).toEqual({ street: "12 Tahrir St", buildingNumber: undefined, apartment: "3" });
    expect(parseStoredShippingAddress("12 Tahrir St")).toEqual({ street: "12 Tahrir St" });
    expect(parseStoredShippingAddress("Villa 3 (near the club)")).toEqual({ street: "Villa 3 (near the club)" });
  });

  it("summarizeItems", () => {
    expect(summarizeItems(items)).toEqual({ itemsCount: 3, description: "2x Shirt, 1x Hat" });
    expect(summarizeItems([])).toEqual({ itemsCount: 1, description: "Online store order" });
  });
});
