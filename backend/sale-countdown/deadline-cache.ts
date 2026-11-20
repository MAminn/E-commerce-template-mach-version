/**
 * This process's view of the running countdown's deadline. Only used to skip
 * work cheaply (no database query until the deadline has passed); it is never
 * what decides a price — checkout reads the database itself.
 *
 * Kept in its own import-free module so the service (which updates it after
 * every admin change) and the worker (which reads it) don't import each other.
 */

let deadlineMs: number | null = null;
let loaded = false;

/** Record the countdown as just read or written. */
export function noteSaleCountdownState(
  row: { status: string; endsAt: Date | null } | null | undefined,
): void {
  deadlineMs = row && row.status === "running" && row.endsAt ? row.endsAt.getTime() : null;
  loaded = true;
}

/** True once a running countdown's deadline has passed (as far as this process knows). */
export function isKnownDeadlinePassed(nowMs: number = Date.now()): boolean {
  return loaded && deadlineMs !== null && nowMs >= deadlineMs;
}

export function knownDeadlineMs(): number | null {
  return deadlineMs;
}

/** Tests only. */
export function resetSaleCountdownCache(): void {
  deadlineMs = null;
  loaded = false;
}
