/**
 * Bosta Delivery API service — create / terminate / track deliveries.
 *
 * Source of truth: https://docs.bosta.co
 *   POST   /deliveries?apiVersion=1                       create (type 10 = Deliver)
 *   DELETE /deliveries/business/{trackingNumber}/terminate cancel
 *   GET    /deliveries/business/{trackingNumber}           view/track
 *
 * Feature-flagged on SYN_BOSTA_KEY: every function returns null / a failed
 * outcome instead of throwing when the key is missing.
 */
import { BostaApiError, bostaFetch, isBostaEnabled } from "./client";
import { resolveBostaDropOffDistrict } from "./districts";
import { resolveBostaBusinessLocationId } from "./pickup";
import { getBostaStateName, mapBostaStateToOrderStatus } from "./states";

export { getBostaApiKey, isBostaEnabled, BostaApiError } from "./client";
export { mapBostaStateToOrderStatus, getBostaStateName };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BostaReceiver {
  firstName: string;
  lastName?: string | null;
  /** Raw phone as stored on the order — normalised/validated here. */
  phone: string;
  email?: string | null;
}

export interface BostaDropOffInput {
  /** Exact Bosta district id chosen at checkout. Always preferred. */
  districtId?: string | null;
  /** Legacy name hints for orders created before the exact picker. */
  city?: string | null;
  zone?: string | null;
  districtHint?: string | null;
  firstLine: string;
  secondLine?: string | null;
  buildingNumber?: string | null;
  floor?: string | null;
  apartment?: string | null;
}

export interface BostaCreateDeliveryInput {
  /** Internal order id — always sent as businessReference (webhook → order mapping). */
  orderId: string;
  /**
   * Bosta-side dedupe key for THIS creation attempt. Bosta requires it to be
   * unique across all deliveries, so a resend after termination must use a
   * different value than the initial shipment (see order-input.ts). Defaults
   * to the order id.
   */
  uniqueBusinessReference?: string;
  receiver: BostaReceiver;
  dropOffAddress: BostaDropOffInput;
  /** Amount the courier collects. 0 for prepaid orders. */
  cod: number;
  /** Merchandise value used for Bosta's insurance calculation (goodsInfo.amount). */
  goodsAmount?: number | null;
  notes?: string | null;
  itemsCount: number;
  /** Package description shown to the courier (e.g. item summary). */
  description?: string | null;
}

export interface BostaDeliveryResult {
  /** Bosta internal `_id` */
  deliveryId: string;
  trackingNumber: string;
  stateCode: number;
  stateValue: string;
}

export type CreateBostaDeliveryOutcome =
  | { success: true; result: BostaDeliveryResult }
  | { success: false; error: string; kind: "validation" | "api" };

/** Thrown by the pure request builder when the order data cannot form a valid delivery. */
export class BostaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BostaValidationError";
  }
}

// ─── Phone ────────────────────────────────────────────────────────────────────

/**
 * Normalise an Egyptian mobile number to Bosta's `01XXXXXXXXX` form.
 * Accepts 01X…, +201X…, 201X…, 00201X… with spaces, dashes and brackets.
 */
export function normalizeEgyptPhone(
  raw: string,
): { ok: true; phone: string } | { ok: false; reason: string } {
  const stripped = (raw ?? "").replace(/[\s\-().]/g, "");
  if (!stripped) return { ok: false, reason: "Phone number is empty" };

  let digits = stripped;
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) {
    return { ok: false, reason: `Phone number "${raw}" contains invalid characters` };
  }

  if (digits.startsWith("0020")) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("20") && digits.length === 12) digits = `0${digits.slice(2)}`;

  if (!/^01\d{9}$/.test(digits)) {
    return {
      ok: false,
      reason: `Phone number "${raw}" is not a valid Egyptian mobile number (expected 01XXXXXXXXX)`,
    };
  }
  return { ok: true, phone: digits };
}

// ─── Request builder (pure) ───────────────────────────────────────────────────

const MIN_FIRST_LINE_LENGTH = 6; // docs: "must be more than 5 characters"
const MAX_DESCRIPTION_LENGTH = 250;

function cleanOptional(value: string | null | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

export interface BostaResolvedDropOffAddress {
  city: string;
  zoneId: string;
  districtId: string;
}

export interface BostaCreateDeliveryBody {
  type: 10;
  cod: number;
  businessReference: string;
  uniqueBusinessReference: string;
  businessLocationId: string;
  notes?: string;
  goodsInfo?: { amount: number };
  specs: {
    packageType: "Parcel";
    size: "SMALL";
    packageDetails: { itemsCount: number; description: string };
  };
  receiver: { firstName: string; lastName: string; phone: string; email?: string };
  dropOffAddress: {
    city: string;
    zoneId: string;
    districtId: string;
    firstLine: string;
    secondLine?: string;
    buildingNumber?: string;
    floor?: string;
    apartment?: string;
  };
}

/**
 * Build the exact JSON body for `POST /deliveries?apiVersion=1` (type 10).
 * Pure and synchronous — throws {@link BostaValidationError} on bad data.
 */
export function buildBostaCreateDeliveryBody(
  input: BostaCreateDeliveryInput,
  resolved: { businessLocationId: string; dropOff: BostaResolvedDropOffAddress },
): BostaCreateDeliveryBody {
  const firstName = input.receiver.firstName.trim();
  if (!firstName) throw new BostaValidationError("Receiver first name is required");
  // Bosta's how-to lists lastName as required; a single-word customer name
  // repeats the first name rather than sending an empty string.
  const lastName = cleanOptional(input.receiver.lastName) ?? firstName;

  const phone = normalizeEgyptPhone(input.receiver.phone);
  if (!phone.ok) throw new BostaValidationError(phone.reason);

  const firstLine = input.dropOffAddress.firstLine.trim();
  if (firstLine.length < MIN_FIRST_LINE_LENGTH) {
    throw new BostaValidationError(
      `Street address "${firstLine}" is too short for Bosta (needs more than 5 characters)`,
    );
  }

  if (!resolved.dropOff.districtId || !resolved.dropOff.city) {
    throw new BostaValidationError("Drop-off district is not resolved");
  }
  if (!resolved.businessLocationId) {
    throw new BostaValidationError("Bosta business location id is not resolved");
  }

  const cod = Math.round(Number(input.cod));
  if (!Number.isFinite(cod) || cod < 0) {
    throw new BostaValidationError(`Invalid COD amount: ${String(input.cod)}`);
  }

  const itemsCount = Math.max(1, Math.round(input.itemsCount || 1));
  const description = (cleanOptional(input.description) ?? "Online store order").slice(
    0,
    MAX_DESCRIPTION_LENGTH,
  );

  const body: BostaCreateDeliveryBody = {
    type: 10,
    cod,
    businessReference: input.orderId,
    uniqueBusinessReference: cleanOptional(input.uniqueBusinessReference) ?? input.orderId,
    businessLocationId: resolved.businessLocationId,
    specs: {
      packageType: "Parcel",
      size: "SMALL",
      packageDetails: { itemsCount, description },
    },
    receiver: {
      firstName,
      lastName,
      phone: phone.phone,
    },
    dropOffAddress: {
      city: resolved.dropOff.city,
      zoneId: resolved.dropOff.zoneId,
      districtId: resolved.dropOff.districtId,
      firstLine,
    },
  };

  const email = cleanOptional(input.receiver.email);
  if (email) body.receiver.email = email;

  const notes = cleanOptional(input.notes);
  if (notes) body.notes = notes;

  if (input.goodsAmount != null && Number.isFinite(input.goodsAmount) && input.goodsAmount > 0) {
    body.goodsInfo = { amount: Math.round(input.goodsAmount * 100) / 100 };
  }

  const secondLine = cleanOptional(input.dropOffAddress.secondLine);
  if (secondLine && secondLine !== firstLine) body.dropOffAddress.secondLine = secondLine;
  const buildingNumber = cleanOptional(input.dropOffAddress.buildingNumber);
  if (buildingNumber) body.dropOffAddress.buildingNumber = buildingNumber;
  const floor = cleanOptional(input.dropOffAddress.floor);
  if (floor) body.dropOffAddress.floor = floor;
  const apartment = cleanOptional(input.dropOffAddress.apartment);
  if (apartment) body.dropOffAddress.apartment = apartment;

  return body;
}

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * Create a Bosta delivery for an order.
 * Returns null (silently) if Bosta is not configured; never throws.
 */
export async function createBostaDelivery(
  input: BostaCreateDeliveryInput,
): Promise<CreateBostaDeliveryOutcome | null> {
  if (!isBostaEnabled()) return null;

  try {
    const district = await resolveBostaDropOffDistrict({
      districtId: input.dropOffAddress.districtId,
      city: input.dropOffAddress.city,
      zone: input.dropOffAddress.zone,
      districtHint: input.dropOffAddress.districtHint,
    });
    if (!district.ok) {
      return { success: false, kind: "validation", error: district.reason };
    }

    const businessLocationId = await resolveBostaBusinessLocationId();

    const body = buildBostaCreateDeliveryBody(input, {
      businessLocationId,
      dropOff: {
        city: district.entry.cityName,
        zoneId: district.entry.zoneId,
        districtId: district.entry.districtId,
      },
    });

    const data = await bostaFetch<{
      _id: string;
      trackingNumber: string | number;
      state?: { code?: number; value?: string };
    }>("POST", "/deliveries?apiVersion=1", body);

    const trackingNumber = String(data.trackingNumber ?? "").trim();
    if (!data._id || !trackingNumber) {
      return {
        success: false,
        kind: "api",
        error: "Bosta accepted the delivery but returned no tracking number",
      };
    }

    const stateCode = typeof data.state?.code === "number" ? data.state.code : 10;
    console.log(`[Bosta] Delivery created for order ${input.orderId}: tracking=${trackingNumber}`);

    return {
      success: true,
      result: {
        deliveryId: data._id,
        trackingNumber,
        stateCode,
        stateValue: data.state?.value ?? getBostaStateName(stateCode),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const kind = err instanceof BostaValidationError ? "validation" : "api";
    console.error(`[Bosta] createBostaDelivery failed for order ${input.orderId}:`, message);
    return { success: false, kind, error: message };
  }
}

export type CancelBostaDeliveryOutcome =
  | { success: true }
  | { success: false; error: string; permissionDenied: boolean };

/**
 * Terminate a delivery by its tracking number.
 * Requires a Full Access API key (DELETE). With a Read/Write key Bosta
 * answers 401/403 and `permissionDenied` is set so the caller can point the
 * admin at the Bosta dashboard instead.
 */
export async function cancelBostaDelivery(
  trackingNumber: string,
): Promise<CancelBostaDeliveryOutcome> {
  if (!isBostaEnabled()) {
    return { success: false, error: "Bosta is not configured", permissionDenied: false };
  }
  const tn = trackingNumber.trim();
  if (!tn) {
    return { success: false, error: "Missing Bosta tracking number", permissionDenied: false };
  }

  try {
    await bostaFetch("DELETE", `/deliveries/business/${encodeURIComponent(tn)}/terminate`);
    console.log(`[Bosta] Delivery ${tn} terminated`);
    return { success: true };
  } catch (err) {
    const permissionDenied = err instanceof BostaApiError && err.isPermissionError;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Bosta] cancelBostaDelivery(${tn}) failed:`, message);
    return {
      success: false,
      permissionDenied,
      error: permissionDenied
        ? "Bosta rejected the cancellation — the API key has no DELETE permission (Full Access is required). Cancel this delivery from the Bosta dashboard."
        : message,
    };
  }
}

/**
 * Fetch the current state of a delivery. Webhooks remain the primary status
 * mechanism; this is available for on-demand checks only.
 */
export async function trackBostaDelivery(trackingNumber: string): Promise<{
  stateCode: number;
  stateValue: string;
  updatedAt?: string;
} | null> {
  if (!isBostaEnabled()) return null;
  const tn = trackingNumber.trim();
  if (!tn) return null;

  try {
    const data = await bostaFetch<{
      state?: { code?: number; value?: string };
      updatedAt?: string;
    }>("GET", `/deliveries/business/${encodeURIComponent(tn)}`);

    const stateCode = typeof data.state?.code === "number" ? data.state.code : 0;
    return {
      stateCode,
      stateValue: data.state?.value ?? getBostaStateName(stateCode),
      updatedAt: data.updatedAt,
    };
  } catch (err) {
    console.error(`[Bosta] trackBostaDelivery(${tn}) failed:`, err);
    return null;
  }
}
