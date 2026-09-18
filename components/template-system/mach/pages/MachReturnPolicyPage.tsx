import { ValuePropIcon } from "#root/components/template-system/shared/value-prop-icons";
import type { ReturnPolicyPageView } from "#root/shared/types/content-pages";
import { BODY, BODY_SM } from "../machTokens";
import { MachPageShell } from "./MachPageShell";

/**
 * /return-policy on the Mach storefront.
 *
 * Reads `homepageContent.returnPolicy` — the same object the Minimal
 * template's `ReturnPolicyPage` renders, resolved through the same
 * `resolveReturnPolicyPage`. Steps and detail sections are the client's; the
 * numbering, the icons and the ordering are theirs too.
 *
 * The closing help line only appears when there is something to offer. The
 * shipped default leaves `supportEmail` blank on purpose, and a
 * `mailto:` with no address behind it is worse than no line at all.
 */
export function MachReturnPolicyPage({
  view,
  eyebrow,
  dir,
}: {
  view: ReturnPolicyPageView;
  eyebrow?: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <MachPageShell eyebrow={eyebrow} title={view.title}>
      <div dir={dir} className='space-y-16 sm:space-y-20'>
        {view.intro && (
          <p className={`${BODY} max-w-[68ch] text-[var(--mach-ink)]/75`}>
            {view.intro}
          </p>
        )}

        {view.steps.length > 0 && (
          <section className='grid grid-cols-1 gap-10 border-t border-[var(--mach-ink)]/10 pt-12 sm:grid-cols-2 xl:grid-cols-4 xl:gap-8'>
            {view.steps.map((step, index) => (
              <div key={`${index}-${step.title}`} className='flex flex-col'>
                <ValuePropIcon
                  icon={step.icon}
                  className='mb-6 h-8 w-8 stroke-[1.25] text-[var(--mach-ink)]'
                />
                <h2 className='mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--mach-ink)]'>
                  {step.title}
                </h2>
                <p className={`${BODY_SM} text-[var(--mach-ink)]/65`}>
                  {step.description}
                </p>
              </div>
            ))}
          </section>
        )}

        {view.detailSections.length > 0 && (
          <section className='grid grid-cols-1 gap-10 border-t border-[var(--mach-ink)]/10 pt-12 md:grid-cols-2 md:gap-16'>
            {view.detailSections.map((section, index) => (
              <div key={`${index}-${section.title}`}>
                <h2 className='mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--mach-ink)]'>
                  {section.title}
                </h2>
                <p className={`${BODY_SM} text-[var(--mach-ink)]/65`}>
                  {section.body}
                </p>
              </div>
            ))}
          </section>
        )}

        {view.help && (
          <section className='border-t border-[var(--mach-ink)]/10 pt-12'>
            <p className={`${BODY_SM} text-[var(--mach-ink)]/65`}>
              {view.help.prefix}
              {view.help.supportEmail && (
                <>
                  {" "}
                  <a
                    href={`mailto:${view.help.supportEmail}`}
                    className='underline underline-offset-4 transition-opacity hover:opacity-60'>
                    {view.help.supportEmail}
                  </a>
                </>
              )}
              {view.help.contactLink && (
                <>
                  {view.help.supportEmail ? ` ${view.help.middle} ` : " "}
                  <a
                    href={view.help.contactLink.url}
                    className='underline underline-offset-4 transition-opacity hover:opacity-60'>
                    {view.help.contactLink.label}
                  </a>
                </>
              )}
              .
            </p>
          </section>
        )}
      </div>
    </MachPageShell>
  );
}
