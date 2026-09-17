import { Star } from "lucide-react";
import type { HomepageContent } from "#root/shared/types/homepage-content";
import { StaggerContainer, StaggerItem } from "../../motion/Stagger";
import { MachSectionHead } from "./MachSectionHead";
import { BODY, GUTTER, SECTION_Y_TIGHT, SHELL } from "../machTokens";

type TestimonialsContent = NonNullable<HomepageContent["testimonials"]>;

/**
 * Customer testimonials on the Mach landing page.
 *
 * Renders the homepage CMS `testimonials` block — the same records Homepage
 * Admin edits by hand or fills from a CSV upload. These are storefront
 * quotes, not product reviews: nothing here reads product_review.
 *
 * Language: the Mach storefront has no locale switch, so a testimonial is
 * shown in whatever language it was written, with `dir="auto"` so Arabic
 * quotes lay out right-to-left on their own. When a record carries both an
 * English and an Arabic version, both are shown — the Arabic one beneath,
 * right-aligned — rather than silently dropping one of them.
 *
 * Returns nothing when the section is switched off or has no items, so an
 * empty section never renders as an empty bordered block.
 */
export function MachTestimonials({ content }: { content: TestimonialsContent }) {
  const items = (content.items ?? []).filter(
    (item) => item?.name?.trim() && item?.review?.trim(),
  );
  if (!content.enabled || items.length === 0) return null;

  const title = content.title?.trim() || "What our customers say";
  const titleAr = content.titleAr?.trim();

  return (
    <section
      id="testimonials"
      data-testid="mach-testimonials"
      className="bg-white text-[var(--mach-ink)] scroll-mt-24">
      <div className={`${SHELL} ${GUTTER} ${SECTION_Y_TIGHT}`}>
        <MachSectionHead
          eyebrow={`${items.length} ${items.length === 1 ? "review" : "reviews"}`}
          title={title}
          subtitle={titleAr}
        />

        {/*
          Quotes sit on the section's own white ground, separated by hairlines
          — the same "columns, not cards" rule the Why block follows, so the
          testimonials read as part of the page rather than a widget dropped
          onto it. One column on a phone, two on tablets, three from lg.
        */}
        <StaggerContainer className="mt-8 grid grid-cols-1 gap-x-8 border-t border-[var(--mach-ink)]/12 sm:mt-10 sm:grid-cols-2 lg:mt-12 lg:grid-cols-3">
          {items.map((item, index) => {
            const hasArabic = Boolean(item.reviewAr?.trim());
            const rating = Math.min(5, Math.max(0, Math.round(item.rating)));
            return (
              <StaggerItem
                key={`${index}-${item.name}`}
                className="flex flex-col border-b border-[var(--mach-ink)]/12 py-7 lg:py-8">
                <span
                  className="inline-flex items-center gap-0.5"
                  role="img"
                  aria-label={`${rating} out of 5 stars`}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star
                      key={i}
                      aria-hidden="true"
                      className={
                        i <= rating
                          ? "h-3.5 w-3.5 fill-[var(--mach-ink)] text-[var(--mach-ink)]"
                          : "h-3.5 w-3.5 text-[var(--mach-ink)]/25"
                      }
                    />
                  ))}
                </span>

                <blockquote
                  dir="auto"
                  className={`mt-4 whitespace-pre-line ${BODY} text-[var(--mach-ink)]/85`}>
                  “{item.review.trim()}”
                </blockquote>
                {hasArabic && (
                  <blockquote
                    dir="rtl"
                    lang="ar"
                    className={`mt-3 whitespace-pre-line text-right ${BODY} text-[var(--mach-ink)]/70`}>
                    ”{item.reviewAr?.trim()}“
                  </blockquote>
                )}

                <footer className="mt-auto pt-5">
                  <p
                    dir="auto"
                    className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--mach-ink)]">
                    {item.name.trim()}
                    {item.nameAr?.trim() && (
                      <span
                        dir="rtl"
                        lang="ar"
                        className="ms-2 font-semibold normal-case tracking-normal text-[var(--mach-mute)]">
                        {item.nameAr.trim()}
                      </span>
                    )}
                  </p>
                </footer>
              </StaggerItem>
            );
          })}
        </StaggerContainer>
      </div>
    </section>
  );
}
