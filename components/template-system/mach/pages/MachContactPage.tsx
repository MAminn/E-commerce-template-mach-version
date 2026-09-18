import { ArrowUpRight, Loader2 } from "lucide-react";
import { useContactForm } from "#root/hooks/useContactForm";
import type { ContactPageView } from "#root/shared/types/content-pages";
import { BODY, CTA_ON_LIGHT } from "../machTokens";
import { MachPageShell } from "./MachPageShell";

/**
 * /contact on the Mach storefront.
 *
 * Copy comes from `homepageContent.contactBanner`; the form posts through
 * `useContactForm`, which is the same `contact.submit` mutation the Minimal
 * page has always used.
 *
 * The banner content model is a slideshow because the Minimal template runs a
 * carousel there. Mach does not: a contact page is a form, and a rotating hero
 * above one is motion with nothing to say. The first uploaded banner image is
 * used as a still masthead instead, so the field the client already filled in
 * still shows up.
 */
export function MachContactPage({
  view,
  locale,
  dir,
  eyebrow,
}: {
  view: ContactPageView;
  locale: "en" | "ar";
  dir?: "ltr" | "rtl";
  eyebrow?: string;
}) {
  const form = useContactForm(locale);
  const isAr = locale === "ar";
  const masthead = view.images[0] ?? null;

  const fieldCls =
    "w-full border-0 border-b border-[var(--mach-ink)]/20 bg-transparent px-0 py-3 text-sm text-[var(--mach-ink)] transition-colors duration-300 placeholder:text-[var(--mach-ink)]/35 focus:border-[var(--mach-ink)] focus:outline-none";

  return (
    <MachPageShell eyebrow={eyebrow} title={view.heading}>
      <div dir={dir} className='grid grid-cols-1 gap-14 lg:grid-cols-2 lg:gap-20'>
        {/* ── Left: what the client wants to say ── */}
        <div className='flex flex-col'>
          {view.description && (
            <p className={`${BODY} max-w-[52ch] text-[var(--mach-ink)]/70`}>
              {view.description}
            </p>
          )}

          {view.directionsUrl && (
            <a
              href={view.directionsUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='mt-8 inline-flex items-center gap-1.5 self-start text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--mach-ink)] transition-opacity duration-300 hover:opacity-60'>
              {isAr ? "احصل على الاتجاهات" : "Get Directions"}
              <ArrowUpRight className='h-3.5 w-3.5' />
            </a>
          )}

          {masthead && (
            <div className='mt-10 aspect-[3/2] overflow-hidden bg-[var(--mach-ink)]/5'>
              <img
                src={masthead.imageUrl}
                alt={masthead.alt ?? view.heading}
                loading='lazy'
                className='h-full w-full object-cover'
              />
            </div>
          )}
        </div>

        {/* ── Right: the form ── */}
        <form onSubmit={form.handleSubmit} className='space-y-7'>
          <div className='grid grid-cols-1 gap-7 sm:grid-cols-2'>
            <div>
              <label htmlFor='mach-contact-name' className='sr-only'>
                {isAr ? "الاسم" : "Name"}
              </label>
              <input
                id='mach-contact-name'
                type='text'
                value={form.name}
                onChange={(e) => form.setName(e.target.value)}
                placeholder={isAr ? "الاسم" : "Name"}
                required
                maxLength={200}
                dir={dir}
                className={fieldCls}
              />
            </div>
            <div>
              <label htmlFor='mach-contact-email' className='sr-only'>
                {isAr ? "البريد الإلكتروني" : "Email"}
              </label>
              <input
                id='mach-contact-email'
                type='email'
                value={form.email}
                onChange={(e) => form.setEmail(e.target.value)}
                placeholder={isAr ? "البريد الإلكتروني" : "Email"}
                required
                maxLength={200}
                dir={dir}
                className={fieldCls}
              />
            </div>
          </div>

          <div>
            <label htmlFor='mach-contact-message' className='sr-only'>
              {isAr ? "الرسالة" : "Message"}
            </label>
            <textarea
              id='mach-contact-message'
              value={form.message}
              onChange={(e) => form.setMessage(e.target.value)}
              placeholder={isAr ? "الرسالة" : "Message"}
              required
              maxLength={5000}
              rows={7}
              dir={dir}
              className={`${fieldCls} resize-none`}
            />
          </div>

          <button
            type='submit'
            disabled={form.isSubmitting}
            className={`${CTA_ON_LIGHT} gap-2 disabled:cursor-not-allowed disabled:opacity-50`}>
            {form.isSubmitting && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
            {form.isSubmitting
              ? isAr
                ? "جاري الإرسال..."
                : "Sending..."
              : isAr
                ? "إرسال"
                : "Submit"}
          </button>
        </form>
      </div>
    </MachPageShell>
  );
}
