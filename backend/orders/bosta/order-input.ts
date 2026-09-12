/**
 * Canonical conversion of a persisted order (+ its items) into the input for
 * {@link createBostaDelivery}. Every dispatch path — COD checkout, paid
 * online order, admin "Send to Bosta" — goes through this one builder, so
 * the three can never drift (the old paths disagreed on city/zone and COD).
 *
 * Only trusted DB values are used: nothing here comes from the browser.
 */
import type { order } from "#root/shared/database/drizzle/schema";
import { parseBostaDistrictRef } from "./districts";
import type { BostaCreateDeliveryInput } from "./service";

type OrderRow = typeof order.$inferSelect;

/** The subset of the order row the builder reads. */
export type BostaOrderSource = Pick<
  OrderRow,
  | "id"
  | "customerName"
  | "customerEmail"
  | "customerPhone"
  | "shippingAddress"
  | "shippingCity"
  | "shippingState"
  | "shippingDistrict"
  | "subtotal"
  | "discount"
  | "total"
  | "notes"
  | "paymentMethod"
>;

export interface BostaOrderItemSource {
  name?: string | null;
  quantity: number;
}

export interface BuildBostaInputOptions {
  /**
   * Tracking number of the order's previous (terminated) delivery when this
   * is a deliberate resend. Drives the Bosta-side dedupe key.
   */
  previousTrackingNumber?: string | null;
}

/**
 * Bosta requires `uniqueBusinessReference` to be unique across ALL deliveries
 * ("must be unique across all orders in your system and should not be
 * duplicated"). The initial shipment uses the bare order id; every resend
 * after a termination derives a deterministic key from the delivery it
 * replaces, so:
 *   - concurrent/repeated attempts at the SAME resend share one key (Bosta
 *     dedupes them — no random per-retry values), and
 *   - a later resend after ANOTHER termination gets a different key.
 * `businessReference` is never affected — it stays the order id.
 */
export function computeUniqueBusinessReference(
  orderId: string,
  previousTrackingNumber?: string | null,
): string {
  const prev = previousTrackingNumber?.trim();
  return prev ? `${orderId}:resend:${prev}` : orderId;
}

export type BuildBostaInputResult =
  | { ok: true; input: BostaCreateDeliveryInput }
  | { ok: false; reason: string };

/** Split "Ahmed Mohamed Ali" → { firstName: "Ahmed", lastName: "Mohamed Ali" }. */
export function splitCustomerName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? "";
  const lastName = parts.slice(1).join(" ");
  return { firstName, lastName };
}

const STORED_ADDRESS_SUFFIX = /\s*\((?:Bldg\s+([^,()]+))?(?:,\s*)?(?:Apt\s+([^()]+))?\)\s*$/i;

/**
 * Inverse of create-order's `formatStoredShippingAddress`, which stores
 * "12 Tahrir St (Bldg 5, Apt 3)". Recovers the parts the customer actually
 * typed so they can be sent as Bosta's dedicated fields — and nothing is
 * invented when they were not provided.
 */
export function parseStoredShippingAddress(stored: string): {
  street: string;
  buildingNumber?: string;
  apartment?: string;
} {
  const raw = (stored ?? "").trim();
  const match = raw.match(STORED_ADDRESS_SUFFIX);
  if (!match || (!match[1] && !match[2])) return { street: raw };
  const street = raw.slice(0, match.index).trim();
  return {
    street: street || raw,
    buildingNumber: match[1]?.trim() || undefined,
    apartment: match[2]?.trim() || undefined,
  };
}

function toAmount(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Merchandise value: subtotal minus discounts, never shipping, never negative. */
export function computeGoodsAmount(row: Pick<BostaOrderSource, "subtotal" | "discount">): number {
  return Math.max(0, toAmount(row.subtotal) - toAmount(row.discount));
}

/** COD is the trusted DB total for cash orders, 0 for anything prepaid. */
export function computeCodAmount(row: Pick<BostaOrderSource, "paymentMethod" | "total">): number {
  return row.paymentMethod === "cod" ? toAmount(row.total) : 0;
}

export function summarizeItems(items: BostaOrderItemSource[]): {
  itemsCount: number;
  description: string;
} {
  const itemsCount = items.reduce((sum, i) => sum + Math.max(0, Math.round(i.quantity || 0)), 0);
  const description = items
    .filter((i) => i.name?.trim())
    .map((i) => `${Math.max(1, Math.round(i.quantity || 1))}x ${i.name!.trim()}`)
    .join(", ");
  return { itemsCount: Math.max(1, itemsCount), description: description || "Online store order" };
}

/**
 * Build the canonical Bosta input from an order row. Pure: no I/O, no
 * network. District *resolution* happens later in createBostaDelivery; this
 * only decides what identifies the district (exact id vs legacy names).
 */
export function buildBostaInputFromOrder(
  row: BostaOrderSource,
  items: BostaOrderItemSource[],
  options: BuildBostaInputOptions = {},
): BuildBostaInputResult {
  const { firstName, lastName } = splitCustomerName(row.customerName ?? "");
  if (!firstName) return { ok: false, reason: "Order has no customer name" };

  const address = parseStoredShippingAddress(row.shippingAddress ?? "");
  const districtId = parseBostaDistrictRef(row.shippingDistrict);
  const legacyDistrictHint = districtId ? null : row.shippingDistrict?.trim() || null;

  // shippingState = governorate (Bosta "city"), shippingCity = area/zone text.
  const city = row.shippingState?.trim() || row.shippingCity?.trim() || "";
  const zone = row.shippingCity?.trim() || null;

  const { itemsCount, description } = summarizeItems(items);

  return {
    ok: true,
    input: {
      orderId: row.id,
      uniqueBusinessReference: computeUniqueBusinessReference(
        row.id,
        options.previousTrackingNumber,
      ),
      receiver: {
        firstName,
        lastName,
        phone: row.customerPhone ?? "",
        email: row.customerEmail ?? null,
      },
      dropOffAddress: {
        districtId,
        city,
        zone,
        districtHint: legacyDistrictHint,
        firstLine: address.street,
        buildingNumber: address.buildingNumber ?? null,
        apartment: address.apartment ?? null,
      },
      cod: computeCodAmount(row),
      goodsAmount: computeGoodsAmount(row),
      notes: row.notes ?? null,
      itemsCount,
      description,
    },
  };
}
