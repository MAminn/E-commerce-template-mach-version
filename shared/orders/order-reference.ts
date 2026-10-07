/**
 * Customer / merchant order references — "ORD-XXXXXXXX".
 *
 * Format is unchanged from the original Fawaterak tr_number (the only format
 * Fawaterak is known to accept): "ORD-" + 8 uppercase hex characters.
 *
 * Legacy (orders created before references were stored): the 8 characters
 * were the FIRST 8 hex chars of the UUIDv7 id — its millisecond timestamp —
 * so every order created within the same ~65 seconds got the same number.
 *
 * New: the LAST 8 hex chars of the id — 32 random bits of the UUIDv7 — and
 * every new reference is registered in the order_reference table, whose
 * primary key rejects a duplicate (the caller then draws another id). The
 * reference is a pure function of the id, so an attempt's order (which
 * reuses the attempt id) carries the same reference.
 */

export const ORDER_REFERENCE_PREFIX = "ORD-";
export const ORDER_REFERENCE_PATTERN = /^ORD-[0-9A-F]{8}$/;

const hexOf = (id: string) => id.replace(/-/g, "").toUpperCase();

/** New-style reference for an id (random tail of the UUID). */
export function buildOrderReference(id: string): string {
  return `${ORDER_REFERENCE_PREFIX}${hexOf(id).slice(-8)}`;
}

/** The reference a legacy order (no stored reference) has always shown. */
export function legacyOrderReference(id: string): string {
  return `${ORDER_REFERENCE_PREFIX}${hexOf(id).slice(0, 8)}`;
}

/** The reference to show/send for an order or attempt row. */
export function resolveOrderReference(row: { id: string; reference?: string | null }): string {
  return row.reference || legacyOrderReference(row.id);
}

/** Customer-facing order number, e.g. "#3F9A01C2" (no "ORD-" prefix). */
export function displayOrderNumber(row: { id: string; reference?: string | null }): string {
  return `#${resolveOrderReference(row).slice(ORDER_REFERENCE_PREFIX.length)}`;
}

/** Does free-text search input match this row's reference / number? */
export function matchesOrderReference(
  row: { id: string; reference?: string | null },
  query: string,
): boolean {
  const q = query.trim().toUpperCase().replace(/^#/, "").replace(/^ORD-/, "");
  if (!q) return false;
  return resolveOrderReference(row).slice(ORDER_REFERENCE_PREFIX.length).includes(q);
}
