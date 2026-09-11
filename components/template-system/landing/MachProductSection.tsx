import type {
  GroupSectionPresentation,
  ProductSectionDisplayMode,
} from "#root/shared/types/homepage-content";
import type { MachProduct } from "../mach/MachProductCard";
import { MachProductCarousel } from "../mach/sections/MachProductCarousel";
import {
  MachProductRow,
  type MachRowGround,
} from "../mach/sections/MachProductRow";
import { MachStackShowcase } from "../mach/sections/MachStackShowcase";
import { groupSectionComponent } from "./mach-group-rendering";

/**
 * One product section on the Mach homepage, whichever family it belongs to.
 *
 * The page has two kinds of product section — the dynamic group sections and
 * the four curated merchandising shelves — and until now each one carried its
 * own `<MachProductRow …>` call in the layout. Giving every section a choice
 * of arrangement would have meant writing that choice out six times, which is
 * six places for the grid path to drift from the storefront that is already
 * approved. So the choice is made once, here, and the layout passes the same
 * things it was passing before plus the mode the client picked.
 *
 * What this component decides is *only* the arrangement. It receives the
 * products already resolved, already ordered and already limited; there is no
 * query, no sort and no slice anywhere in this file. A section shows the same
 * products in the same order in either mode — that is the whole guarantee the
 * display mode rests on, and it holds structurally because there is nothing
 * here that could break it.
 */

export interface MachProductSectionProps {
  id?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionHref?: string;
  products: MachProduct[];
  isLoading?: boolean;
  ground?: MachRowGround;
  /** The client's choice. Resolve `undefined` to `"grid"` before passing it. */
  displayMode: ProductSectionDisplayMode;
  /**
   * Which grid treatment the section uses. Read only in grid mode — a section
   * set to carousel keeps whatever is stored here untouched, so switching back
   * restores the treatment it had.
   *
   * The merchandising shelves do not offer this choice and never pass it; they
   * are shelves.
   */
  presentation?: GroupSectionPresentation;
}

/**
 * The component a section renders through, as a pure function of the two
 * settings.
 *
 * Worth stating separately from the JSX because it is the one place the
 * interaction between the two axes is decided, and the rule it encodes is a
 * promise to the client rather than an implementation detail: in grid mode the
 * page behaves exactly as it did before display modes existed, and in carousel
 * mode `presentation` is not consulted at all — feature panels are a grid
 * treatment and a carousel of them is not a thing that exists.
 */
export function machProductSectionComponent(
  displayMode: ProductSectionDisplayMode,
  presentation: GroupSectionPresentation = "shelf",
):
  | typeof MachProductCarousel
  | typeof MachStackShowcase
  | typeof MachProductRow {
  if (displayMode === "carousel") return MachProductCarousel;
  return groupSectionComponent(presentation);
}

export function MachProductSection({
  displayMode,
  presentation,
  ...section
}: MachProductSectionProps) {
  const Treatment = machProductSectionComponent(displayMode, presentation);

  if (Treatment === MachProductCarousel) {
    return <MachProductCarousel {...section} />;
  }
  if (Treatment === MachStackShowcase) {
    return <MachStackShowcase {...section} />;
  }
  // `dense` is the current merchandising treatment and every product section
  // on this page already renders with it. It is passed here rather than left
  // to the caller precisely so no section can quietly lose it.
  return <MachProductRow {...section} dense />;
}
