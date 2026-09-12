/**
 * Authoritative Bosta delivery state table and the rules for translating a
 * Bosta state into a local order status.
 *
 * Names are taken verbatim from the current webhook documentation
 * (https://docs.bosta.co/docs/how-to/get-delivery-status-via-webhook/,
 * "Bosta States" table). Do not add names that are not in that table.
 */

export type LocalOrderStatus = "pending" | "processing" | "shipped" | "delivered" | "cancelled";

/** Bosta state code → state name (webhook table). */
export const BOSTA_STATE_NAMES: Readonly<Record<number, string>> = {
  10: "Pickup requested",
  11: "Waiting for route",
  20: "Route Assigned",
  21: "Picked up from business",
  22: "Picking up from consignee",
  23: "Picked up from consignee",
  24: "Received at warehouse",
  25: "Fulfilled",
  30: "In transit between Hubs",
  40: "Picking up",
  41: "Picked up",
  45: "Delivered",
  46: "Returned to business",
  47: "Exception",
  48: "Terminated",
  49: "Canceled",
  60: "Returned to stock",
  100: "Lost",
  101: "Damaged",
  102: "Investigation",
  103: "Awaiting your action",
  104: "Archived",
  105: "On hold",
};

/** Human-readable name for a state code; unknown codes are labelled, never thrown. */
export function getBostaStateName(code: number): string {
  return BOSTA_STATE_NAMES[code] ?? `Unknown state (${code})`;
}

/** Codes Bosta considers terminal for a delivery. */
export const BOSTA_TERMINAL_STATE_CODES: ReadonlySet<number> = new Set([45, 46, 48, 49, 100, 101]);

export type BostaStatusAction =
  | { type: "set"; status: LocalOrderStatus }
  | { type: "keep" };

/**
 * What a Bosta state means for the local `order.status`.
 *
 * "keep" = this event carries no local status change (in-progress,
 * exception, fulfilment-only or CRP/exchange states) — the Bosta status
 * columns are still updated by the caller, the order status is untouched.
 */
export function mapBostaStateToOrderStatus(stateCode: number): BostaStatusAction {
  switch (stateCode) {
    case 10: // Pickup requested
    case 11: // Waiting for route
    case 20: // Route Assigned
      return { type: "set", status: "processing" };
    case 21: // Picked up from business
    case 24: // Received at warehouse
    case 30: // In transit between Hubs
    case 41: // Picked up / heading to customer
      return { type: "set", status: "shipped" };
    case 45: // Delivered
      return { type: "set", status: "delivered" };
    case 46: // Returned to business
    case 48: // Terminated
    case 49: // Canceled
    case 100: // Lost
    case 101: // Damaged
      return { type: "set", status: "cancelled" };
    case 22: // Picking up from consignee (CRP/Exchange)
    case 23: // Picked up from consignee (CRP/Exchange)
    case 25: // Fulfilled
    case 40: // Picking up (Cash collection)
    case 47: // Exception — delivery still in progress
    case 60: // Returned to stock (Fulfilment)
    case 102: // Investigation
    case 103: // Awaiting your action
    case 104: // Archived
    case 105: // On hold
    default:
      return { type: "keep" };
  }
}

const STATUS_RANK: Record<LocalOrderStatus, number> = {
  pending: 0,
  processing: 1,
  shipped: 2,
  delivered: 3,
  cancelled: 3,
};

const TERMINAL_LOCAL: ReadonlySet<LocalOrderStatus> = new Set(["delivered", "cancelled"]);

/**
 * Apply a status action to the current local status.
 *
 * Returns the next status, or `null` when nothing should change. Guarantees:
 *  - "keep" never changes anything.
 *  - a terminal local status (delivered / cancelled) is only replaced by
 *    another terminal status coming from a genuine terminal Bosta state;
 *  - progress never runs backwards (shipped → processing, etc.).
 */
export function resolveNextOrderStatus(
  current: LocalOrderStatus,
  action: BostaStatusAction,
): LocalOrderStatus | null {
  if (action.type === "keep") return null;
  const next = action.status;
  if (next === current) return null;

  if (TERMINAL_LOCAL.has(current)) {
    return TERMINAL_LOCAL.has(next) ? next : null;
  }

  if (next === "cancelled") return next;
  if (STATUS_RANK[next] < STATUS_RANK[current]) return null;
  return next;
}
