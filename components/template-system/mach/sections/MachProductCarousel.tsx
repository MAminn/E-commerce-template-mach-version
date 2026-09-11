import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MachProductCard, type MachProduct } from "../MachProductCard";
import { GUTTER, SHELL } from "../machTokens";
import {
  MACH_ROW_GROUND_CLASSES,
  type MachRowGround,
} from "./MachProductRow";
import {
  MachSectionHead,
  machSectionActionVisible,
} from "./MachSectionHead";

/**
 * Product merchandising carousel — the same shelf, scrolled instead of wrapped.
 *
 * This is the second of the two arrangements a product section can be set to
 * in Homepage Admin. It is deliberately *not* a second design: the ground, the
 * gutter, the vertical rhythm, the section header and the product card are the
 * ones `MachProductRow` already uses at its dense size. What changes is that a
 * desktop row stops wrapping onto a second line and starts scrolling sideways,
 * with a pair of arrows to move it.
 *
 * It exists as its own component rather than as a flag on the row because the
 * row's grid is the approved storefront and has to stay exactly as it is. A
 * mode switch inside it would put every grid render one branch away from a
 * regression; here the grid path is untouched by construction.
 *
 * **Native scrolling, not a slider engine.** The track is an ordinary
 * overflow-x container with scroll snapping — the same mechanism the existing
 * `ProductCarousel` and `MinimalProductCarousel` in this repo use, and the same
 * one `MachProductRow` already uses for its mobile shelf. Touch, trackpad,
 * shift-wheel, keyboard and screen-reader scrolling all work because they are
 * the browser's, not a reimplementation of them, and there is no dependency to
 * add or keep current.
 *
 * **The gutter is the part that has to be got right.** The track bleeds past
 * the section's gutter and pays it back as its own inline padding, so the
 * shelf reads as continuing off-screen instead of stopping at a rule. That
 * alone is not enough, and getting it wrong is what made this shelf feel
 * unfinished on a phone: a snap position is measured from the *scrollport* —
 * the track's padding box — so with padding but no `scroll-padding` every card
 * snaps flush to the viewport edge, and the gutter that was visible at rest
 * disappears the moment the shopper swipes. Titles, prices and the quick-add
 * then sit hard against the edge of the phone. `scroll-padding-inline` is what
 * moves the snap positions back inside the gutter, and it is matched to the
 * track's own padding at every breakpoint so the two cannot drift.
 *
 * **No autoplay, ever.** A product shelf that moves on its own takes the
 * shopper's place away while they are reading it and defeats any attempt to
 * compare two items. There are no timers in this file.
 *
 * Renders nothing when it has no products, on exactly the same condition as
 * the row: an empty merchandising block reads as broken, not as "coming soon",
 * and the page's ground alternation counts a section that renders nothing as
 * taking no turn.
 */

/** Marks a card in the track so the scroll step can measure a real one. */
export const CAROUSEL_CARD_ATTRIBUTE = "data-mach-carousel-card";

/**
 * The section gutter, paid back inside the track.
 *
 * Three things that have to agree, so they are written once: the negative
 * margin that lets the shelf bleed to the screen edge, the padding that puts
 * the first and last card back inside the page's own margin, and the
 * scroll-padding that keeps them there once the track has been swiped.
 *
 * The values are `GUTTER`'s, not a number invented for this component. A
 * carousel with its own idea of the page margin would put its first card out
 * of line with the heading directly above it and with every other section on
 * the homepage — a more visible defect than the four pixels between this and a
 * bespoke 16px inset. Desktop drops the bleed entirely: the track sits in the
 * content column, so four cards land exactly on the columns the grid would
 * have used, and the row is cut at the content edge rather than under a margin.
 *
 * Exported for the one invariant it carries: the bleed, the padding and the
 * scroll-padding have to be the same number at every breakpoint. Any two of
 * them disagreeing is a gutter that looks right until the shopper swipes,
 * which is the defect this constant exists to fix and the reason it is
 * asserted rather than left to review.
 */
export const TRACK_GUTTER = [
  "-mx-5 px-5 scroll-px-5",
  "sm:-mx-8 sm:px-8 sm:scroll-px-8",
  "lg:mx-0 lg:px-0 lg:scroll-px-0",
].join(" ");

/**
 * Card width at each breakpoint.
 *
 * Phones get an intrinsic card size — capped in `rem`, floored in `vw` —
 * rather than a flat `vw`. A flat `vw` shows the *same fraction* of a card on
 * every phone, so either a 430px screen wastes the room it has or a 360px one
 * carries cards too narrow to read a two-line product name in. Capping the
 * width lets the peek grow with the screen on its own: about 1.3 cards on a
 * small phone, about 1.5 on a large one. That is the "there is more here" cue,
 * without the shelf ever becoming one full-width card at a time.
 *
 * From `lg` the width is an exact quarter of the content column with the gaps
 * deducted, so the carousel's four cards sit on precisely the columns the grid
 * would have put them on, and the fifth is cut at the content edge.
 */
const CARD_WIDTH = [
  "w-[min(72vw,15.5rem)]",
  "sm:w-[17rem]",
  "md:w-[18.5rem]",
  "lg:w-[calc((100%-3*1.25rem)/4)]",
  "xl:w-[calc((100%-3*1.5rem)/4)]",
].join(" ");

/**
 * Gaps — which the `lg` / `xl` card widths above are calculated against.
 *
 * 12px on a phone is wide enough that two cards never read as one object and
 * narrow enough not to compete with the page gutter. The desktop steps are the
 * dense grid's own, because at those widths the carousel is standing in for
 * the grid and has to measure like it.
 */
const CARD_GAP = "gap-3 sm:gap-3.5 md:gap-4 lg:gap-5 xl:gap-6";

/**
 * Focus-ring gap colour per ground, so the ring reads on all three.
 *
 * A ring offset is a solid band painted between the control and the ring, so
 * it has to be the colour of whatever is actually behind the button. Hard-
 * coding white — the Tailwind default — puts a white halo around the arrows on
 * the Offers shelf and a slightly-wrong one on every paper row.
 */
export const RING_OFFSET: Record<MachRowGround, string> = {
  white: "focus-visible:ring-offset-white",
  paper: "focus-visible:ring-offset-[var(--mach-paper)]",
  ink: "focus-visible:ring-offset-[var(--mach-ink)]",
};

/**
 * The accessible names of the two controls.
 *
 * Built from the section's own heading, so a page carrying four carousels does
 * not present eight buttons all called "Previous" — a screen-reader user
 * landing on one hears which shelf it moves. Exported because it is the
 * contract the controls are tested against.
 */
export function machCarouselControlLabels(title: string): {
  previous: string;
  next: string;
} {
  const shelf = title.trim();
  return shelf
    ? { previous: `Previous products in ${shelf}`, next: `Next products in ${shelf}` }
    : { previous: "Previous products", next: "Next products" };
}

/**
 * How far one press of an arrow moves the track.
 *
 * A whole screenful of cards, so the shelf pages rather than nudges: a four-up
 * desktop moves by four, a phone showing one card and a peek moves by one.
 * Never more than fits, so no card is carried past unseen.
 *
 * The `+ gap` is the load-bearing part, and is not a fudge. `n` cards occupy
 * `n × card + (n − 1) × gap` — the last one has no trailing gap — so `n` of
 * them fit when `n ≤ (viewport + gap) / stride`. Dividing the viewport by the
 * stride alone is short by exactly one gap, which on a four-up desktop reads
 * as 3.92 and floors to a three-card step: the shelf would page by three
 * through a four-card view forever, which is precisely the "jumps
 * unpredictably" feeling this rule exists to remove.
 *
 * Pure, and exported, because "a sensible group of cards" is a rule worth
 * pinning rather than a number buried in an event handler.
 */
export function machCarouselScrollStep(
  viewport: number,
  cardWidth: number,
  gap: number,
): number {
  const stride = cardWidth + gap;
  if (!Number.isFinite(stride) || stride <= 0) return Math.max(0, viewport);
  const perView = Math.max(1, Math.floor((viewport + gap) / stride));
  return stride * perView;
}

export function MachProductCarousel({
  id,
  eyebrow,
  title,
  subtitle,
  actionLabel,
  actionHref,
  products,
  isLoading = false,
  ground,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionHref?: string;
  products: MachProduct[];
  isLoading?: boolean;
  ground?: MachRowGround;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [canScrollOn, setCanScrollOn] = useState(false);
  const prefersReducedMotion = useReducedMotion() ?? false;

  const syncControls = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    // Absolute, so the same maths holds in a right-to-left document where
    // `scrollLeft` runs negative.
    const offset = Math.abs(el.scrollLeft);
    const overflow = el.scrollWidth - el.clientWidth;
    setCanScrollBack(offset > 4);
    setCanScrollOn(offset < overflow - 4);
  }, []);

  useEffect(() => {
    syncControls();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", syncControls, { passive: true });
    window.addEventListener("resize", syncControls);
    return () => {
      el.removeEventListener("scroll", syncControls);
      window.removeEventListener("resize", syncControls);
    };
    // Re-measured when the shelf's contents change, since that changes how
    // much there is to scroll.
  }, [syncControls, products.length]);

  const scrollByPage = useCallback(
    (direction: 1 | -1) => {
      const el = trackRef.current;
      if (!el) return;
      const card = el.querySelector<HTMLElement>(`[${CAROUSEL_CARD_ATTRIBUTE}]`);
      const gap = Number.parseFloat(getComputedStyle(el).columnGap || "0") || 0;
      const step = machCarouselScrollStep(
        el.clientWidth,
        // Fractional, because the desktop width is a quarter of the content
        // column and a rounded `clientWidth` would drift a pixel per card.
        card?.getBoundingClientRect().width ?? el.clientWidth,
        gap,
      );
      el.scrollBy({
        left: step * direction,
        // A shopper who has asked the system for less motion gets the jump
        // rather than the glide; the shelf still moves the same distance.
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    },
    [prefersReducedMotion],
  );

  /**
   * Arrow keys page the shelf while the track itself has focus.
   *
   * The browser already scrolls a focused scroll container with the arrow
   * keys, but by a line at a time — on a shelf of 280px cards that is a crawl
   * that fights the snap points. This is the same page step the buttons take
   * and nothing more: no roving tabindex, no focus management, no state.
   */
  const onTrackKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    scrollByPage(event.key === "ArrowRight" ? 1 : -1);
  };

  // Same guard as the row, so a section behaves identically in both
  // arrangements and the page's ground rhythm cannot disagree with what is
  // actually on screen.
  if (isLoading || products.length === 0) return null;

  const resolved: MachRowGround = ground ?? "white";
  const isDark = resolved === "ink";
  const rule = isDark ? "" : "border-t border-[var(--mach-ink)]/10";
  const labels = machCarouselControlLabels(title);
  const hasAction = machSectionActionVisible(actionLabel, actionHref);

  /**
   * One navigation control.
   *
   * Square, hairline, and inverting on hover — the same move the MACH CTA
   * tokens make — so the arrows read as part of this page's button language
   * rather than as a carousel widget dropped onto it. Every hover and press
   * state is behind `enabled:`, because a control at the end of the shelf has
   * to look inert when the pointer is over it, not merely dimmed.
   */
  const controlCls = [
    "relative inline-flex h-11 w-11 items-center justify-center border",
    "transition-colors duration-200",
    "hover:z-10 focus-visible:z-10",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    RING_OFFSET[resolved],
    "disabled:cursor-not-allowed disabled:opacity-30",
    isDark
      ? [
          "border-white/30 text-white",
          "enabled:hover:border-white enabled:hover:bg-white enabled:hover:text-[var(--mach-ink)]",
          "enabled:active:border-[var(--mach-paper)] enabled:active:bg-[var(--mach-paper)]",
          "focus-visible:ring-white",
        ].join(" ")
      : [
          "border-[var(--mach-ink)]/25 text-[var(--mach-ink)]",
          "enabled:hover:border-[var(--mach-ink)] enabled:hover:bg-[var(--mach-ink)] enabled:hover:text-white",
          "enabled:active:border-[var(--mach-ink-soft)] enabled:active:bg-[var(--mach-ink-soft)]",
          "focus-visible:ring-[var(--mach-ink)]",
        ].join(" "),
  ].join(" ");

  return (
    <section
      id={id}
      className={`${MACH_ROW_GROUND_CLASSES[resolved]} ${rule} scroll-mt-24`}>
      <div className={`${SHELL} ${GUTTER} py-12 sm:py-14 lg:py-16`}>
        <MachSectionHead
          eyebrow={eyebrow}
          title={title}
          subtitle={subtitle}
          actionLabel={actionLabel}
          actionHref={actionHref}
          onDark={isDark}
          size='sm'
          actions={
            /* Hidden below `md`, where the shelf is swiped and a pair of 44px
               targets would only take room from the products. Everything they
               do is reachable by swiping, or by the arrow keys once the track
               has focus. */
            <div className='hidden items-center gap-5 md:flex'>
              {/* Hairline between the link and the controls: it reads them as
                  one cluster on the header's baseline instead of leaving two
                  bordered squares floating beside a text link. Only drawn when
                  there is a link to separate them from. */}
              {hasAction && (
                <span
                  aria-hidden='true'
                  className={`h-7 w-px ${
                    isDark ? "bg-white/20" : "bg-[var(--mach-ink)]/15"
                  }`}
                />
              )}
              {/* The pair shares one edge rather than sitting apart, so it
                  reads as a single navigation control. */}
              <div className='flex items-center'>
                <button
                  type='button'
                  onClick={() => scrollByPage(-1)}
                  disabled={!canScrollBack}
                  aria-label={labels.previous}
                  className={controlCls}>
                  <ChevronLeft
                    aria-hidden='true'
                    strokeWidth={1.75}
                    className='h-4.5 w-4.5'
                  />
                </button>
                <button
                  type='button'
                  onClick={() => scrollByPage(1)}
                  disabled={!canScrollOn}
                  aria-label={labels.next}
                  className={`${controlCls} -ml-px`}>
                  <ChevronRight
                    aria-hidden='true'
                    strokeWidth={1.75}
                    className='h-4.5 w-4.5'
                  />
                </button>
              </div>
            </div>
          }
        />

        {/* The track.

            `py-1` is not decoration: the card's stretched product link draws a
            2px focus ring 2px outside itself, and a scroll container clips at
            its padding box — without it a keyboard user's focus ring would be
            shaved off the top and bottom card edges. The margin above is
            reduced by the same amount, so the space under the heading is
            unchanged.

            Focusable and labelled, because a scrollable region a pointer can
            drag has to be reachable from the keyboard too. */}
        <div
          ref={trackRef}
          tabIndex={0}
          role='group'
          aria-label={title}
          onKeyDown={onTrackKeyDown}
          className={`scrollbar-hide mt-7 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain py-1 focus-visible:outline-none lg:mt-8 ${TRACK_GUTTER} ${CARD_GAP}`}>
          {products.map((product) => (
            <div
              key={product.id}
              {...{ [CAROUSEL_CARD_ATTRIBUTE]: "" }}
              className={`shrink-0 snap-start ${CARD_WIDTH}`}>
              <MachProductCard product={product} onDark={isDark} size='lg' />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
