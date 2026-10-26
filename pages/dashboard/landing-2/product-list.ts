import { LANDING_MAX_PRODUCTS } from "#root/shared/landing-page/config";

/**
 * The editor's list operations, kept pure so the order the media buyer sees
 * is exactly the order that is saved.
 */

export function moveProduct(ids: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) {
    return [...ids];
  }
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...ids];
  next.splice(to, 0, moved);
  return next;
}

export function removeProduct(ids: readonly string[], id: string): string[] {
  return ids.filter((existing) => existing !== id);
}

/**
 * Puts `replacement` where `id` was. If the replacement is already elsewhere
 * in the list it moves here rather than appearing twice.
 */
export function replaceProduct(
  ids: readonly string[],
  id: string,
  replacement: string,
): string[] {
  if (id === replacement) return [...ids];
  return ids
    .filter((existing) => existing !== replacement)
    .map((existing) => (existing === id ? replacement : existing));
}

/** Appends new ids in the order picked, skipping duplicates, up to the cap. */
export function addProducts(ids: readonly string[], added: readonly string[]): string[] {
  const next = [...ids];
  for (const id of added) {
    if (next.length >= LANDING_MAX_PRODUCTS) break;
    if (!next.includes(id)) next.push(id);
  }
  return next;
}
