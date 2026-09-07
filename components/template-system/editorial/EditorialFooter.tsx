import { useState, type FC } from "react";
import { Link } from "#root/components/utils/Link";
import { ArrowRight } from "lucide-react";
import { STORE_NAME } from "#root/shared/config/branding";
import { useLayoutSettings } from "#root/frontend/contexts/LayoutSettingsContext";
import {
  isPlaceholderLink,
  PLACEHOLDER_LINK_URL,
  type SocialPlatform,
} from "#root/shared/types/layout-settings";
import { FooterLogo } from "#root/components/globals/FooterLogo";

/* ------------------------------------------------------------------ */
/*  Social Icons                                                      */
/* ------------------------------------------------------------------ */

const FacebookIcon = () => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width='18'
    height='18'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.2'
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-labelledby='ed-facebook-title'>
    <title id='ed-facebook-title'>Facebook</title>
    <path d='M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z' />
  </svg>
);

const InstagramIcon = () => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width='18'
    height='18'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.2'
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-labelledby='ed-instagram-title'>
    <title id='ed-instagram-title'>Instagram</title>
    <rect x='2' y='2' width='20' height='20' rx='5' ry='5' />
    <path d='M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z' />
    <line x1='17.5' y1='6.5' x2='17.51' y2='6.5' />
  </svg>
);

const TikTokIcon = () => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width='18'
    height='18'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.2'
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-labelledby='ed-tiktok-title'>
    <title id='ed-tiktok-title'>TikTok</title>
    <path d='M9 12a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' />
    <path d='M15 8c0 5 4 8 5 8' />
    <path d='M9 16v8' />
    <path d='M15 20V4c0-2 2-3 4-3' />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Data                                                              */
/* ------------------------------------------------------------------ */

const DEFAULT_SOCIAL_LINKS = [
  { id: "facebook", name: "Facebook", url: "#", Icon: FacebookIcon },
  { id: "instagram", name: "Instagram", url: "#", Icon: InstagramIcon },
  { id: "tiktok", name: "TikTok", url: "#", Icon: TikTokIcon },
];

/**
 * Static fallback used only when the CMS has no footer link groups saved.
 * Destinations that don't exist yet carry the placeholder sentinel so they
 * render as inert "soon" items rather than links that lead nowhere.
 */
const DEFAULT_FOOTER_COLUMNS: {
  title: string;
  links: { label: string; href: string }[];
}[] = [
  {
    title: "Shop",
    links: [
      { label: "Shop All", href: "/shop" },
      { label: "Best Sellers", href: "/shop?section=featured" },
      { label: "New Arrivals", href: "/shop?section=newarrivals" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About Mach", href: "/#about" },
      { label: "Contact", href: PLACEHOLDER_LINK_URL },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Shipping & Returns", href: PLACEHOLDER_LINK_URL },
      { label: "FAQ", href: PLACEHOLDER_LINK_URL },
    ],
  },
];

/** Legal pages that haven't been published yet — same placeholder treatment. */
const LEGAL_LINKS: { label: string; href: string }[] = [
  { label: "Terms", href: PLACEHOLDER_LINK_URL },
  { label: "Privacy", href: PLACEHOLDER_LINK_URL },
];

/**
 * Renders a footer destination as a real link, or — when the destination
 * doesn't exist yet — as an inert, visibly-pending label. Keeps us from
 * shipping hrefs that quietly go nowhere while the pages are still being
 * built; set a real url in Dashboard → Layout Settings to activate one.
 */
function FooterLink({
  href,
  label,
  className,
  pendingClassName,
}: {
  href: string;
  label: string;
  className: string;
  pendingClassName: string;
}) {
  if (isPlaceholderLink(href)) {
    return (
      <span
        aria-disabled='true'
        title={`${label} — coming soon`}
        className={pendingClassName}>
        {label}
        <span className='ml-2 align-middle text-[9px] tracking-[0.18em] uppercase text-white/25'>
          Soon
        </span>
      </span>
    );
  }
  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}

const socialIconMap: Record<SocialPlatform, FC> = {
  facebook: FacebookIcon,
  instagram: InstagramIcon,
  tiktok: TikTokIcon,
  twitter: FacebookIcon,
  youtube: FacebookIcon,
  pinterest: FacebookIcon,
  linkedin: FacebookIcon,
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

/**
 * Editorial Footer — Mach Supplements chrome.
 *
 * - Near-black `--mach-ink` canvas with a volt accent rule
 * - Desktop grid: Brand | Shop | Company | Support (all CMS-driven)
 * - Newsletter block at top, social icons + legal strip at the bottom
 * - Destinations that don't exist yet render as inert "soon" labels
 */
export function EditorialFooter() {
  const [email, setEmail] = useState("");
  const layoutSettings = useLayoutSettings();

  // CMS values with fallbacks
  const effectiveDescription =
    layoutSettings.footer.description ||
    "Sports nutrition engineered for serious training. Tested, trusted, and built to fuel the next level.";
  const effectiveCopyright = layoutSettings.footer.copyright || STORE_NAME;
  const effectiveShowNewsletter = layoutSettings.footer.showNewsletter;

  // Build social links from CMS if available
  const SOCIAL_LINKS =
    layoutSettings.footer.socialLinks.length > 0
      ? layoutSettings.footer.socialLinks.map((sl) => ({
          id: sl.id,
          name: sl.platform.charAt(0).toUpperCase() + sl.platform.slice(1),
          url: sl.url,
          Icon: socialIconMap[sl.platform] ?? FacebookIcon,
        }))
      : DEFAULT_SOCIAL_LINKS;

  // Build footer columns from CMS if available
  const FOOTER_COLUMNS =
    layoutSettings.footer.footerLinkGroups.length > 0
      ? layoutSettings.footer.footerLinkGroups.map((g) => ({
          title: g.title,
          links: g.links.map((l) => ({ label: l.label, href: l.url })),
        }))
      : DEFAULT_FOOTER_COLUMNS;

  // Social entries the merchant hasn't filled in yet shouldn't render as
  // dead outbound icons.
  const VISIBLE_SOCIAL_LINKS = SOCIAL_LINKS.filter(
    (social) => !isPlaceholderLink(social.url),
  );

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      alert(`Thank you for subscribing with ${email}!`);
      setEmail("");
    }
  };

  return (
    <footer className='bg-[var(--mach-ink)] text-white/60 selection:bg-[var(--mach-accent)] selection:text-[var(--mach-on-accent)]'>
      {/* ── Newsletter ── */}
      {effectiveShowNewsletter && (
        <div className='border-b border-white/[0.06]'>
          <div className='mx-auto max-w-6xl px-6 md:px-12 lg:px-10 py-16 md:py-20'>
            <div className='max-w-xl mx-auto text-center space-y-6'>
              <div className='w-10 h-0.5 bg-[var(--mach-accent)] mx-auto' />
              <h3 className='text-xs tracking-[0.3em] uppercase text-white/80 font-bold'>
                Join the Mach crew
              </h3>
              <p className='text-sm text-white/40 font-light leading-relaxed max-w-sm mx-auto'>
                Drop dates, restocks &amp; training-day offers — straight to
                your inbox.
              </p>
              <form
                onSubmit={handleSubscribe}
                className='flex items-end gap-4 max-w-sm mx-auto pt-2'>
                <input
                  type='email'
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder='your@email.com'
                  required
                  className='flex-1 bg-transparent border-0 border-b border-white/15 px-0 pb-3 pt-1 text-sm text-white/85 placeholder:text-white/25 font-light tracking-wide focus:outline-none focus:border-[var(--mach-accent)] transition-colors duration-500'
                />
                <button
                  type='submit'
                  className='pb-3 text-white/40 hover:text-[var(--mach-accent)] transition-colors duration-500'
                  aria-label='Subscribe'>
                  <ArrowRight className='w-[18px] h-[18px]' strokeWidth={1.2} />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Main grid ── */}
      <div className='mx-auto max-w-6xl px-6 md:px-12 lg:px-10 py-14 md:py-16'>
        <div className='grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-8 lg:gap-10'>
          {/* Brand column */}
          <div className='md:col-span-12 lg:col-span-5 space-y-5'>
            <FooterLogo textClassName='inline-block text-xl md:text-2xl font-black tracking-[0.2em] text-white uppercase hover:text-[var(--mach-accent)] transition-colors duration-500' />
            <div className='w-10 h-0.5 bg-[var(--mach-accent)]' />
            <p className='text-xs text-white/35 font-light leading-relaxed max-w-[260px]'>
              {effectiveDescription}
            </p>
            <div className='flex items-center gap-5 pt-2'>
              {VISIBLE_SOCIAL_LINKS.map((social) => (
                <a
                  key={social.id}
                  href={social.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-white/30 hover:text-[var(--mach-accent)] transition-colors duration-500'
                  aria-label={`Visit our ${social.name} page`}>
                  <social.Icon />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns — their own track so column widths don't depend on
              how many groups the CMS happens to define. */}
          <div className='grid grid-cols-2 gap-8 sm:grid-cols-3 md:col-span-12 lg:col-span-7'>
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title} className='min-w-0'>
              <h4 className='text-[10px] tracking-[0.28em] uppercase text-white/70 font-bold mb-6'>
                {column.title}
              </h4>
              <ul className='space-y-4'>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <FooterLink
                      href={link.href}
                      label={link.label}
                      className='text-[12px] uppercase leading-snug tracking-[0.05em] text-white/55 hover:text-white transition-colors duration-500'
                      pendingClassName='inline-flex items-baseline text-[12px] uppercase leading-snug tracking-[0.05em] text-white/25 cursor-default'
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          </div>
        </div>
      </div>

      {/* ── Legal strip ── */}
      <div className='border-t border-white/[0.06]'>
        <div className='mx-auto max-w-6xl px-6 md:px-12 lg:px-10 py-6 flex flex-col md:flex-row items-center justify-between gap-4'>
          <p className='text-[10px] text-white/20 font-light tracking-[0.08em]'>
            &copy; {new Date().getFullYear()} {effectiveCopyright}
          </p>
          <div className='flex items-center gap-6'>
            {LEGAL_LINKS.map((link) => (
              <FooterLink
                key={link.label}
                href={link.href}
                label={link.label}
                className='text-[10px] text-white/25 hover:text-white/60 font-light tracking-[0.08em] transition-colors duration-500'
                pendingClassName='inline-flex items-baseline text-[10px] text-white/20 font-light tracking-[0.08em] cursor-default'
              />
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
