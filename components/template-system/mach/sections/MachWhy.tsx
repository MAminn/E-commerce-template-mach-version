import type { HomepageWhyMachContent } from "#root/shared/types/homepage-content";
import { VALUE_PROP_ICON_MAP } from "../../shared/value-prop-icons";
import { StaggerContainer, StaggerItem } from "../../motion/Stagger";
import { normalizeMediaUrl } from "../MachMedia";
import {
  GUTTER,
  HEADING,
  SECTION_Y_TIGHT,
  SHELL,
  EYEBROW,
} from "../machTokens";

/**
 * "Why Mach" trust pillars.
 *
 * This is a scanning block, not a reading block. A shopper deciding whether to
 * trust the store should take all three reasons in one glance, so the section
 * is built to be short and flat rather than tall and layered.
 *
 * **Columns, not cards.** The pillars previously sat on their own `--mach-ink`
 * panels inside a hairline grid, which on the charcoal section ground read as
 * three large boxes dropped onto the page — feature-pricing chrome, and the
 * single biggest source of the section's height. They now share the section's
 * own ground and are separated only by hairlines: a rule across the top, and
 * dividers between the columns. Same information, no container.
 *
 * **The numeral is a watermark.** It stays oversized because the index is part
 * of the section's rhythm, but it is absolutely positioned at 7% white behind
 * a fixed lead-in, so it costs a controlled band of space instead of a full
 * line box plus a gap, and it sits under the title rather than above it in the
 * hierarchy. The icon drops its bordered 40px tile — the box was reading as a
 * placeholder — and becomes a plain line glyph on the numeral's rail.
 *
 * All copy, icons, optional imagery and the oversized figure are CMS records.
 * The client can add, remove and reorder pillars.
 */
export function MachWhy({ content }: { content: HomepageWhyMachContent }) {
  const items = content.items ?? [];
  if (items.length === 0) return null;

  return (
    // Lifted charcoal rather than true black: the Offers row directly above is
    // already on ink, and two true-black blocks in sequence read as one long
    // section with no edge between them.
    <section
      id="why"
      className="bg-[var(--mach-ink-soft)] text-white scroll-mt-24">
      <div className={`${SHELL} ${GUTTER} ${SECTION_Y_TIGHT}`}>
        {content.subtitle && (
          <p className={`${EYEBROW} text-white/70`}>
            <span
              aria-hidden="true"
              className="inline-block h-[2px] w-6 shrink-0 bg-white"
            />
            {content.subtitle}
          </p>
        )}
        {content.title && (
          <h2 className={`mt-3 max-w-4xl ${HEADING} text-white`}>
            {content.title}
          </h2>
        )}

        {/*
          One row of equal columns from `md` up. The intermediate two-across
          arrangement was dropped: three pillars in two columns leaves a
          stranded third, and the orphan is what made the block feel bulky on
          tablets. Below `md` it is a plain divided stack.
        */}
        <StaggerContainer className="mt-8 grid grid-cols-1 divide-y divide-white/10 border-t border-white/12 sm:mt-10 md:grid-cols-3 md:divide-x md:divide-y-0 lg:mt-12">
          {items.map((item, index) => {
            const Icon = item.icon ? VALUE_PROP_ICON_MAP[item.icon] : null;
            const image = normalizeMediaUrl(item.imageUrl);
            // Falls back to a positional index so the numeral is always
            // present even when the client leaves the figure blank.
            const stat = item.stat?.trim();
            const figure = stat || String(index + 1).padStart(2, "0");

            return (
              <StaggerItem
                key={item.id}
                // Outer columns run flush to the section gutter so the first
                // pillar lines up with the eyebrow and heading above it.
                className="py-6 md:px-7 md:py-8 md:first:pl-0 md:last:pr-0 lg:px-8">
                {image && (
                  // Uploaded imagery renders at full colour. The monochrome
                  // rule is for interface chrome; a product or facility photo
                  // is information, and desaturating it throws that away.
                  <div className="mb-6 aspect-3/2 w-full overflow-hidden bg-[var(--mach-ink-raised)]">
                    <img
                      src={image}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}

                {/*
                  The lead-in padding is tuned to clear the numeral's ink
                  height at each step, so the watermark reads as its own band
                  above the title instead of bleeding behind it.
                */}
                <div className="relative pt-10 md:pt-11 lg:pt-13">
                  <span
                    // A client-authored figure ("100%") is content; the
                    // positional fallback is decoration.
                    aria-hidden={stat ? undefined : "true"}
                    className="pointer-events-none absolute left-0 top-0 max-w-[calc(100%-2.5rem)] select-none overflow-hidden text-ellipsis whitespace-nowrap text-[2.5rem] font-black leading-none tracking-[-0.05em] text-white/[0.07] md:text-[2.875rem] lg:text-[3.25rem]">
                    {figure}
                  </span>
                  {Icon && (
                    <span
                      aria-hidden="true"
                      className="absolute right-0 top-1 text-white/40">
                      <Icon className="h-5 w-5" />
                    </span>
                  )}

                  <h3 className="text-[17px] font-black uppercase leading-[1.1] tracking-[-0.01em] text-white md:text-lg lg:text-[1.375rem]">
                    {item.title}
                  </h3>
                  <p className="mt-2.5 text-[14px] leading-[1.65] text-white/60 lg:text-[15px]">
                    {item.description}
                  </p>
                </div>
              </StaggerItem>
            );
          })}
        </StaggerContainer>
      </div>
    </section>
  );
}
