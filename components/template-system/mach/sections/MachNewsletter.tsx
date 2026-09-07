import { useState } from "react";
import type { HomepageNewsletterContent } from "#root/shared/types/homepage-content";
import { GUTTER, HEADING, SECTION_Y, SHELL } from "../machTokens";

/**
 * Newsletter capture.
 *
 * The single newsletter on the page — the footer's own block is suppressed
 * whenever this section is enabled, so the storefront never asks for the same
 * address twice on one screen (see MachChrome).
 *
 * Heading, subtitle, field placeholder, button label and privacy line are all
 * CMS copy.
 */
export function MachNewsletter({
  content,
}: {
  content: HomepageNewsletterContent;
}) {
  const [submitted, setSubmitted] = useState(false);

  return (
    <section className="bg-[var(--mach-ink)] text-white">
      <div className={`${SHELL} ${GUTTER} ${SECTION_Y}`}>
        <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="min-w-0">
            <h2 className={`${HEADING} text-white`}>{content.title}</h2>
            {content.subtitle && (
              <p className="mt-6 max-w-md text-[15px] leading-relaxed text-white/55">
                {content.subtitle}
              </p>
            )}
          </div>

          <div className="min-w-0">
            {submitted ? (
              <p className="border border-white/20 px-6 py-5 text-[12px] font-bold uppercase tracking-[0.18em] text-white">
                {/* Confirmation is UI state, not brand copy. */}
                Subscribed
              </p>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setSubmitted(true);
                }}
                className="flex flex-col gap-3 sm:flex-row">
                <label htmlFor="mach-newsletter-email" className="sr-only">
                  {content.placeholderText}
                </label>
                <input
                  id="mach-newsletter-email"
                  type="email"
                  required
                  placeholder={content.placeholderText}
                  className="min-w-0 flex-1 border border-white/20 bg-transparent px-5 py-4 text-[13px] tracking-[0.04em] text-white placeholder:text-white/35 transition-colors duration-300 focus:border-white focus:outline-none"
                />
                <button
                  type="submit"
                  className="shrink-0 bg-white px-9 py-4 text-[12px] font-bold uppercase tracking-[0.2em] text-[var(--mach-ink)] ring-1 ring-inset ring-white transition-colors duration-300 hover:bg-transparent hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mach-ink)]">
                  {content.ctaText}
                </button>
              </form>
            )}
            {content.privacyText && (
              <p className="mt-4 text-[11px] tracking-[0.04em] text-white/30">
                {content.privacyText}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
