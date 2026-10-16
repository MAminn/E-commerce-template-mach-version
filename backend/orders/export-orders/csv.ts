/**
 * Orders → CSV, pure (no I/O). One row per order; an order's line items share
 * that row as parallel newline-separated lists (names, SKUs, variants, …), so
 * the order's money totals appear exactly once.
 *
 * Every value is copied from the stored order — totals are never recomputed.
 * The only derived numbers are each line's total (unit × quantity, in cents)
 * and the item counts.
 */
import { displayOrderNumber } from "#root/shared/orders/order-reference";

/** Excel needs a BOM to read UTF-8 (Arabic names/addresses) correctly. */
export const CSV_BOM = "﻿";
const CSV_EOL = "\r\n";
const LIST_SEPARATOR = "\n";

/** Cell kinds that change how a value is written. */
type Cell =
  | string
  | number
  | null
  | undefined
  /** A number-like identifier (phone, tracking number) Excel must keep as text. */
  | { text: string };

const SAFE_NUMBER = /^-?\d+(\.\d+)?$/;
/** Digits and phone punctuation only — nothing that can break out of ="…". */
const TEXT_ID_SAFE = /^[0-9+\-\s()]+$/;
/** Leading characters spreadsheet apps treat as the start of a formula. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * One CSV cell, always quoted.
 *  - Text starting with = + - @ or a tab/CR gets a leading apostrophe so a
 *    customer-typed "=HYPERLINK(…)" stays inert (CSV formula injection).
 *  - Plain decimals (stored money values) pass through as numbers.
 *  - `{ text }` identifiers made only of digits/phone punctuation are written as
 *    ="0101…" — Excel otherwise drops the leading zero of an Egyptian phone and
 *    turns long tracking numbers into 1.2E+10.
 */
export function csvCell(value: Cell): string {
  let out: string;
  if (value === null || value === undefined) {
    out = "";
  } else if (typeof value === "number") {
    out = Number.isFinite(value) ? String(value) : "";
  } else if (typeof value === "object") {
    const text = value.text.trim();
    if (text === "") out = "";
    else if (TEXT_ID_SAFE.test(text)) out = `="${text}"`;
    else out = guardFormula(text);
  } else {
    out = SAFE_NUMBER.test(value) ? value : guardFormula(value);
  }
  return `"${out.replace(/"/g, '""')}"`;
}

function guardFormula(text: string): string {
  // Every line, not just the first — some importers split on embedded newlines.
  return text
    .split("\n")
    .map((line) => (FORMULA_TRIGGER.test(line) ? `'${line}` : line))
    .join("\n");
}

export function csvRow(cells: Cell[]): string {
  return cells.map(csvCell).join(",") + CSV_EOL;
}

// ─── Source rows ──────────────────────────────────────────────────────────────

export interface ExportOrderRow {
  id: string;
  reference: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  paymentTransactionId: string | null;
  providerPaymentMethod: string | null;
  currency: string;
  customerName: string;
  customerPhone: string;
  accountPhone: string | null;
  customerEmail: string;
  shippingState: string;
  shippingCity: string;
  shippingDistrict: string;
  shippingAddress: string;
  shippingPostalCode: string;
  shippingCountry: string;
  subtotal: string;
  discount: string | null;
  promoCode: string | null;
  shipping: string;
  tax: string;
  total: string;
  notes: string | null;
  bostaSyncStatus: string | null;
  bostaTrackingNumber: string | null;
  bostaDeliveryId: string | null;
  bostaStatus: string | null;
  bostaStatusCode: string | null;
  bostaStatusUpdatedAt: Date | null;
  bostaSyncError: string | null;
  bostaWebhookData: unknown;
  fulfillmentHold: string | null;
  fulfillmentHoldNote: string | null;
  archivedAt: Date | null;
}

export interface ExportOrderItemRow {
  orderId: string;
  /** Stored at order time — "Product" or "Product (selected options)". */
  name: string;
  /** Current catalogue name, used only to split the variant off `name`. */
  productName: string | null;
  sku: string | null;
  quantity: number;
  price: string;
  discountPrice: string | null;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

const STORE_TIME_ZONE = "Africa/Cairo";

const cairoDateTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: STORE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** "2026-10-16 14:05:09" in Cairo time — a format Excel reads as a date. */
export function formatCairoDateTime(date: Date | null | undefined): string {
  if (!date) return "";
  const parts = Object.fromEntries(
    cairoDateTime.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** "2026-10-16" in Cairo time, for the file name. */
export function cairoDateStamp(date: Date): string {
  return formatCairoDateTime(date).slice(0, 10);
}

export function exportFileName(now: Date): string {
  return `MACH_Orders_${cairoDateStamp(now)}.csv`;
}

// Same wording as the Orders dashboard.
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod: "Cash on Delivery",
  stripe: "Card (Stripe)",
  paymob: "Online (Paymob)",
  fawaterak: "Online (Fawaterak)",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  not_required: "Not required",
  pending: "Awaiting payment",
  processing: "Processing",
  paid: "Paid",
  failed: "Payment failed",
  refunded: "Refunded",
};

/** Checkout stores building/apartment as a trailing "(Bldg 5, Apt 12)". */
const BUILDING_SUFFIX = /\((?:Bldg [^,()]+(?:, Apt [^,()]+)?|Apt [^,()]+)\)\s*$/;

export function buildingDetails(address: string): string {
  const match = address.match(BUILDING_SUFFIX);
  return match ? match[0].trim().slice(1, -1) : "";
}

/**
 * Splits the stored "Product (options)" line name. Only when the product's
 * current name is a prefix — otherwise (renamed product, or a name that just
 * contains parentheses) the stored name is kept whole and no variant is
 * guessed.
 */
export function splitItemName(item: Pick<ExportOrderItemRow, "name" | "productName">): {
  name: string;
  variant: string;
} {
  const base = item.productName;
  if (base && item.name.startsWith(`${base} (`) && item.name.endsWith(")")) {
    return { name: base, variant: item.name.slice(base.length + 2, -1) };
  }
  return { name: item.name, variant: "" };
}

/** Same rule the dashboard uses to show an item's price. */
function unitPrice(item: Pick<ExportOrderItemRow, "price" | "discountPrice">): string {
  return item.discountPrice || item.price;
}

function toCents(decimal: string): number {
  return Math.round(Number.parseFloat(decimal) * 100);
}

function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function webhookDetails(data: unknown) {
  const webhook = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  return {
    exceptionReason:
      typeof webhook?.exceptionReason === "string" ? webhook.exceptionReason : null,
    attempts:
      typeof webhook?.numberOfAttempts === "number" ? webhook.numberOfAttempts : null,
  };
}

/** Joins per-item values into one cell, one line per item. */
const list = (values: string[]) => values.join(LIST_SEPARATOR);

// ─── Columns ──────────────────────────────────────────────────────────────────

interface Column {
  header: string;
  value: (order: ExportOrderRow, items: ExportOrderItemRow[]) => Cell;
}

export const ORDER_EXPORT_COLUMNS: Column[] = [
  // Order
  { header: "Order Number", value: (o) => displayOrderNumber(o) },
  { header: "Order ID", value: (o) => o.id },
  { header: "Created At (Cairo)", value: (o) => formatCairoDateTime(o.createdAt) },
  { header: "Updated At (Cairo)", value: (o) => formatCairoDateTime(o.updatedAt) },
  { header: "Order Status", value: (o) => o.status },
  { header: "Payment Method", value: (o) => PAYMENT_METHOD_LABELS[o.paymentMethod] ?? o.paymentMethod },
  { header: "Payment Status", value: (o) => PAYMENT_STATUS_LABELS[o.paymentStatus] ?? o.paymentStatus },
  { header: "Gateway Payment Type", value: (o) => o.providerPaymentMethod },
  { header: "Payment Transaction ID", value: (o) => ({ text: o.paymentTransactionId ?? "" }) },
  { header: "Currency", value: (o) => o.currency },
  // Customer
  { header: "Customer Name", value: (o) => o.customerName },
  { header: "Phone", value: (o) => ({ text: o.customerPhone }) },
  {
    header: "Account Phone (if different)",
    value: (o) => ({
      text: o.accountPhone && o.accountPhone.trim() !== o.customerPhone.trim() ? o.accountPhone : "",
    }),
  },
  { header: "Email", value: (o) => o.customerEmail },
  // Shipping
  { header: "Governorate", value: (o) => o.shippingState },
  { header: "City / Area", value: (o) => o.shippingCity },
  {
    // Free-text district from older checkouts; Bosta picks are a reference.
    header: "District",
    value: (o) => (o.shippingDistrict.startsWith("bosta:") ? "" : o.shippingDistrict),
  },
  {
    header: "Bosta District ID",
    value: (o) => (o.shippingDistrict.startsWith("bosta:") ? o.shippingDistrict.slice(6) : ""),
  },
  { header: "Shipping Address", value: (o) => o.shippingAddress },
  { header: "Building / Apartment", value: (o) => buildingDetails(o.shippingAddress) },
  { header: "Postal Code", value: (o) => ({ text: o.shippingPostalCode }) },
  { header: "Country", value: (o) => o.shippingCountry },
  { header: "Bosta Sync Status", value: (o) => o.bostaSyncStatus },
  { header: "Bosta Tracking Number", value: (o) => ({ text: o.bostaTrackingNumber ?? "" }) },
  { header: "Bosta Delivery ID", value: (o) => ({ text: o.bostaDeliveryId ?? "" }) },
  { header: "Bosta Shipment Status", value: (o) => o.bostaStatus },
  { header: "Bosta Status Code", value: (o) => o.bostaStatusCode },
  { header: "Bosta Status Updated At (Cairo)", value: (o) => formatCairoDateTime(o.bostaStatusUpdatedAt) },
  { header: "Bosta Exception Reason", value: (o) => webhookDetails(o.bostaWebhookData).exceptionReason },
  { header: "Bosta Delivery Attempts", value: (o) => webhookDetails(o.bostaWebhookData).attempts },
  { header: "Bosta Sync Error", value: (o) => o.bostaSyncError },
  // Products (one line per item inside each cell)
  { header: "Line Items", value: (_o, items) => items.length },
  { header: "Total Quantity", value: (_o, items) => items.reduce((sum, it) => sum + it.quantity, 0) },
  { header: "Product Names", value: (_o, items) => list(items.map((it) => splitItemName(it).name)) },
  { header: "SKUs", value: (_o, items) => list(items.map((it) => it.sku ?? "")) },
  { header: "Variants", value: (_o, items) => list(items.map((it) => splitItemName(it).variant)) },
  { header: "Quantities", value: (_o, items) => list(items.map((it) => String(it.quantity))) },
  { header: "Unit Prices", value: (_o, items) => list(items.map(unitPrice)) },
  {
    header: "Regular Unit Prices",
    value: (_o, items) => list(items.map((it) => it.price)),
  },
  {
    header: "Line Totals",
    value: (_o, items) =>
      list(items.map((it) => centsToDecimal(toCents(unitPrice(it)) * it.quantity))),
  },
  // Money — stored values, as-is
  { header: "Subtotal", value: (o) => o.subtotal },
  { header: "Discount", value: (o) => o.discount },
  { header: "Promo Code", value: (o) => o.promoCode },
  { header: "Shipping Fee", value: (o) => o.shipping },
  { header: "Tax", value: (o) => o.tax },
  { header: "Order Total", value: (o) => o.total },
  // Other
  { header: "Customer Notes", value: (o) => o.notes },
  { header: "Fulfillment Hold", value: (o) => o.fulfillmentHold },
  { header: "Fulfillment Hold Note", value: (o) => o.fulfillmentHoldNote },
  { header: "Archived At (Cairo)", value: (o) => formatCairoDateTime(o.archivedAt) },
];

export function csvHeaderRow(): string {
  return csvRow(ORDER_EXPORT_COLUMNS.map((c) => c.header));
}

export function csvOrderRow(orderRow: ExportOrderRow, items: ExportOrderItemRow[]): string {
  return csvRow(ORDER_EXPORT_COLUMNS.map((c) => c.value(orderRow, items)));
}
