/**
 * Which merchandising rows carry which ground on the Mach homepage.
 *
 * The page's black/white rhythm is assigned by position rather than pinned per
 * section, so it survives the client reordering Section Order. The rule is
 * simply "these rows alternate paper / white in whatever order they end up
 * in", with Offers staying on ink as the dark merchandising anchor.
 *
 * The bug this module exists to fix: the alternation used to be counted over
 * the whole saved order, including rows that render nothing. A row that is
 * switched off, still loading or has no products consumed an alternation slot
 * from inside a `null`, which pushed the next *visible* row onto the same
 * ground as the visible one before it — two identical bands touching, with no
 * edge between them. Only rows that actually render take a turn.
 */

/** The rows that share the alternating paper / white rhythm. */
export const ALTERNATING_ROW_KEYS = [
  "stacks",
  "newArrivals",
  "featuredProducts",
  "gymGear",
] as const;

export type AlternatingRowKey = (typeof ALTERNATING_ROW_KEYS)[number];

/**
 * Whether each alternating row will actually render, evaluated from the same
 * data the row's own guard uses — enabled in the CMS, not still loading, and
 * holding at least one product.
 */
export type MachRowRenderState = Record<AlternatingRowKey, boolean>;

const ALTERNATING = new Set<string>(ALTERNATING_ROW_KEYS);

/**
 * Assigns paper / white to the merchandising rows that will render, in page
 * order. Rows that render nothing are absent from the map entirely.
 */
export function resolveRowGrounds(
  order: string[],
  renders: MachRowRenderState,
): Map<string, "paper" | "white"> {
  const grounds = new Map<string, "paper" | "white">();
  let position = 0;
  for (const key of order) {
    if (!ALTERNATING.has(key)) continue;
    if (!renders[key as AlternatingRowKey]) continue;
    grounds.set(key, position % 2 === 0 ? "paper" : "white");
    position += 1;
  }
  return grounds;
}
