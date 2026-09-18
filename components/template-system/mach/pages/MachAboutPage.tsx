import type { AboutPageView } from "#root/shared/types/content-pages";
import { BODY } from "../machTokens";
import { MachPageShell } from "./MachPageShell";

/**
 * /about-us on the Mach storefront.
 *
 * Same content model the Minimal template reads — `homepageContent.aboutUs` —
 * rendered in Mach's language: ink masthead, then a single measured reading
 * column on paper with the CMS image, when one exists, running alongside it.
 *
 * Nothing here is written in this file. Title, copy and image all come from
 * Dashboard → Homepage → About Us Page.
 */
export function MachAboutPage({
  view,
  eyebrow,
  dir,
}: {
  view: AboutPageView;
  eyebrow?: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <MachPageShell eyebrow={eyebrow} title={view.title}>
      <div
        dir={dir}
        className={`flex flex-col gap-12 lg:gap-20 ${
          view.imageUrl ? "lg:flex-row lg:items-start" : ""
        }`}>
        {view.imageUrl && (
          <div className='w-full shrink-0 lg:w-[44%]'>
            <div className='aspect-[4/5] overflow-hidden bg-[var(--mach-ink)]/5'>
              <img
                src={view.imageUrl}
                alt={view.title}
                loading='lazy'
                className='h-full w-full object-cover'
              />
            </div>
          </div>
        )}

        <div
          className={`w-full space-y-6 ${
            view.imageUrl ? "lg:flex-1" : "max-w-[68ch]"
          }`}>
          {view.paragraphs.map((paragraph, index) => (
            <p
              key={`${index}-${paragraph.slice(0, 24)}`}
              className={`${BODY} text-[var(--mach-ink)]/75`}>
              {paragraph}
            </p>
          ))}
        </div>
      </div>
    </MachPageShell>
  );
}
