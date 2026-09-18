import type { ReactNode } from "react";
import { MachChrome } from "../MachChrome";
import {
  BODY,
  GROUND_INK,
  GROUND_PAPER,
  GUTTER,
  HEADING_SHOP,
  EYEBROW,
  SECTION_Y,
  SECTION_Y_TIGHT,
  SHELL,
} from "../machTokens";

/**
 * The frame every Mach content page (/about-us, /contact, /return-policy)
 * sits in.
 *
 * Mach's editorial pages open on an ink masthead and drop onto paper for the
 * reading column — the same two-ground rhythm the shop and product pages use,
 * which is what keeps these three from looking like a different website. The
 * navbar is *not* rendered here: LayoutDefault picks it from
 * `header.navbarStyle` for every route. `MachChrome` supplies the Mach footer
 * and suppresses the global one, exactly as it does for the homepage, shop and
 * product pages.
 *
 * `HEADING_SHOP` rather than `HEADING`: these are pages you read, not
 * campaigns, so the masthead names the page and hands over the room — the same
 * call the shop masthead makes.
 */
export function MachPageShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <MachChrome>
      <div className={GROUND_INK}>
        <header className={`${SHELL} ${GUTTER} ${SECTION_Y_TIGHT}`}>
          {eyebrow && (
            <p className={`${EYEBROW} text-white/45`}>
              <span aria-hidden='true' className='h-px w-6 bg-white/45' />
              {eyebrow}
            </p>
          )}
          <h1 className={`${HEADING_SHOP} mt-5 text-white`}>{title}</h1>
        </header>
      </div>
      <div className={GROUND_PAPER}>
        <div className={`${SHELL} ${GUTTER} ${SECTION_Y}`}>{children}</div>
      </div>
    </MachChrome>
  );
}

/**
 * What a Mach content route shows when its CMS page has not been published.
 *
 * Deliberately not the string "Page not found": the route exists and is linked
 * from the navigation, so claiming otherwise is the exact lie this whole change
 * set removes. It says the page isn't ready, which is true, and it offers the
 * way back to the catalogue rather than leaving a dead end.
 *
 * It also does not invent the missing copy. An unpublished About page stays
 * unpublished until someone writes one in Dashboard → Homepage.
 */
export function MachPageUnavailable({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <MachChrome>
      <div className={`${GROUND_PAPER} flex min-h-[55vh] items-center`}>
        <div className={`${SHELL} ${GUTTER} ${SECTION_Y} text-center`}>
          <h1 className={`${HEADING_SHOP} text-[var(--mach-ink)]`}>{title}</h1>
          <p className={`${BODY} mx-auto mt-6 max-w-md text-[var(--mach-ink)]/60`}>
            {message}
          </p>
          <a
            href='/shop'
            className='mt-10 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--mach-ink)] underline underline-offset-[6px] transition-opacity duration-300 hover:opacity-60'>
            Continue shopping
          </a>
        </div>
      </div>
    </MachChrome>
  );
}
