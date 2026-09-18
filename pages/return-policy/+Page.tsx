import { useData } from "vike-react/useData";
import { useLayoutSettings } from "#root/frontend/contexts/LayoutSettingsContext";
import { useMinimalI18n } from "#root/lib/i18n/MinimalI18nContext";
import { ReturnPolicyPage } from "#root/components/template-system/minimal/ReturnPolicyPage";
import { MachReturnPolicyPage } from "#root/components/template-system/mach/pages/MachReturnPolicyPage";
import { MachPageUnavailable } from "#root/components/template-system/mach/pages/MachPageShell";
import { resolveReturnPolicyPage } from "#root/shared/types/content-pages";
import type { Data } from "./+data";

export { Page };

/**
 * /return-policy — linked from the Mach footer as "Shipping & Returns".
 *
 * Previously Minimal-only, so that footer link led to a hard-coded not-found
 * notice on the live storefront. Both templates now read the same
 * `homepageContent.returnPolicy`; Minimal keeps its existing component
 * untouched and Mach gets the same content in its own visual language.
 */
function Page() {
  const { homepageContent } = useData<Data>();
  const layoutSettings = useLayoutSettings();
  const { locale, dir } = useMinimalI18n();
  const isMinimal = layoutSettings.header.navbarStyle === "minimal";
  const isAr = locale === "ar";

  const returnPolicy = homepageContent.returnPolicy;
  const view = resolveReturnPolicyPage(returnPolicy, locale);

  if (!view) {
    const message = isAr
      ? "هذه الصفحة غير متاحة حالياً"
      : "This page is not available yet";

    if (isMinimal) {
      return (
        <div className='min-h-[60vh] flex items-center justify-center'>
          <p className='text-gray-500'>{message}</p>
        </div>
      );
    }

    return (
      <MachPageUnavailable
        title={isAr ? "سياسة الإرجاع" : "Shipping & Returns"}
        message={message}
      />
    );
  }

  // Minimal's page component owns its own localisation and layout — left
  // exactly as it was so nothing about that storefront changes. A non-null
  // `view` already implies a non-null `returnPolicy`; the check is here for
  // the type checker rather than for the runtime.
  if (isMinimal && returnPolicy) {
    return (
      <ReturnPolicyPage content={returnPolicy} locale={locale} dir={dir} />
    );
  }

  return (
    <MachReturnPolicyPage
      view={view}
      dir={dir}
      eyebrow={isAr ? "المساعدة" : "Help"}
    />
  );
}
