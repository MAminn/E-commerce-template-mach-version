import type { GroupSectionPresentation } from "#root/shared/types/homepage-content";
import type { ResolvedGroupSection } from "#root/shared/types/homepage-group-sections";
import { MachProductRow } from "../mach/sections/MachProductRow";
import { MachStackShowcase } from "../mach/sections/MachStackShowcase";

/**
 * The two decisions the homepage makes about a broad group section, as
 * functions rather than as expressions buried in a JSX branch.
 *
 * Both are worth stating once, in one place, because both are shared: whether
 * a group renders is asked by the layout (to work out the page's paper / white
 * rhythm) and again by the group's own branch, and the two answers disagreeing
 * is precisely the bug the row-ground work fixed. Which treatment a group uses
 * decides whether the client's existing Stacks presentation survives the move
 * to dynamic groups, which is the kind of thing worth pinning with a test
 * rather than reading off a page in a browser.
 */

/** Just enough of a group's runtime products for the render decision. */
export interface GroupProductsSnapshot {
  products: readonly unknown[];
  isLoading?: boolean;
}

/**
 * Whether a group section will actually put something on the page.
 *
 * The same three conditions the row components apply themselves — switched on,
 * not still loading, holding at least one product — stated where the layout
 * can see them. A group that is off, new, mid-fetch or empty renders nothing
 * and, because this is the predicate the ground alternation reads too, takes
 * no turn in the page's rhythm either.
 */
export function groupSectionRenders(
  section: Pick<ResolvedGroupSection, "enabled">,
  snapshot: GroupProductsSnapshot | undefined,
): boolean {
  if (!section.enabled) return false;
  if (snapshot?.isLoading) return false;
  return (snapshot?.products.length ?? 0) > 0;
}

/**
 * The storefront component a group section renders through.
 *
 * `feature` is the composed panel treatment built for a group that carries two
 * or three items on purpose — bundles — which a four-up shelf would leave
 * holes in. `shelf` is the dense product row every other merchandising section
 * uses. Neither component's design changes with this; the choice is simply
 * something the client now makes per group instead of it being implied by
 * which hard-coded section key they happened to be in.
 */
export function groupSectionComponent(
  presentation: GroupSectionPresentation,
): typeof MachStackShowcase | typeof MachProductRow {
  return presentation === "feature" ? MachStackShowcase : MachProductRow;
}
