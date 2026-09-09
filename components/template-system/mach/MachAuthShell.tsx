import type { ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { HeaderLogo } from "#root/components/globals/HeaderLogo";
import { STORE_DESCRIPTION } from "#root/shared/config/branding";
import { EYEBROW } from "./machTokens";

/**
 * Shared chrome for the Mach customer auth journey.
 *
 * Sign in, create account, forgot password and reset password are four screens
 * of one journey, so they share one frame: a full-bleed two-panel split, ink
 * identity panel against paper form panel, divided by a single hairline. No
 * card, no radius, no shadow, no accent hue — the monochrome shell rules the
 * rest of the Mach storefront runs on (machTokens.ts).
 *
 * This module is presentation only. It holds no form state, makes no network
 * call and knows nothing about Better Auth: every page below it keeps its own
 * schema, its own `authClient` call and its own submit handler, exactly as the
 * inherited pages did. The point is to stop four files from each carrying their
 * own copy of the same field border and the same eye toggle, not to centralise
 * authentication.
 *
 * The identity panel's words are the store's, not this file's: the wordmark is
 * the CMS header logo and the paragraph is STORE_DESCRIPTION. Only the eyebrow
 * varies per screen, and it names the screen rather than selling anything.
 */

/* ── Field chrome ──────────────────────────────────────────────────────── */

/** Sharp hairline box, 48px tall, ink focus ring. */
export const AUTH_FIELD =
  "h-12 w-full rounded-none border border-[var(--mach-paper-line)] bg-white px-4 text-[15px] text-[var(--mach-ink)] shadow-none transition-colors duration-200 placeholder:text-[var(--mach-mute)]/70 hover:border-[var(--mach-ink)]/35 focus-visible:border-[var(--mach-ink)] focus-visible:ring-2 focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mach-paper)] disabled:opacity-45 md:text-[15px]";

/**
 * Invalid-field override.
 *
 * The only non-neutral colour in the journey. Validation has to be unmistakable
 * at a glance, and it is always paired with a `role="alert"` message so the
 * state never depends on colour alone.
 */
export const AUTH_FIELD_INVALID =
  "border-red-700 hover:border-red-700 focus-visible:border-red-700 focus-visible:ring-red-700";

/** Small, heavy, wide-tracked field label — the Mach label idiom. */
export const AUTH_LABEL =
  "block text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--mach-mute)]";

/** Underlined tertiary action, sized to a 44px touch target. */
export const AUTH_LINK =
  "inline-flex min-h-11 items-center text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--mach-ink)] underline decoration-[var(--mach-ink)]/30 decoration-1 underline-offset-4 transition-colors duration-200 hover:decoration-[var(--mach-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mach-paper)]";

/** Disabled/busy handling for a `CTA_ON_LIGHT` submit block. */
export const AUTH_SUBMIT =
  "mt-1 min-h-[52px] w-full gap-3 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-[var(--mach-ink)] disabled:hover:text-white";

/** Supporting line under a screen's heading. */
export const AUTH_LEAD =
  "mt-5 max-w-sm text-[14px] leading-relaxed text-[var(--mach-mute)] sm:text-[15px]";

/* ── Primitives ────────────────────────────────────────────────────────── */

/** Full-width hairline. */
export function AuthRule({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`h-px w-full bg-[var(--mach-paper-line)] ${className}`}
    />
  );
}

/** Field-level validation message. Announced, and never colour alone. */
export function AuthFieldError({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <p
      id={id}
      role="alert"
      className="mt-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-red-700">
      {children}
    </p>
  );
}

/** Show/hide control that sits inside a password field's 48px box. */
export function AuthPasswordToggle({
  shown,
  onToggle,
  disabled,
  label = "password",
}: {
  shown: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** Distinguishes the two toggles on screens with a confirm field. */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? `Hide ${label}` : `Show ${label}`}
      aria-pressed={shown}
      className="absolute end-0 top-0 flex h-12 w-12 items-center justify-center text-[var(--mach-mute)] transition-colors duration-200 hover:text-[var(--mach-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mach-ink)] focus-visible:ring-inset disabled:opacity-45"
      disabled={disabled}>
      {shown ? (
        <EyeOff className="h-[17px] w-[17px]" />
      ) : (
        <Eye className="h-[17px] w-[17px]" />
      )}
    </button>
  );
}

/**
 * Terminal screen state — "check your email", "password updated", "link
 * invalid".
 *
 * Replaces the inherited green and orange status discs. Mach has no accent
 * hue, so the state is carried by a solid ink marker, an uppercase eyebrow that
 * names the outcome in words, and the live-region role — never by colour, which
 * is what makes it readable to a screen reader and in monochrome alike.
 */
export function AuthNotice({
  eyebrow,
  icon,
  title,
  children,
  tone = "status",
}: {
  eyebrow: string;
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  /** "status" for success, "alert" for a dead end. */
  tone?: "status" | "alert";
}) {
  return (
    <div role={tone} aria-live={tone === "alert" ? "assertive" : "polite"}>
      <span
        aria-hidden="true"
        className="inline-flex h-11 w-11 items-center justify-center bg-[var(--mach-ink)] text-white">
        {icon}
      </span>
      {/* The eyebrow names the outcome in words, so the state never rests on
          colour alone. */}
      <p className={`${EYEBROW} mt-7 text-[var(--mach-mute)]`}>
        <span aria-hidden="true" className="h-px w-8 bg-[var(--mach-ink)]/30" />
        {eyebrow}
      </p>
      <h1 className="mt-5 text-[clamp(1.75rem,3.4vw,2.375rem)] font-black uppercase leading-[0.95] tracking-[-0.025em] text-[var(--mach-ink)]">
        {title}
      </h1>
      {children && (
        <div className="mt-5 max-w-sm text-[14px] leading-relaxed text-[var(--mach-mute)] sm:text-[15px]">
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Shell ─────────────────────────────────────────────────────────────── */

/** The three account areas the Mach navbar's account menu already links to. */
const ACCOUNT_ITEMS: [string, string][] = [
  ["01", "Orders"],
  ["02", "Wishlist"],
  ["03", "Details"],
];

export function MachAuthShell({
  eyebrow,
  children,
  /** Widens the form column for screens with side-by-side field pairs. */
  contentClassName = "max-w-[440px]",
}: {
  eyebrow: string;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <section className="w-full bg-[var(--mach-paper)]">
      <div className="grid grid-cols-1 lg:min-h-[100svh] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* ─── Identity panel ───
            A compact masthead band on a phone, a full-height column on a
            desktop. Above the form on mobile so the brand is the first thing on
            screen, but short enough that the heading is still in the first
            viewport. */}
        <aside className="relative flex flex-col justify-between gap-10 bg-[var(--mach-ink)] px-5 py-10 text-white sm:px-8 sm:py-12 lg:px-12 lg:py-16 xl:px-16">
          <div>
            <p className={`${EYEBROW} text-white/55`}>
              <span aria-hidden="true" className="h-px w-8 bg-white/40" />
              {eyebrow}
            </p>
            <div className="mt-6">
              <HeaderLogo
                variant="desktop"
                textClassName="block text-[22px] font-black uppercase leading-none tracking-[0.14em] !text-white sm:text-[26px] lg:text-[30px]"
              />
            </div>
          </div>

          {/* Desktop-only: the store's own description, not auth copy. On a
              phone this column is a band, and a paragraph would push the form
              down for no gain. */}
          <div className="hidden lg:block">
            <div
              aria-hidden="true"
              className="h-px w-full bg-[var(--mach-ink-line)]"
            />
            <p className="mt-8 max-w-md text-[15px] leading-relaxed text-[var(--mach-mute-invert)]">
              {STORE_DESCRIPTION}
            </p>
          </div>

          {/* Withheld on the smallest phones: the band is pure overhead above
              the form there, and dropping it lifts the heading ~90px up the
              viewport. */}
          <div className="hidden sm:block">
            <div
              aria-hidden="true"
              className="h-px w-full bg-[var(--mach-ink-line)]"
            />
            <dl className="mt-6 grid grid-cols-3 gap-4">
              {ACCOUNT_ITEMS.map(([index, label]) => (
                <div key={label}>
                  <dt className="text-[10px] font-bold tracking-[0.22em] text-white/35">
                    {index}
                  </dt>
                  <dd className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">
                    {label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>

        {/* ─── Form panel ─── */}
        <div className="flex items-center justify-center border-t border-[var(--mach-paper-line)] px-5 py-12 sm:px-8 sm:py-16 lg:border-t-0 lg:border-l lg:px-12 lg:py-20 xl:px-16">
          <div className={`w-full ${contentClassName}`}>{children}</div>
        </div>
      </div>
    </section>
  );
}
