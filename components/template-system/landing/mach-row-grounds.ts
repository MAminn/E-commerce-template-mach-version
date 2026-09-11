import { isGroupSectionKey } from "#root/shared/types/homepage-group-sections";

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
 *
 * The rows are no longer a fixed list. Every broad group is its own section
 * now, added and removed by the client in the category system, so membership
 * of the rhythm is a predicate rather than a tuple — a group that appeared
 * this morning alternates like everything else, and a group that is off, new
 * or empty consumes nothing, which is the same rule that already held for the
 * static rows.
 */

/**
 * The non-group merchandising rows that share the alternating rhythm.
 *
 * Offers is deliberately absent: it is the page's ink anchor and keeps its
 * ground whatever it is next to.
 */
export const STATIC_ALTERNATING_ROW_KEYS = [
  "newArrivals",
  "featuredProducts",
  "featuredShelf",
] as const;

export type StaticAlternatingRowKey =
  (typeof STATIC_ALTERNATING_ROW_KEYS)[number];

const STATIC_ALTERNATING = new Set<string>(STATIC_ALTERNATING_ROW_KEYS);

/** Whether a section-order entry takes a turn in the paper / white rhythm. */
export function isAlternatingRowKey(key: string): boolean {
  return STATIC_ALTERNATING.has(key) || isGroupSectionKey(key);
}

/**
 * Whether each merchandising row will actually render, evaluated from the same
 * data the row's own guard uses — enabled in the CMS, not still loading, and
 * holding at least one product.
 *
 * Keyed by section-order entry, so `group:<categoryId>` sits alongside the
 * static keys and neither the caller nor this module needs to know how many
 * groups the store has.
 */
export type MachRowRenderState = Record<string, boolean>;

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
    if (!isAlternatingRowKey(key)) continue;
    if (!renders[key]) continue;
    grounds.set(key, position % 2 === 0 ? "paper" : "white");
    position += 1;
  }
  return grounds;
}
