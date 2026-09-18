import { useData } from "vike-react/useData";
import { useLayoutSettings } from "#root/frontend/contexts/LayoutSettingsContext";
import { useMinimalI18n } from "#root/lib/i18n/MinimalI18nContext";
import { HeroCarousel } from "#root/components/ui/hero-carousel";
import { MachContactPage } from "#root/components/template-system/mach/pages/MachContactPage";
import { useContactForm } from "#root/hooks/useContactForm";
import { resolveContactPage } from "#root/shared/types/content-pages";
import { ArrowUpRight, Loader2 } from "lucide-react";
import type { Data } from "./+data";

export { Page };

/**
 * /contact
 *
 * Previously Minimal-only, so on Mach it answered with a hard-coded not-found
 * notice while the Mach footer's Company column linked straight to it.
 *
 * Both templates submit through `useContactForm`, i.e. the existing
 * `contact.submit` mutation — there is exactly one contact backend and this
 * change does not add a second. The page always renders: the form is the point
 * of it, and `contactBanner.enabled` only governs the banner imagery.
 */
function Page() {
  const { homepageContent } = useData<Data>();
  const layoutSettings = useLayoutSettings();
  const { locale, dir } = useMinimalI18n();
  const isMinimal = layoutSettings.header.navbarStyle === "minimal";
  const isAr = locale === "ar";

  const view = resolveContactPage(homepageContent.contactBanner, locale);

  if (!isMinimal) {
    return (
      <MachContactPage
        view={view}
        locale={locale}
        dir={dir}
        eyebrow={isAr ? "تواصل معنا" : "Contact"}
      />
    );
  }

  return <MinimalContactPage view={view} locale={locale} dir={dir} />;
}

/**
 * The Minimal storefront's contact page, unchanged in behaviour and
 * appearance — only its form wiring moved into the shared hook.
 */
function MinimalContactPage({
  view,
  locale,
  dir,
}: {
  view: ReturnType<typeof resolveContactPage>;
  locale: "en" | "ar";
  dir: "ltr" | "rtl";
}) {
  const form = useContactForm(locale);
  const isAr = locale === "ar";

  const bannerSlides = view.images.map((image) => ({
    imageUrl: image.imageUrl,
    mobileImageUrl: image.mobileImageUrl ?? undefined,
    alt: image.alt ?? undefined,
  }));

  return (
    <div className='minimal-template' dir={dir}>
      {/* ── Banner ── */}
      {bannerSlides.length > 0 && (
        <div className='w-full'>
          <HeroCarousel
            slides={bannerSlides}
            interval={6000}
            className='max-h-[400px]'
          />
        </div>
      )}

      {/* ── Contact Section ── */}
      <div className='max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24'>
        <div className='grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20'>
          {/* ── Left Column: Heading + Description ── */}
          <div className='flex flex-col justify-center'>
            <h1 className='text-3xl sm:text-4xl lg:text-[42px] font-bold uppercase leading-tight tracking-tight'>
              {view.heading}
            </h1>

            {view.description && (
              <p className='mt-6 text-sm sm:text-base text-gray-600 leading-relaxed max-w-md'>
                {view.description}
              </p>
            )}

            {view.directionsUrl && (
              <a
                href={view.directionsUrl}
                target='_blank'
                rel='noopener noreferrer'
                className='inline-flex items-center gap-1.5 mt-8 text-xs font-semibold uppercase tracking-widest hover:opacity-70 transition-opacity'>
                {isAr ? "احصل على الاتجاهات" : "Get Directions"}
                <ArrowUpRight className='w-3.5 h-3.5' />
              </a>
            )}
          </div>

          {/* ── Right Column: Form ── */}
          <div>
            <form onSubmit={form.handleSubmit} className='space-y-6'>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-6'>
                <div>
                  <input
                    type='text'
                    value={form.name}
                    onChange={(e) => form.setName(e.target.value)}
                    placeholder={isAr ? "الاسم" : "Name"}
                    required
                    maxLength={200}
                    className='w-full border-b border-gray-300 bg-transparent py-3 text-sm placeholder:text-gray-400 focus:border-black focus:outline-none transition-colors'
                    dir={dir}
                  />
                </div>
                <div>
                  <input
                    type='email'
                    value={form.email}
                    onChange={(e) => form.setEmail(e.target.value)}
                    placeholder={isAr ? "البريد الإلكتروني" : "Email"}
                    required
                    maxLength={200}
                    className='w-full border-b border-gray-300 bg-transparent py-3 text-sm placeholder:text-gray-400 focus:border-black focus:outline-none transition-colors'
                    dir={dir}
                  />
                </div>
              </div>

              <div>
                <textarea
                  value={form.message}
                  onChange={(e) => form.setMessage(e.target.value)}
                  placeholder={isAr ? "الرسالة" : "Message"}
                  required
                  maxLength={5000}
                  rows={6}
                  className='w-full border-b border-gray-300 bg-transparent py-3 text-sm placeholder:text-gray-400 focus:border-black focus:outline-none transition-colors resize-none'
                  dir={dir}
                />
              </div>

              <div>
                <button
                  type='submit'
                  disabled={form.isSubmitting}
                  className='inline-flex items-center justify-center gap-2 border border-black bg-transparent px-8 py-3 text-xs font-semibold uppercase tracking-widest hover:bg-black hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed'>
                  {form.isSubmitting && (
                    <Loader2 className='w-3.5 h-3.5 animate-spin' />
                  )}
                  {form.isSubmitting
                    ? isAr
                      ? "جاري الإرسال..."
                      : "Sending..."
                    : isAr
                      ? "إرسال"
                      : "Submit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
