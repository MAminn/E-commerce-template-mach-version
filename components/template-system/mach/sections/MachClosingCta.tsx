import type { HomepageFooterCtaContent } from "#root/shared/types/homepage-content";
import { isPlaceholderLink } from "#root/shared/types/layout-settings";
import { Reveal } from "../../motion/Reveal";
import { CTA_ON_DARK, EYEBROW, GROUND_INK_SOFT, GUTTER, SECTION_Y, SHELL } from "../machTokens";

/**
 * Closing call to action.
 *
 * Previously a full-bleed lime panel — the loudest thing on the page and the
 * one element most obviously off-brand. On the dark storefront it sits on the
 * lifted charcoal, a step off the true-black newsletter above it and the
 * footer below, so it still reads as its own closing block, and the solid
 * white CTA is the brightest thing in it.
 */
export function MachClosingCta({
  content,
  onCtaClick,
}: {
  content: HomepageFooterCtaContent;
  onCtaClick?: (link: string) => void;
}) {
  const showCta =
    Boolean(content.ctaText?.trim()) && !isPlaceholderLink(content.ctaLink);

  return (
    <section className={GROUND_INK_SOFT}>
      <div className={`${SHELL} ${GUTTER} ${SECTION_Y}`}>
        <Reveal variant="fadeUp">
          <div className="flex flex-col items-center text-center">
            {content.subtitle && (
              <p className={`${EYEBROW} text-white/60`}>
                {content.subtitle}
              </p>
            )}
            <h2 className="mt-5 max-w-4xl font-black uppercase leading-[0.88] tracking-[-0.035em] text-[clamp(2.5rem,8vw,6.5rem)]">
              {content.title}
            </h2>
            {showCta && (
              <div className="mt-10">
                {onCtaClick ? (
                  <button
                    type="button"
                    onClick={() => onCtaClick(content.ctaLink)}
                    className={CTA_ON_DARK}>
                    {content.ctaText}
                  </button>
                ) : (
                  <a href={content.ctaLink} className={CTA_ON_DARK}>
                    {content.ctaText}
                  </a>
                )}
              </div>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
