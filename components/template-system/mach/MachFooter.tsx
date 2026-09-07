import { useState, type FC } from "react";
import { Link } from "#root/components/utils/Link";
import { ArrowRight } from "lucide-react";
import { STORE_NAME } from "#root/shared/config/branding";
import { useLayoutSettings } from "#root/frontend/contexts/LayoutSettingsContext";
import {
  isPlaceholderLink,
  type SocialPlatform,
} from "#root/shared/types/layout-settings";
import { FooterLogo } from "#root/components/globals/FooterLogo";

/* ------------------------------------------------------------------ */
/*  Social icons                                                      */
/* ------------------------------------------------------------------ */

const iconProps = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const FacebookIcon = () => (
  <svg {...iconProps} aria-labelledby="mach-facebook-title">
    <title id="mach-facebook-title">Facebook</title>
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);

const InstagramIcon = () => (
  <svg {...iconProps} aria-labelledby="mach-instagram-title">
    <title id="mach-instagram-title">Instagram</title>
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

const TikTokIcon = () => (
  <svg {...iconProps} aria-labelledby="mach-tiktok-title">
    <title id="mach-tiktok-title">TikTok</title>
    <path d="M9 12a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
    <path d="M15 8c0 5 4 8 5 8" />
    <path d="M9 16v8" />
    <path d="M15 20V4c0-2 2-3 4-3" />
  </svg>
);

const XIcon = () => (
  <svg {...iconProps} aria-labelledby="mach-x-title">
    <title id="mach-x-title">X</title>
    <path d="M4 4l16 16M20 4L4 20" />
  </svg>
);

const YouTubeIcon = () => (
  <svg {...iconProps} aria-labelledby="mach-youtube-title">
    <title id="mach-youtube-title">YouTube</title>
    <rect x="2" y="5" width="20" height="14" rx="4" />
    <path d="M10 9l5 3-5 3z" />
  </svg>
);

const PinterestIcon = () => (
  <svg {...iconProps} aria-labelledby="mach-pinterest-title">
    <title id="mach-pinterest-title">Pinterest</title>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 7c-2 0-3.2 1.3-3.2 2.9 0 .8.4 1.6 1 1.9L10 15l2-6" />
  </svg>
);

const LinkedInIcon = () => (
  <svg {...iconProps} aria-labelledby="mach-linkedin-title">
    <title id="mach-linkedin-title">LinkedIn</title>
    <rect x="2" y="2" width="20" height="20" rx="3" />
    <path d="M7 10v7M7 7v.01M11 17v-4a2 2 0 0 1 4 0v4" />
  </svg>
);

const socialIconMap: Record<SocialPlatform, FC> = {
  facebook: FacebookIcon,
  instagram: InstagramIcon,
  tiktok: TikTokIcon,
  twitter: XIcon,
  youtube: YouTubeIcon,
  pinterest: PinterestIcon,
  linkedin: LinkedInIcon,
};

/* ------------------------------------------------------------------ */
/*  Footer link                                                       */
/* ------------------------------------------------------------------ */

/**
 * Renders a destination as a real link, or — when it doesn't exist yet — as an
 * inert, visibly-pending label. Keeps us from shipping hrefs that quietly go
 * nowhere; set a real url in Dashboard → Layout Settings to activate one.
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
        aria-disabled="true"
        title={`${label} — coming soon`}
        className={pendingClassName}>
        {label}
        <span className="ml-2 align-middle text-[9px] uppercase tracking-[0.18em] text-white/25">
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

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

/**
 * Mach footer.
 *
 * Fully Layout-Settings driven: logo, description, link groups (any number,
 * any labels), social links and copyright. There are no static fallback link
 * columns — a client who deletes a group sees it gone, rather than the code
 * quietly restoring labels they removed.
 *
 * `suppressNewsletter` is passed by MachChrome when the homepage already
 * renders its own newsletter section, which is what stops the storefront
 * asking for the same email address twice on one page.
 */
export function MachFooter({
  suppressNewsletter = false,
}: {
  suppressNewsletter?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const layoutSettings = useLayoutSettings();

  const { footer } = layoutSettings;
  const showNewsletter = footer.showNewsletter && !suppressNewsletter;
  const copyright = footer.copyright || STORE_NAME;

  const socialLinks = footer.socialLinks
    .filter((sl) => !isPlaceholderLink(sl.url))
    .map((sl) => ({
      id: sl.id,
      name: sl.platform.charAt(0).toUpperCase() + sl.platform.slice(1),
      url: sl.url,
      Icon: socialIconMap[sl.platform] ?? FacebookIcon,
    }));

  const linkGroups = footer.footerLinkGroups ?? [];

  return (
    <footer className="bg-[var(--mach-ink)] text-white/60">
      {/* ── Newsletter (only when the page hasn't already asked) ── */}
      {showNewsletter && (
        <div data-footer-newsletter className="border-b border-white/[0.08]">
          <div className="mx-auto w-full max-w-[1600px] px-5 py-14 sm:px-8 lg:px-12 xl:px-16">
            <div className="mx-auto max-w-sm text-center">
              <div className="mx-auto h-0.5 w-10 bg-white" />
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email.trim()) setSubmitted(true);
                }}
                className="mt-8 flex items-end gap-4">
                <label htmlFor="mach-footer-email" className="sr-only">
                  Email address
                </label>
                <input
                  id="mach-footer-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={submitted}
                  placeholder="your@email.com"
                  className="flex-1 border-0 border-b border-white/15 bg-transparent px-0 pb-3 pt-1 text-sm tracking-wide text-white/85 transition-colors duration-500 placeholder:text-white/25 focus:border-white focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={submitted}
                  className="pb-3 text-white/40 transition-colors duration-500 hover:text-white"
                  aria-label="Subscribe">
                  <ArrowRight className="h-[18px] w-[18px]" strokeWidth={1.4} />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Main grid ── */}
      <div className="mx-auto w-full max-w-[1600px] px-5 py-14 sm:px-8 md:py-16 lg:px-12 xl:px-16">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-8 lg:gap-10">
          {/* Brand column */}
          <div className="space-y-5 md:col-span-12 lg:col-span-4">
            <FooterLogo textClassName="inline-block text-xl md:text-2xl font-black tracking-[0.2em] text-white uppercase transition-opacity duration-500 hover:opacity-70" />
            <div className="h-0.5 w-10 bg-white" />
            {footer.description && (
              <p className="max-w-[280px] text-xs font-light leading-relaxed text-white/40">
                {footer.description}
              </p>
            )}
            {socialLinks.length > 0 && (
              <div className="flex items-center gap-5 pt-2">
                {socialLinks.map((social) => (
                  <a
                    key={social.id}
                    href={social.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/35 transition-colors duration-500 hover:text-white"
                    aria-label={`Visit our ${social.name} page`}>
                    <social.Icon />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Link columns — their own track so widths don't shift with the
              number of groups the CMS happens to define. */}
          {linkGroups.length > 0 && (
            <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 md:col-span-12 lg:col-span-8">
              {linkGroups.map((group) => (
                <div key={group.id} className="min-w-0">
                  <h4 className="mb-6 text-[10px] font-bold uppercase tracking-[0.28em] text-white/75">
                    {group.title}
                  </h4>
                  <ul className="space-y-4">
                    {group.links.map((link) => (
                      <li key={link.id}>
                        <FooterLink
                          href={link.url}
                          label={link.label}
                          className="text-[12px] uppercase leading-snug tracking-[0.05em] text-white/55 transition-colors duration-500 hover:text-white"
                          pendingClassName="inline-flex items-baseline text-[12px] uppercase leading-snug tracking-[0.05em] text-white/25 cursor-default"
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Legal strip ── */}
      <div className="border-t border-white/[0.08]">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col items-center justify-between gap-4 px-5 py-6 sm:px-8 md:flex-row lg:px-12 xl:px-16">
          <p className="text-[10px] font-light tracking-[0.08em] text-white/25">
            &copy; {new Date().getFullYear()} {copyright}
          </p>
          {(footer.contactEmail || footer.contactPhone) && (
            <div className="flex items-center gap-6">
              {footer.contactEmail && (
                <a
                  href={`mailto:${footer.contactEmail}`}
                  className="text-[10px] font-light tracking-[0.08em] text-white/30 transition-colors duration-500 hover:text-white/70">
                  {footer.contactEmail}
                </a>
              )}
              {footer.contactPhone && (
                <a
                  href={`tel:${footer.contactPhone}`}
                  className="text-[10px] font-light tracking-[0.08em] text-white/30 transition-colors duration-500 hover:text-white/70">
                  {footer.contactPhone}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
