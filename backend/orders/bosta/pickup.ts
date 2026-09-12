/**
 * Resolve the Bosta *business location id* used as `businessLocationId` on
 * create-delivery requests.
 *
 * Current docs (create-your-first-delivery): for a Deliver (type 10) order the
 * pickup is defined by `businessLocationId` — "If not added we will pick it
 * from your default location". A full `pickupAddress` is only for cash
 * collection / CRP / exchange flows, so we never reconstruct one here.
 *
 * Resolution order:
 *   1. BOSTA_PICKUP_LOCATION_ID (explicit, non-placeholder) wins.
 *   2. GET /pickup-locations → the location flagged `isDefault: true`.
 *   3. Exactly one location exists → use it.
 *   4. Several locations, none default → fail clearly (never `list[0]`).
 */
import { bostaFetch, getBostaApiKey } from "./client";

const CACHE_TTL_MS = 10 * 60 * 1000;

let cachedLocationId: string | null = null;
let cacheLoadedAt = 0;

export function clearBostaPickupCache(): void {
  cachedLocationId = null;
  cacheLoadedAt = 0;
}

export function isPlaceholderEnvValue(value: string | undefined | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return (
    !v ||
    v.startsWith("your-") ||
    v.includes("your-") ||
    v === "placeholder" ||
    v === "example" ||
    v === "xxx" ||
    v === "changeme"
  );
}

export function getConfiguredPickupLocationId(): string | null {
  const raw = process.env.BOSTA_PICKUP_LOCATION_ID?.trim();
  if (!raw || isPlaceholderEnvValue(raw)) return null;
  return raw;
}

export interface BostaPickupLocationSummary {
  id: string;
  name: string;
  isDefault: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function parseLocation(item: unknown): BostaPickupLocationSummary | null {
  const rec = asRecord(item);
  if (!rec) return null;
  const id =
    (typeof rec._id === "string" && rec._id.trim()) ||
    (typeof rec.id === "string" && rec.id.trim()) ||
    "";
  if (!id) return null;
  return {
    id,
    name: typeof rec.locationName === "string" ? rec.locationName : "",
    isDefault: rec.isDefault === true,
  };
}

/** `GET /pickup-locations` → documented shape `{ data: { list: [...] } }`. */
export async function listBostaPickupLocations(): Promise<BostaPickupLocationSummary[]> {
  const data = await bostaFetch<Record<string, unknown> | unknown[]>("GET", "/pickup-locations");
  const rec = asRecord(data);
  const list = Array.isArray(data)
    ? data
    : Array.isArray(rec?.list)
      ? (rec!.list as unknown[])
      : Array.isArray(rec?.pickupLocations)
        ? (rec!.pickupLocations as unknown[])
        : [];
  return list.map(parseLocation).filter((l): l is BostaPickupLocationSummary => !!l);
}

/** Pure selection rule — exported for tests. */
export function selectPickupLocation(
  locations: BostaPickupLocationSummary[],
): { ok: true; id: string } | { ok: false; error: string } {
  if (locations.length === 0) {
    return {
      ok: false,
      error:
        "No pickup location found on the Bosta account. Add a business location in the Bosta dashboard (Settings → Pickup locations) or set BOSTA_PICKUP_LOCATION_ID.",
    };
  }
  const defaults = locations.filter((l) => l.isDefault);
  if (defaults.length === 1) return { ok: true, id: defaults[0]!.id };
  if (defaults.length > 1) {
    return {
      ok: false,
      error: `Bosta account has ${defaults.length} default pickup locations — set BOSTA_PICKUP_LOCATION_ID to choose one.`,
    };
  }
  if (locations.length === 1) return { ok: true, id: locations[0]!.id };
  return {
    ok: false,
    error: `Bosta account has ${locations.length} pickup locations and none is marked default — set BOSTA_PICKUP_LOCATION_ID to the warehouse to ship from.`,
  };
}

/**
 * Resolve the business location id to ship from. Throws with a clear,
 * admin-readable message when it cannot be determined safely.
 */
export async function resolveBostaBusinessLocationId(): Promise<string> {
  const configured = getConfiguredPickupLocationId();
  if (configured) return configured;

  if (!getBostaApiKey()) {
    throw new Error("[Bosta] SYN_BOSTA_KEY is not configured");
  }

  const now = Date.now();
  if (cachedLocationId && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedLocationId;
  }

  const locations = await listBostaPickupLocations();
  const selected = selectPickupLocation(locations);
  if (!selected.ok) throw new Error(`[Bosta] ${selected.error}`);

  cachedLocationId = selected.id;
  cacheLoadedAt = now;
  return selected.id;
}
