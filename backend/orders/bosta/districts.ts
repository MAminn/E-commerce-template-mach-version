/**
 * Bosta shipping locations (city → zone → district) and drop-off district
 * resolution.
 *
 * Source: https://docs.bosta.co/docs/how-to/format-bosta-address
 *   GET /cities/getAllDistricts?countryId=<Egypt>  → per-city district list
 *   Each district carries `pickupAvailability` / `dropOffAvailability`.
 *
 * Rule: a delivery is only ever created against an *exact* district id the
 * customer picked at checkout. The legacy name-based path exists solely for
 * old orders and fails on anything ambiguous — there is no "first district
 * in the city" or cross-Egypt fallback any more.
 */
import { BOSTA_API_BASE, getBostaApiKey } from "./client";

const DEFAULT_EGYPT_COUNTRY_ID = "60e4482c7cb7d4bc4849c4d5";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * `order.shipping_district` holds either free text (legacy) or a Bosta
 * district reference in the form `bosta:<districtId>`. The prefix keeps the
 * two unambiguous without a schema change.
 */
const DISTRICT_REF_PREFIX = "bosta:";

export function encodeBostaDistrictRef(districtId: string): string {
  return `${DISTRICT_REF_PREFIX}${districtId.trim()}`;
}

export function parseBostaDistrictRef(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith(DISTRICT_REF_PREFIX)) return null;
  const id = trimmed.slice(DISTRICT_REF_PREFIX.length).trim();
  return id || null;
}

export interface BostaDistrictEntry {
  cityId: string;
  cityCode: string;
  cityName: string;
  cityOtherName?: string;
  zoneId: string;
  zoneName: string;
  zoneOtherName?: string;
  districtId: string;
  districtName: string;
  districtOtherName?: string;
  dropOffAvailability: boolean;
  pickupAvailability: boolean;
}

export interface BostaCheckoutDistrict {
  districtId: string;
  districtName: string;
}

export interface BostaCheckoutZone {
  zoneId: string;
  zoneName: string;
  districts: BostaCheckoutDistrict[];
}

export interface BostaCheckoutCity {
  cityId: string;
  cityName: string;
  zones: BostaCheckoutZone[];
}

let cachedDistricts: BostaDistrictEntry[] | null = null;
let cacheLoadedAt = 0;

export function clearBostaDistrictsCache(): void {
  cachedDistricts = null;
  cacheLoadedAt = 0;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return undefined;
}

/** Flatten the documented getAllDistricts payload. Exported for tests. */
export function flattenDistrictsPayload(payload: unknown): BostaDistrictEntry[] {
  const entries: BostaDistrictEntry[] = [];
  const root = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.data)
      ? (root!.data as unknown[])
      : Array.isArray(root?.result)
        ? (root!.result as unknown[])
        : [];

  for (const cityItem of list) {
    const cityRec = asRecord(cityItem);
    if (!cityRec) continue;

    const cityName = pickString(cityRec, "cityName", "name") ?? "Unknown";
    const cityOtherName = pickString(cityRec, "cityOtherName", "nameAr");
    const cityCode = pickString(cityRec, "cityCode", "code") ?? "";
    const cityId = pickString(cityRec, "cityId", "_id", "id") ?? "";
    const districts = Array.isArray(cityRec.districts) ? cityRec.districts : [];

    for (const districtItem of districts) {
      const dRec = asRecord(districtItem);
      if (!dRec) continue;

      const districtId = pickString(dRec, "districtId");
      const districtName = pickString(dRec, "districtName", "name");
      const zoneId = pickString(dRec, "zoneId");
      if (!districtId || !districtName || !zoneId || !cityId) continue;

      entries.push({
        cityId,
        cityCode,
        cityName,
        cityOtherName,
        zoneId,
        zoneName: pickString(dRec, "zoneName") ?? districtName,
        zoneOtherName: pickString(dRec, "zoneOtherName"),
        districtId,
        districtName,
        districtOtherName: pickString(dRec, "districtOtherName"),
        // Absent flag = assume available (older payloads); explicit false = excluded.
        dropOffAvailability: dRec.dropOffAvailability !== false,
        pickupAvailability: dRec.pickupAvailability !== false,
      });
    }
  }

  return entries;
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/** All districts Bosta can deliver to (drop-off-unavailable ones are excluded). */
export async function loadDistricts(): Promise<BostaDistrictEntry[]> {
  const now = Date.now();
  if (cachedDistricts && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedDistricts;
  }

  const apiKey = getBostaApiKey();
  if (!apiKey) return [];

  const countryId = process.env.BOSTA_EGYPT_COUNTRY_ID?.trim() || DEFAULT_EGYPT_COUNTRY_ID;
  const res = await fetch(
    `${BOSTA_API_BASE}/cities/getAllDistricts?countryId=${encodeURIComponent(countryId)}`,
    { headers: { Authorization: apiKey, Accept: "application/json" } },
  );

  const payload = await res.json();
  if (!res.ok) {
    const msg =
      (asRecord(payload)?.message as string | undefined) ??
      `Bosta districts API error ${res.status}`;
    throw new Error(`[Bosta] ${msg}`);
  }

  cachedDistricts = flattenDistrictsPayload(payload).filter((d) => d.dropOffAvailability);
  cacheLoadedAt = now;
  return cachedDistricts;
}

// ─── Checkout tree ────────────────────────────────────────────────────────────

/** Group district rows into city → zone → district for the checkout picker. */
export function groupDistrictsForCheckout(entries: BostaDistrictEntry[]): BostaCheckoutCity[] {
  const cityMap = new Map<string, BostaCheckoutCity>();

  for (const entry of entries) {
    if (!entry.dropOffAvailability) continue;
    let city = cityMap.get(entry.cityId);
    if (!city) {
      city = { cityId: entry.cityId, cityName: entry.cityName, zones: [] };
      cityMap.set(entry.cityId, city);
    }
    let zone = city.zones.find((z) => z.zoneId === entry.zoneId);
    if (!zone) {
      zone = { zoneId: entry.zoneId, zoneName: entry.zoneName, districts: [] };
      city.zones.push(zone);
    }
    if (!zone.districts.some((d) => d.districtId === entry.districtId)) {
      zone.districts.push({ districtId: entry.districtId, districtName: entry.districtName });
    }
  }

  return [...cityMap.values()]
    .map((city) => ({
      ...city,
      zones: city.zones
        .map((zone) => ({
          ...zone,
          districts: [...zone.districts].sort((a, b) => a.districtName.localeCompare(b.districtName)),
        }))
        .sort((a, b) => a.zoneName.localeCompare(b.zoneName)),
    }))
    .sort((a, b) => a.cityName.localeCompare(b.cityName));
}

export async function getBostaCheckoutLocations(): Promise<BostaCheckoutCity[]> {
  return groupDistrictsForCheckout(await loadDistricts());
}

// ─── Resolution ───────────────────────────────────────────────────────────────

/** Space/case-insensitive equality — Bosta's own data mixes "ElMaadi" / "El Maadi". */
function keyOf(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s\-_]+/g, "");
}

function sameName(hint: string, ...candidates: Array<string | undefined>): boolean {
  const h = keyOf(hint);
  if (!h) return false;
  return candidates.some((c) => !!c && keyOf(c) === h);
}

export type DistrictResolution =
  | { ok: true; entry: BostaDistrictEntry; via: "id" | "legacy-names" }
  | { ok: false; reason: string };

export function findDistrictById(
  districts: BostaDistrictEntry[],
  districtId: string,
): BostaDistrictEntry | undefined {
  const id = districtId.trim();
  return districts.find((d) => d.districtId === id);
}

/**
 * Legacy name-based resolution for orders that pre-date the exact district
 * picker. Exact (normalised) name equality only — no substring matching, no
 * fallback to an arbitrary district. Ambiguity is an error.
 * Exported for unit tests (pure, no I/O).
 */
export function findDistrictByNames(
  districts: BostaDistrictEntry[],
  input: { city: string; zone?: string | null; districtHint?: string | null },
): DistrictResolution {
  const city = input.city.trim();
  if (!city) return { ok: false, reason: "No city/governorate on the order" };

  const inCity = districts.filter((d) => sameName(city, d.cityName, d.cityOtherName, d.cityCode));
  if (inCity.length === 0) {
    return { ok: false, reason: `"${city}" is not a Bosta city/governorate` };
  }

  const districtHint = input.districtHint?.trim() ?? "";
  const zoneHint = input.zone?.trim() ?? "";

  const byDistrict = districtHint
    ? inCity.filter((d) => sameName(districtHint, d.districtName, d.districtOtherName))
    : [];
  if (byDistrict.length === 1) return { ok: true, entry: byDistrict[0]!, via: "legacy-names" };
  if (byDistrict.length > 1) {
    return {
      ok: false,
      reason: `District "${districtHint}" matches ${byDistrict.length} Bosta districts in ${city} — pick the exact one`,
    };
  }

  const byZone = zoneHint
    ? inCity.filter((d) =>
        sameName(zoneHint, d.zoneName, d.zoneOtherName, d.districtName, d.districtOtherName),
      )
    : [];
  if (byZone.length === 1) return { ok: true, entry: byZone[0]!, via: "legacy-names" };
  if (byZone.length > 1) {
    return {
      ok: false,
      reason: `Area "${zoneHint}" matches ${byZone.length} Bosta districts in ${city} — pick the exact one`,
    };
  }

  const tried = [districtHint && `district "${districtHint}"`, zoneHint && `area "${zoneHint}"`]
    .filter(Boolean)
    .join(", ");
  return {
    ok: false,
    reason: `No Bosta district in ${city} matches ${tried || "the order's shipping area"} — select the exact delivery district`,
  };
}

/**
 * Resolve the drop-off district for an order. An exact `districtId` always
 * wins; the name-based path is only consulted when there is no id.
 */
export async function resolveBostaDropOffDistrict(input: {
  districtId?: string | null;
  city?: string | null;
  zone?: string | null;
  districtHint?: string | null;
}): Promise<DistrictResolution> {
  let districts: BostaDistrictEntry[];
  try {
    districts = await loadDistricts();
  } catch (err) {
    return {
      ok: false,
      reason: `Could not load Bosta districts: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const id = input.districtId?.trim();
  if (id) {
    const entry = findDistrictById(districts, id);
    if (entry) return { ok: true, entry, via: "id" };
    return {
      ok: false,
      reason: `Bosta district "${id}" no longer exists or cannot receive deliveries — re-select the delivery district`,
    };
  }

  if (!input.city?.trim()) {
    return { ok: false, reason: "Order has no Bosta delivery district — select one before sending" };
  }

  return findDistrictByNames(districts, {
    city: input.city,
    zone: input.zone,
    districtHint: input.districtHint,
  });
}
