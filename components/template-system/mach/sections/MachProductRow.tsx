import { StaggerContainer, StaggerItem } from "../../motion/Stagger";
import { MachProductCard, type MachProduct } from "../MachProductCard";
import { GUTTER, SECTION_Y, SHELL } from "../machTokens";
import { MachSectionHead } from "./MachSectionHead";

/**
 * Product merchandising row — the commercial engine of the page.
 *
 * One component drives every product section (Stacks & Bundles, New Drops,
 * Products, Gym Gear, Offers); the caller supplies the CMS copy and the
 * resolved product list, so section identity lives in the CMS rather than in
 * five near-identical components.
 *
 * Scale is the point. Cards are large, the grid is wide, and on mobile the row
 * becomes a horizontal snap-scroller rather than a cramped two-up grid — which
 * is how both reference stores keep product prominence on a phone.
 *
 * `ground` is what produces the page's black/white rhythm: consecutive rows
 * alternate paper / white / ink so the eye gets a hard tonal edge between
 * merchandising blocks instead of one continuous light scroll. Two adjacent
 * light rows also get a hairline top rule, so the break reads even where the
 * tonal step is small.
 *
 * `dense` selects the current merchandising treatment: four products across,
 * a restrained heading that names the shelf instead of competing with it, and
 * tight rhythm above and below. The reference stores rank a shelf by getting
 * more product on screen faster, not by making the type louder.
 *
 * The alternative is the row's original treatment — an 80px headline and a
 * looser grid — which reads as an editorial spread rather than as the place
 * you buy things. It is not a second design anyone chose; it is what the rows
 * that have not been through a design pass yet still look like. Offers is the
 * last one on it, and the flag disappears once that row moves across.
 *
 * A short shelf keeps the four-column grid rather than stretching to fill it:
 * three products in a four-up grid leave the fourth position empty, which
 * reads as a shelf with room on it. Widening the cards to close the gap would
 * make a thin catalogue look like a design decision.
 *
 * Renders nothing when it has no products. The catalog is still being loaded,
 * and a merchandising section with an empty box in it reads as broken, not as
 * "coming soon".
 */

export type MachRowGround = "white" | "paper" | "ink";

/**
 * The ground each row treatment paints, shared with the carousel arrangement.
 *
 * Exported and imported rather than copied, so a section cannot change tone
 * by changing arrangement — Offers in particular stays the page's ink anchor
 * whether it is laid out or scrolled.
 */
export const MACH_ROW_GROUND_CLASSES: Record<MachRowGround, string> = {
  white: "bg-white text-[var(--mach-ink)]",
  paper: "bg-[var(--mach-paper)] text-[var(--mach-ink)]",
  ink: "bg-[var(--mach-ink)] text-white",
};

export function MachProductRow({
  id,
  eyebrow,
  title,
  subtitle,
  actionLabel,
  actionHref,
  products,
  isLoading = false,
  onDark = false,
  ground,
  dense = false,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionHref?: string;
  products: MachProduct[];
  isLoading?: boolean;
  /** Legacy shorthand for `ground="ink"`. */
  onDark?: boolean;
  ground?: MachRowGround;
  /** Current shelf treatment — four-up, compact header, tight rhythm. */
  dense?: boolean;
}) {
  // While the first fetch is in flight we also render nothing, so the page
  // never flashes an empty section and then reflows once products arrive.
  if (isLoading || products.length === 0) return null;

  const resolved: MachRowGround = ground ?? (onDark ? "ink" : "white");
  const isDark = resolved === "ink";

  // A light row butting against another light row needs an edge; a dark row
  // already has one.
  const rule = isDark ? "" : "border-t border-[var(--mach-ink)]/10";

  return (
    <section
      id={id}
      className={`${MACH_ROW_GROUND_CLASSES[resolved]} ${rule} scroll-mt-24`}>
      <div
        className={`${SHELL} ${GUTTER} ${
          dense ? "py-12 sm:py-14 lg:py-16" : SECTION_Y
        }`}>
        <MachSectionHead
          eyebrow={eyebrow}
          title={title}
          subtitle={subtitle}
          actionLabel={actionLabel}
          actionHref={actionHref}
          onDark={isDark}
          size={dense ? "sm" : "default"}
        />

        {/* Mobile: edge-to-edge snap scroller. Desktop: full grid.
            The negative inset lets the scroller bleed past the gutter so the
            row reads as continuing off-screen rather than stopping short.
            Cards are deliberately wide on phones — one and a bit in view —
            so a product reads at real scale rather than as a thumbnail. */}
        <StaggerContainer
          className={`-mx-5 flex snap-x snap-mandatory overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8 lg:mx-0 lg:grid lg:overflow-visible lg:px-0 lg:pb-0 lg:grid-cols-4 ${
            dense
              ? "mt-8 gap-3 sm:gap-4 lg:mt-9 lg:gap-x-5 lg:gap-y-10 xl:gap-x-6"
              : "mt-12 gap-4 sm:gap-5 lg:gap-x-6 lg:gap-y-14 xl:gap-x-8"
          }`}
          amount={0.1}>
          {products.map((product) => (
            <StaggerItem
              key={product.id}
              /* Narrower cards on a dense shelf so close to two are in view
                 with the next one clearly peeking — a phone should read this
                 as a shelf to swipe, not as one product at a time. */
              className={`shrink-0 snap-start lg:w-auto lg:shrink ${
                dense
                  ? "w-[56vw] sm:w-[38vw] md:w-[29vw]"
                  : "w-[68vw] sm:w-[42vw] md:w-[32vw]"
              }`}>
              <MachProductCard
                product={product}
                onDark={isDark}
                size={dense ? "lg" : "default"}
              />
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}
