import type {
  TextAlign,
  TextTheme,
  TextVerticalAlign,
} from "#root/shared/types/homepage-content";

/**
 * Mach presentation tokens.
 *
 * These are layout mechanics only — sizing, weight, tracking, contrast. No
 * copy, no destinations, no imagery. Everything the client sees the *words* of
 * comes from the CMS; this file just decides how loud they look.
 *
 * The *interface* is monochrome: ground, type, rules and buttons are black,
 * white, off-white and grayscale, and emphasis is produced by inverting a whole
 * block rather than tinting one. There is no brand accent hue.
 *
 * That is a rule about the shell, not about the merchandise. Product
 * photography and campaign media render at full saturation — Mach packaging is
 * brown, blue, orange, gold, and that colour is both brand identity and product
 * information. The neutral interface is what lets it carry the page.
 */

/* ── Section grounds ───────────────────────────────────────────────────── */

/** True-black ground. The default for high-impact sections. */
export const GROUND_INK = "bg-[var(--mach-ink)] text-white";
/** Lifted charcoal — separates two adjacent dark sections without a rule. */
export const GROUND_INK_SOFT = "bg-[var(--mach-ink-soft)] text-white";
/** Warm off-white. Used to breathe between dark blocks. */
export const GROUND_PAPER = "bg-[var(--mach-paper)] text-[var(--mach-ink)]";
/** Pure white — the brightest step, for product-forward rows. */
export const GROUND_WHITE = "bg-white text-[var(--mach-ink)]";

/* ── Rhythm ────────────────────────────────────────────────────────────── */

/** Standard vertical rhythm for a content section. */
export const SECTION_Y = "py-16 sm:py-20 lg:py-28";
/** Tighter rhythm for supporting strips. */
export const SECTION_Y_TIGHT = "py-12 sm:py-14 lg:py-16";
/** Horizontal gutter shared by every non-bleed section. */
export const GUTTER = "px-5 sm:px-8 lg:px-12 xl:px-16";
/** Max content measure. Wide, because merchandising rows want the room. */
export const SHELL = "mx-auto w-full max-w-[1600px]";

/* ── Type ──────────────────────────────────────────────────────────────── */

/** Small, heavy, wide-tracked label that opens a section. */
export const EYEBROW =
  "inline-flex items-center gap-3 text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.3em]";

/** Section headline. Deliberately oversized — this is where the energy is. */
export const HEADING =
  "font-black uppercase leading-[0.88] tracking-[-0.03em] text-[clamp(2.25rem,6vw,5rem)]";

/**
 * Oversized section headline, reserved for the page's primary product shelf.
 * One step below the hero so the merchandising hierarchy is unambiguous.
 */
export const HEADING_XL =
  "font-black uppercase leading-[0.86] tracking-[-0.035em] text-[clamp(2.75rem,7.5vw,6.5rem)]";

/**
 * Merchandising shelf heading — the smallest of the section headings.
 *
 * A shelf title only has to name the shelf. At `HEADING_SM` the Best Sellers
 * title ran 52px and still read as the loudest thing in the section, above
 * four products it was supposed to be introducing. Capped at 38px it labels
 * the row and gets out of the way, which is the hierarchy the reference stores
 * run on their merchandising rows: the products dominate, the title does not.
 *
 * Deliberately its own token rather than a change to `HEADING_SM`, which is
 * shared with Stacks & Bundles and the group band.
 */
export const HEADING_SHELF =
  "font-black uppercase leading-[0.95] tracking-[-0.025em] text-[clamp(1.75rem,3.4vw,2.375rem)]";

/**
 * Feature-shelf heading — one step above `HEADING_SHELF`, well below the rest.
 *
 * For a section that outranks a normal merchandising row without becoming a
 * statement: Stacks & Bundles is a curated pair, not a catalogue shelf, and it
 * should read that way from the heading down. Capped at 42px, which sits just
 * above the 38px Best Sellers title and nowhere near the hero.
 */
export const HEADING_FEATURE =
  "font-black uppercase leading-[0.95] tracking-[-0.028em] text-[clamp(1.75rem,3.8vw,2.625rem)]";

/**
 * Browsing-page heading — the shop and category mastheads.
 *
 * A collection page is not a campaign: the heading names the page and then
 * hands the room to the products. At `HEADING` the shop title ran 80px on a
 * desktop and dominated a masthead whose only other content is a breadcrumb
 * and a count, which is what made the page read as a dashboard header rather
 * than as the top of a shop. Capped at 52px it stays the loudest thing in the
 * masthead without out-shouting the grid two rows below it.
 *
 * Its own token rather than a change to `HEADING`, which the homepage sections
 * share.
 */
export const HEADING_SHOP =
  "font-black uppercase leading-[0.9] tracking-[-0.03em] text-[clamp(2rem,4.2vw,3.25rem)]";

/** Slightly smaller heading for sections that sit beside content. */
export const HEADING_SM =
  "font-black uppercase leading-[0.92] tracking-[-0.025em] text-[clamp(1.75rem,4vw,3.25rem)]";

/** Hero headline — the largest type on the page. */
export const HEADING_HERO =
  "font-black uppercase leading-[0.85] tracking-[-0.035em] text-[clamp(2.75rem,9vw,7.5rem)]";

/**
 * Hero headline sharing the frame with campaign media.
 *
 * Sized to *support* the campaign image, not to compete with it. The reference
 * supplement stores run their hero headline well under half the height this
 * was set to — the picture carries the impact and the type carries the
 * message. Capped at 60px so it stays a headline rather than becoming the
 * composition, with a 40px floor so it still lands hard on a phone.
 */
export const HEADING_HERO_CAMPAIGN =
  "font-black uppercase leading-[0.9] tracking-[-0.035em] text-[clamp(2.5rem,4vw,3.75rem)]";

/**
 * Hero headline with the whole frame to itself — the state before campaign
 * artwork is uploaded. One step louder, because nothing competes with it.
 */
export const HEADING_HERO_SOLO =
  "font-black uppercase leading-[0.8] tracking-[-0.045em] text-[clamp(3rem,11vw,10rem)]";

export const BODY = "text-[15px] leading-relaxed sm:text-base";
export const BODY_SM = "text-[13px] leading-relaxed sm:text-sm";

/* ── CTAs ──────────────────────────────────────────────────────────────── */

const CTA_BASE =
  "inline-flex items-center justify-center px-8 py-4 text-[12px] font-bold uppercase tracking-[0.2em] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/** Solid white block on a dark ground; inverts to black-on-white on hover. */
export const CTA_ON_DARK = `${CTA_BASE} bg-white text-[var(--mach-ink)] hover:bg-transparent hover:text-white ring-1 ring-inset ring-white focus-visible:ring-white focus-visible:ring-offset-[var(--mach-ink)]`;

/** Outline on a dark ground; fills white on hover. */
export const CTA_ON_DARK_GHOST = `${CTA_BASE} bg-transparent text-white ring-1 ring-inset ring-white/45 hover:bg-white hover:text-[var(--mach-ink)] hover:ring-white focus-visible:ring-white focus-visible:ring-offset-[var(--mach-ink)]`;

/** Solid black block on a light ground; inverts on hover. */
export const CTA_ON_LIGHT = `${CTA_BASE} bg-[var(--mach-ink)] text-white hover:bg-transparent hover:text-[var(--mach-ink)] ring-1 ring-inset ring-[var(--mach-ink)] focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-white`;

/** Outline on a light ground. */
export const CTA_ON_LIGHT_GHOST = `${CTA_BASE} bg-transparent text-[var(--mach-ink)] ring-1 ring-inset ring-[var(--mach-ink)]/35 hover:bg-[var(--mach-ink)] hover:text-white hover:ring-[var(--mach-ink)] focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-white`;

/* ── Hero CTAs ─────────────────────────────────────────────────────────── */

/**
 * The hero runs a different CTA pair from the rest of the page.
 *
 * Two equally-weighted outlined buttons read as a choice; a hero needs one
 * obvious commercial action. So the primary is a solid block with a moving
 * arrow, and the secondary drops to an underlined link — same information,
 * unambiguous hierarchy.
 */
const CTA_HERO_BASE =
  "group inline-flex items-center justify-center gap-3 px-7 py-[15px] text-[11px] font-bold uppercase tracking-[0.2em] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

export const CTA_HERO_ON_DARK = `${CTA_HERO_BASE} bg-white text-[var(--mach-ink)] ring-1 ring-inset ring-white hover:bg-transparent hover:text-white focus-visible:ring-white focus-visible:ring-offset-[var(--mach-ink)]`;

export const CTA_HERO_ON_LIGHT = `${CTA_HERO_BASE} bg-[var(--mach-ink)] text-white ring-1 ring-inset ring-[var(--mach-ink)] hover:bg-transparent hover:text-[var(--mach-ink)] focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-white`;

const CTA_HERO_LINK_BASE =
  "group inline-flex items-center gap-2.5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-4";

export const CTA_HERO_LINK_ON_DARK = `${CTA_HERO_LINK_BASE} text-white/70 hover:text-white focus-visible:ring-white focus-visible:ring-offset-[var(--mach-ink)]`;

export const CTA_HERO_LINK_ON_LIGHT = `${CTA_HERO_LINK_BASE} text-[var(--mach-ink)]/65 hover:text-[var(--mach-ink)] focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-white`;

/** Resolves the hero CTA pair for copy sitting on a given theme. */
export function heroCtaPairForTheme(theme: TextTheme) {
  return theme === "dark"
    ? { primary: CTA_HERO_ON_LIGHT, secondary: CTA_HERO_LINK_ON_LIGHT }
    : { primary: CTA_HERO_ON_DARK, secondary: CTA_HERO_LINK_ON_DARK };
}

/** Underlined inline action, e.g. "view all". */
export const LINK_ACTION =
  "group inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] transition-opacity duration-300 hover:opacity-60";

/* ── Theme helpers ─────────────────────────────────────────────────────── */

/** Resolves the CTA pair for text sitting on media of a given theme. */
export function ctaPairForTheme(theme: TextTheme) {
  return theme === "dark"
    ? { primary: CTA_ON_LIGHT, secondary: CTA_ON_LIGHT_GHOST }
    : { primary: CTA_ON_DARK, secondary: CTA_ON_DARK_GHOST };
}

/** Text colours for a block overlaid on media. */
export function textClassesForTheme(theme: TextTheme) {
  return theme === "dark"
    ? {
        heading: "text-[var(--mach-ink)]",
        body: "text-[var(--mach-ink)]/70",
        eyebrow: "text-[var(--mach-ink)]/70",
        tick: "bg-[var(--mach-ink)]",
      }
    : {
        heading: "text-white",
        body: "text-white/70",
        eyebrow: "text-white/80",
        tick: "bg-white",
      };
}

/** Flex alignment for a horizontally-placed text block. */
export function alignClasses(align: TextAlign): string {
  if (align === "center") return "items-center text-center mx-auto";
  if (align === "right") return "items-end text-right ml-auto";
  return "items-start text-left";
}

/** Flex alignment for a vertically-placed text block. */
export function verticalAlignClasses(align: TextVerticalAlign): string {
  if (align === "top") return "justify-start";
  if (align === "middle") return "justify-center";
  return "justify-end";
}
