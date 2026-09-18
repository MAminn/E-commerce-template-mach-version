import { useData } from "vike-react/useData";
import { useLayoutSettings } from "#root/frontend/contexts/LayoutSettingsContext";
import { useMinimalI18n } from "#root/lib/i18n/MinimalI18nContext";
import { MachAboutPage } from "#root/components/template-system/mach/pages/MachAboutPage";
import {
  MachPageUnavailable,
} from "#root/components/template-system/mach/pages/MachPageShell";
import { resolveAboutPage } from "#root/shared/types/content-pages";
import type { Data } from "./+data";

export { Page };

/**
 * /about-us
 *
 * The route used to render a hard-coded not-found notice for every storefront
 * except Minimal, while `DEFAULT_LAYOUT_SETTINGS` shipped an "About" entry in
 * both the navbar and the footer — so the Mach storefront linked to its own
 * dead end from two places. The template check is gone: what the active
 * template now decides is how the page *looks*, never whether it exists.
 *
 * Both renderings read the same `homepageContent.aboutUs` through the same
 * resolver, so they can only ever disagree about presentation.
 */
function Page() {
  const { homepageContent } = useData<Data>();
  const layoutSettings = useLayoutSettings();
  const { locale, dir } = useMinimalI18n();
  const isMinimal = layoutSettings.header.navbarStyle === "minimal";
  const isAr = locale === "ar";

  const view = resolveAboutPage(homepageContent.aboutUs, locale);

  if (!view) {
    const message = isAr
      ? "هذه الصفحة غير متاحة حالياً"
      : "This page is not available yet";

    // Minimal keeps the bare notice it has always shown.
    if (isMinimal) {
      return (
        <div className='min-h-[60vh] flex items-center justify-center'>
          <p className='text-gray-500'>{message}</p>
        </div>
      );
    }

    return (
      <MachPageUnavailable
        title={isAr ? "من نحن" : "About"}
        message={message}
      />
    );
  }

  if (isMinimal) {
    return (
      <div className='min-h-[60vh]' dir={dir}>
        <div className='max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24'>
          <div
            className={`flex flex-col ${view.imageUrl ? "lg:flex-row" : ""} gap-10 lg:gap-16 items-center`}>
            {view.imageUrl && (
              <div className='w-full lg:w-1/2 flex-shrink-0'>
                <div className='aspect-[4/5] sm:aspect-[3/4] overflow-hidden'>
                  <img
                    src={view.imageUrl}
                    alt={view.title}
                    className='w-full h-full object-cover'
                  />
                </div>
              </div>
            )}

            <div
              className={`w-full ${view.imageUrl ? "lg:w-1/2" : "max-w-2xl mx-auto text-center"}`}>
              <h1 className='text-3xl sm:text-4xl lg:text-5xl font-light tracking-wide text-gray-900 mb-6 sm:mb-8'>
                {view.title}
              </h1>
              <div className='space-y-4'>
                {view.paragraphs.map((paragraph, idx) => (
                  <p
                    key={`${idx}-${paragraph.slice(0, 24)}`}
                    className='text-base sm:text-lg text-gray-600 leading-relaxed font-light'>
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <MachAboutPage
      view={view}
      dir={dir}
      eyebrow={isAr ? "من نحن" : "About"}
    />
  );
}
