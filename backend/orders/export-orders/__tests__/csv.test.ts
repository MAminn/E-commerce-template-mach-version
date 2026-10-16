import { describe, expect, it } from "vitest";
import { parseCsv } from "#root/shared/utils/csv";
import {
  CSV_BOM,
  ORDER_EXPORT_COLUMNS,
  buildingDetails,
  csvCell,
  csvHeaderRow,
  csvOrderRow,
  exportFileName,
  formatCairoDateTime,
  splitItemName,
  type ExportOrderItemRow,
  type ExportOrderRow,
} from "../csv";

const baseOrder: ExportOrderRow = {
  id: "019a0000-0000-7000-8000-00000000abcd",
  reference: "ORD-0000ABCD",
  createdAt: new Date("2026-10-16T09:30:15.000Z"),
  updatedAt: null,
  status: "pending",
  paymentMethod: "cod",
  paymentStatus: "not_required",
  paymentTransactionId: null,
  providerPaymentMethod: null,
  currency: "EGP",
  customerName: "Test Customer",
  customerPhone: "01012345678",
  accountPhone: null,
  customerEmail: "c@example.com",
  shippingState: "Cairo",
  shippingCity: "Nasr City / 8th District",
  shippingDistrict: "bosta:dist123",
  shippingAddress: "12 Abbas El Akkad St (Bldg 5, Apt 12)",
  shippingPostalCode: "",
  shippingCountry: "Egypt",
  subtotal: "1500.00",
  discount: null,
  promoCode: null,
  shipping: "60.00",
  tax: "0.00",
  total: "1560.00",
  notes: null,
  bostaSyncStatus: null,
  bostaTrackingNumber: null,
  bostaDeliveryId: null,
  bostaStatus: null,
  bostaStatusCode: null,
  bostaStatusUpdatedAt: null,
  bostaSyncError: null,
  bostaWebhookData: null,
  fulfillmentHold: null,
  fulfillmentHoldNote: null,
  archivedAt: null,
};

const item = (over: Partial<ExportOrderItemRow> = {}): ExportOrderItemRow => ({
  orderId: baseOrder.id,
  name: "Whey Protein",
  productName: "Whey Protein",
  sku: "WP-01",
  quantity: 1,
  price: "1500.00",
  discountPrice: null,
  ...over,
});

/** Parses one exported row back into { header: value }. */
function roundTrip(order: ExportOrderRow, items: ExportOrderItemRow[]) {
  const text = CSV_BOM + csvHeaderRow() + csvOrderRow(order, items);
  const { records, errors } = parseCsv(text);
  expect(errors).toEqual([]);
  expect(records).toHaveLength(2);
  const [header, row] = records;
  return Object.fromEntries(header!.fields.map((h, i) => [h, row!.fields[i]]));
}

describe("csvCell", () => {
  it("quotes and doubles quotes, keeps commas and newlines inside the cell", () => {
    expect(csvCell('He said "hi", then\nleft')).toBe('"He said ""hi"", then\nleft"');
  });

  it("neutralises formula triggers on every line", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+cmd")).toBe(`"'+cmd"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("-2+3")).toBe(`"'-2+3"`);
    expect(csvCell("\tx")).toBe(`"'\tx"`);
    expect(csvCell("ok\n=1+1")).toBe(`"ok\n'=1+1"`);
  });

  it("passes stored decimals through untouched", () => {
    expect(csvCell("1560.00")).toBe('"1560.00"');
    expect(csvCell("-5.50")).toBe('"-5.50"');
    expect(csvCell(3)).toBe('"3"');
  });

  it("writes number-like identifiers as Excel text so leading zeros survive", () => {
    expect(csvCell({ text: "01012345678" })).toBe('"=""01012345678"""');
    expect(csvCell({ text: "+20 101 234 5678" })).toBe('"=""+20 101 234 5678"""');
    expect(csvCell({ text: "" })).toBe('""');
    // Anything else is ordinary (guarded) text — no way out of ="…".
    expect(csvCell({ text: '0101"),=cmd(' })).toBe(`"0101""),=cmd("`);
    expect(csvCell({ text: "=1+1" })).toBe(`"'=1+1"`);
  });

  it("writes null/undefined as empty", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });
});

describe("helpers", () => {
  it("formats dates in Cairo time", () => {
    // 09:30 UTC is 12:30 in Cairo (UTC+3, summer time) on 2026-10-16.
    expect(formatCairoDateTime(new Date("2026-10-16T09:30:15Z"))).toBe("2026-10-16 12:30:15");
    expect(formatCairoDateTime(null)).toBe("");
  });

  it("names the file after the Cairo date", () => {
    expect(exportFileName(new Date("2026-10-16T09:00:00Z"))).toBe("MACH_Orders_2026-10-16.csv");
    // 22:30 UTC on the 15th is already the 16th in Cairo.
    expect(exportFileName(new Date("2026-10-15T22:30:00Z"))).toBe("MACH_Orders_2026-10-16.csv");
  });

  it("extracts the checkout's building/apartment suffix only", () => {
    expect(buildingDetails("12 St (Bldg 5, Apt 12)")).toBe("Bldg 5, Apt 12");
    expect(buildingDetails("12 St (Bldg 5)")).toBe("Bldg 5");
    expect(buildingDetails("12 St (Apt 3)")).toBe("Apt 3");
    expect(buildingDetails("Villa (near the mosque)")).toBe("");
  });

  it("splits a variant only off the product's own name", () => {
    expect(splitItemName({ name: "Whey (Chocolate / 2kg)", productName: "Whey" })).toEqual({
      name: "Whey",
      variant: "Chocolate / 2kg",
    });
    expect(splitItemName({ name: "Creatine (Monohydrate)", productName: "Creatine (Monohydrate)" })).toEqual({
      name: "Creatine (Monohydrate)",
      variant: "",
    });
    // Product renamed since — keep what was stored, guess nothing.
    expect(splitItemName({ name: "Old Name (Red)", productName: "New Name" })).toEqual({
      name: "Old Name (Red)",
      variant: "",
    });
    expect(splitItemName({ name: "Gone (Red)", productName: null })).toEqual({
      name: "Gone (Red)",
      variant: "",
    });
  });
});

describe("csvOrderRow", () => {
  it("has a cell for every header", () => {
    const { records } = parseCsv(csvHeaderRow() + csvOrderRow(baseOrder, [item()]));
    expect(records[0]!.fields).toHaveLength(ORDER_EXPORT_COLUMNS.length);
    expect(records[1]!.fields).toHaveLength(ORDER_EXPORT_COLUMNS.length);
  });

  it("exports a single-product order with stored money values as-is", () => {
    const row = roundTrip(baseOrder, [item()]);
    expect(row["Order Number"]).toBe("#0000ABCD");
    expect(row["Order ID"]).toBe(baseOrder.id);
    expect(row["Created At (Cairo)"]).toBe("2026-10-16 12:30:15");
    expect(row["Payment Method"]).toBe("Cash on Delivery");
    expect(row["Payment Status"]).toBe("Not required");
    expect(row.Phone).toBe('="01012345678"');
    expect(row.Governorate).toBe("Cairo");
    expect(row["City / Area"]).toBe("Nasr City / 8th District");
    expect(row.District).toBe("");
    expect(row["Bosta District ID"]).toBe("dist123");
    expect(row["Building / Apartment"]).toBe("Bldg 5, Apt 12");
    expect(row["Line Items"]).toBe("1");
    expect(row["Product Names"]).toBe("Whey Protein");
    expect(row.SKUs).toBe("WP-01");
    expect(row["Line Totals"]).toBe("1500.00");
    expect(row.Subtotal).toBe("1500.00");
    expect(row.Discount).toBe("");
    expect(row["Shipping Fee"]).toBe("60.00");
    expect(row["Order Total"]).toBe("1560.00");
  });

  it("keeps every item of a multi-product order in one row, totals once", () => {
    const row = roundTrip(
      { ...baseOrder, subtotal: "2350.00", discount: "235.00", promoCode: "MACH10", total: "2175.00" },
      [
        item({ name: "Whey Protein (Chocolate, 2kg)", quantity: 2, price: "1000.00", discountPrice: "900.00" }),
        item({ name: "Creatine", productName: "Creatine", sku: null, quantity: 1, price: "550.00" }),
      ],
    );
    expect(row["Line Items"]).toBe("2");
    expect(row["Total Quantity"]).toBe("3");
    expect(row["Product Names"]).toBe("Whey Protein\nCreatine");
    expect(row.Variants).toBe("Chocolate, 2kg\n");
    expect(row.SKUs).toBe("WP-01\n");
    expect(row.Quantities).toBe("2\n1");
    expect(row["Unit Prices"]).toBe("900.00\n550.00");
    expect(row["Regular Unit Prices"]).toBe("1000.00\n550.00");
    expect(row["Line Totals"]).toBe("1800.00\n550.00");
    expect(row.Subtotal).toBe("2350.00");
    expect(row.Discount).toBe("235.00");
    expect(row["Promo Code"]).toBe("MACH10");
    expect(row["Order Total"]).toBe("2175.00");
  });

  it("round-trips Arabic names, addresses and notes", () => {
    const row = roundTrip(
      {
        ...baseOrder,
        customerName: "محمد أحمد",
        shippingState: "القاهرة",
        shippingCity: "مدينة نصر",
        shippingAddress: "١٢ شارع عباس العقاد، الدور الثالث (Bldg ٥, Apt ١٢)",
        notes: "اتصل قبل التوصيل, من فضلك\n\"شكرا\"",
      },
      [item({ name: "واي بروتين (شوكولاتة)", productName: "واي بروتين" })],
    );
    expect(row["Customer Name"]).toBe("محمد أحمد");
    expect(row.Governorate).toBe("القاهرة");
    expect(row["City / Area"]).toBe("مدينة نصر");
    expect(row["Shipping Address"]).toBe("١٢ شارع عباس العقاد، الدور الثالث (Bldg ٥, Apt ١٢)");
    expect(row["Building / Apartment"]).toBe("Bldg ٥, Apt ١٢");
    expect(row["Customer Notes"]).toBe('اتصل قبل التوصيل, من فضلك\n"شكرا"');
    expect(row["Product Names"]).toBe("واي بروتين");
    expect(row.Variants).toBe("شوكولاتة");
  });

  it("guards customer-controlled text against formula injection", () => {
    const row = roundTrip(
      { ...baseOrder, customerName: "=cmd|' /C calc'!A0", notes: "@SUM(1+1)" },
      [item({ name: "+HYPERLINK(x)", productName: null })],
    );
    expect(row["Customer Name"]).toBe("'=cmd|' /C calc'!A0");
    expect(row["Customer Notes"]).toBe("'@SUM(1+1)");
    expect(row["Product Names"]).toBe("'+HYPERLINK(x)");
  });

  it("exports Bosta shipment details and a differing account phone", () => {
    const row = roundTrip(
      {
        ...baseOrder,
        accountPhone: "01198765432",
        paymentMethod: "fawaterak",
        paymentStatus: "paid",
        paymentTransactionId: "123456789012",
        providerPaymentMethod: "Card",
        bostaSyncStatus: "sent",
        bostaTrackingNumber: "7234567890",
        bostaDeliveryId: "abc123",
        bostaStatus: "Delivered",
        bostaStatusCode: "45",
        bostaWebhookData: { exceptionReason: "Customer not answering", numberOfAttempts: 2 },
      },
      [item()],
    );
    expect(row["Account Phone (if different)"]).toBe('="01198765432"');
    expect(row["Payment Method"]).toBe("Online (Fawaterak)");
    expect(row["Payment Status"]).toBe("Paid");
    expect(row["Payment Transaction ID"]).toBe('="123456789012"');
    expect(row["Gateway Payment Type"]).toBe("Card");
    expect(row["Bosta Tracking Number"]).toBe('="7234567890"');
    expect(row["Bosta Delivery ID"]).toBe("abc123");
    expect(row["Bosta Shipment Status"]).toBe("Delivered");
    expect(row["Bosta Exception Reason"]).toBe("Customer not answering");
    expect(row["Bosta Delivery Attempts"]).toBe("2");
  });

  it("leaves the account phone empty when it matches the order phone", () => {
    const row = roundTrip({ ...baseOrder, accountPhone: "01012345678" }, [item()]);
    expect(row["Account Phone (if different)"]).toBe("");
  });

  it("never includes payment session or gateway payloads", () => {
    const headers = ORDER_EXPORT_COLUMNS.map((c) => c.header.toLowerCase()).join("|");
    expect(headers).not.toMatch(/session|gateway data|intent|password|token|secret/);
  });
});
