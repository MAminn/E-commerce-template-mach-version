import type { CSSProperties, ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type {
  HeroMediaLayout,
  HomepageHeroContent,
  MediaSlot,
  TextAlign,
  TextTheme,
} from "#root/shared/types/homepage-content";
import { isMediaSlotEmpty } from "#root/shared/types/homepage-content";
import { isPlaceholderLink } from "#root/shared/types/layout-settings";
import { EASE_OUT } from "../../motion/motionPresets";
import { MachMedia, normalizeMediaUrl } from "../MachMedia";
import {
  EYEBROW,
  HEADING_HERO_CAMPAIGN,
  HEADING_HERO_SOLO,
  heroCtaPairForTheme,
  textClassesForTheme,
} from "../machTokens";

/**
 * Mach campaign hero.
 *
 * The frame is split, not stacked: copy holds the left column, and the right
 * column is a **lit stage** that always exists as a piece of composition
 * rather than appearing only once an image is uploaded. That is the difference
 * between a campaign hero and type on a dark background — the right side has
 * weight whether it is holding a photograph, a pack shot, both layered, or
 * nothing but light and haze.
 *
 * The depth is built from neutral layers laid around the picture, never on top
 * of its colour:
 *
 *   the scene       CMS photograph or video, at full saturation
 *   the graded wash solid ink under the copy, clearing entirely over the stage
 *   the raked key   a wide blurred shaft from the top right
 *   the haze        a slow-drifting bank of light across the floor
 *   the cyclorama   a bottom glow the pack shot stands on, not a hard line
 *   the vignette    corner falloff, under the copy so it never dims the CTA
 *   the grain       a few percent of noise, because flat black bands on cheap
 *                   panels and reads as vector fill on good ones
 *
 * The pack shot sits in front of all of it, lit by its own key and grounded by
 * a contact shadow. Because the lighting belongs to the template and not to
 * the photograph, the composition degrades in steps instead of collapsing:
 * scene + product, scene alone, product alone on a lit studio ground, or an
 * empty set that still reads as somewhere rather than as nothing.
 *
 * The scene is a section-level layer, not something held inside the stage
 * cell: campaign photography is framed wide, and squeezing it into a 46%
 * column throws away the composition it was shot for. So on desktop the
 * picture runs the full frame and the split is expressed by the wash and the
 * seam hairline drawn over it. On a phone there is no room for copy over a
 * photograph, so the scene crops into a band across the top instead.
 *
 * `mediaLayout: "full-bleed"` swaps the split for a single photograph across
 * the whole frame with the copy overlaid, for the campaign where cropping the
 * image into a column would throw the picture away.
 *
 * **Neutral shell, colourful product.** Black, white and grayscale are the
 * interface — the ground, the type, the rules, the buttons. They are not a
 * filter applied to the merchandise. Mach packaging is brown whey, blue
 * creatine, orange carb, gold pre-workout, and that colour is brand identity
 * and product information at once, so campaign media and pack shots render at
 * full saturation. The energy in this section comes from real product colour,
 * scale, lighting and type — never from an invented accent hue laid over a
 * desaturated photograph.
 *
 * **Nothing here is Mach copy or Mach artwork.** Headline, eyebrow, paragraph,
 * both CTAs and their destinations, the scene, the pack shot and its scale,
 * the layout, the copy's placement, whether it reads light or dark, and the
 * scrim strength all come from the homepage CMS. This file decides only how
 * loud any of it looks.
 *
 * Desktop and mobile are composed separately. On a phone the stage becomes a
 * band across the top of the frame with the pack shot breaking out through its
 * bottom edge, and the copy block sits beneath on solid ground — a deliberate
 * crop, not the desktop split folded in half.
 */

/* ------------------------------------------------------------------ */
/*  Depth                                                             */
/* ------------------------------------------------------------------ */

/**
 * Film grain over the whole section.
 *
 * Large flat blacks band badly on cheap panels and read as flat vector fill on
 * good ones. A few percent of noise is what makes the ground look photographed
 * rather than filled. Kept low enough that it settles the interface without
 * touching the saturation of the product photography underneath.
 */
const GRAIN_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

function Grain() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-30 opacity-[0.05] mix-blend-overlay"
      style={{ backgroundImage: GRAIN_URL, backgroundSize: "160px 160px" }}
    />
  );
}

/**
 * Corner falloff. Pulls the eye into the middle of the frame.
 *
 * Sits under the copy layer, not over it — run over the top it dims the white
 * CTA sitting in the darkest corner of its own gradient.
 */
function Vignette() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-3"
      style={{
        background:
          "radial-gradient(130% 105% at 50% 42%, transparent 48%, rgba(0,0,0,0.30) 100%)",
      }}
    />
  );
}

/**
 * The lighting rig behind whatever is on the stage.
 *
 * Rendered under the scene as well as instead of it: a photograph gets the
 * cyclorama glow under its feet too, which is what stops a cut-out pasted over
 * a picture from looking pasted over a picture.
 */
function StageLight({
  reduced,
  subtle = false,
}: {
  reduced: boolean;
  /** Halved when a photograph is already carrying its own lighting. */
  subtle?: boolean;
}) {
  const k = subtle ? 0.45 : 1;
  const a = (v: number) => (v * k).toFixed(3);
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      {/* Raked key from the top right. */}
      <div
        className="absolute -top-1/3 right-[-14%] h-[165%] w-[46%] rotate-16 blur-3xl"
        style={{
          background: `linear-gradient(to bottom, rgba(255,255,255,${a(0.17)}), rgba(255,255,255,${a(0.05)}) 52%, transparent 84%)`,
        }}
      />
      {/* Haze bank. Drifts slowly so the light feels like it is in a room. */}
      <motion.div
        className="absolute inset-x-[-25%] bottom-[-6%] h-[58%] blur-3xl"
        style={{
          background: `radial-gradient(58% 100% at 50% 100%, rgba(255,255,255,${a(0.16)}), rgba(255,255,255,${a(0.05)}) 46%, transparent 76%)`,
        }}
        animate={
          reduced ? undefined : { x: ["-2%", "3%", "-2%"], scaleY: [1, 1.1, 1] }
        }
        transition={{
          duration: 22,
          ease: "easeInOut",
          repeat: Number.POSITIVE_INFINITY,
        }}
      />
      {/* Cyclorama — a floor that curves up rather than meeting a hard line. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[38%]"
        style={{
          background: `linear-gradient(to top, rgba(255,255,255,${a(0.09)}), rgba(255,255,255,${a(0.03)}) 38%, transparent 78%)`,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pack shot                                                         */
/* ------------------------------------------------------------------ */

/**
 * The lit cut-out.
 *
 * Its own key light and contact shadow travel with it, so it reads as standing
 * on the stage in both layouts instead of floating wherever it is dropped.
 */
function PackShot({
  slot,
  scale,
  className = "",
  reduced,
}: {
  slot: MediaSlot;
  scale: number;
  className?: string;
  reduced: boolean;
}) {
  const desktopSrc = normalizeMediaUrl(slot.desktopUrl);
  const mobileSrc = normalizeMediaUrl(slot.mobileUrl) || desktopSrc;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 40, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 1.2, ease: EASE_OUT, delay: 0.2 }}
      style={{ "--mach-pscale": scale } as CSSProperties}
      className={`pointer-events-none relative ${className}`}>
      {/* Key light. Without it a cut-out on black reads as a sticker. */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 -z-10 h-[142%] w-[152%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(255,255,255,0.22), rgba(255,255,255,0.07) 44%, transparent 74%)",
        }}
      />
      {/* Contact shadow. */}
      <div
        aria-hidden="true"
        className="absolute bottom-[-2%] left-1/2 -z-10 h-[8%] w-[76%] -translate-x-1/2 rounded-[50%] bg-black/85 blur-xl"
      />
      <picture>
        {mobileSrc !== desktopSrc && (
          <source media="(min-width: 1024px)" srcSet={desktopSrc} />
        )}
        <img
          src={mobileSrc || desktopSrc}
          alt={slot.alt || ""}
          loading="eager"
          fetchPriority="high"
          decoding="sync"
          className="h-full w-auto max-w-none object-contain drop-shadow-[0_40px_70px_rgba(0,0,0,0.8)]"
        />
      </picture>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stage                                                             */
/* ------------------------------------------------------------------ */

/**
 * The right-hand media cell.
 *
 * It holds the lighting and the pack shot, not the photograph — the scene is a
 * section-level layer, because a wide campaign shot squeezed into a 46% column
 * loses everything that made it a campaign shot. So on desktop the picture
 * runs the full frame and this cell is where it is *lit*; the seam hairline
 * then reads as an editorial rule drawn over the composition rather than the
 * edge of a box the image is trapped in.
 *
 * On a phone it stops being a cell at all: the picture runs the whole frame and
 * this layer floats over its upper half, carrying the lighting and the pack
 * shot while the copy sits over a gradient at the foot. One continuous
 * composition, not a picture followed by a black box of text.
 */
function Stage({
  productSlot,
  hasProduct,
  hasScene,
  productScale,
  reduced,
  className = "",
}: {
  productSlot: MediaSlot | undefined;
  hasProduct: boolean;
  hasScene: boolean;
  productScale: number;
  reduced: boolean;
  className?: string;
}) {
  return (
    <div
      className={`relative ${
        // The seam rule divides an empty stage from the copy. Drawn across a
        // photograph it stops reading as structure and starts reading as a
        // rendering seam — and the graded wash already does the dividing.
        hasScene ? "" : "lg:border-l lg:border-white/10"
      } ${className}`}>
      {/* Clipped, so the light never spills into the copy column. The pack
          shot sits outside this and is free of the clip. */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Clipping the rig leaves a visible edge once it is lying over a
            photograph that is already lit, so with a scene the picture carries
            the depth on its own. Without one the rig is the depth. */}
        {!hasScene && <StageLight reduced={reduced} />}
      </div>

      {hasProduct && productSlot && (
        <div className="absolute inset-0 flex items-center justify-center">
          <PackShot
            slot={productSlot}
            scale={productScale}
            reduced={reduced}
            className="h-[calc(30svh*var(--mach-pscale))] translate-y-[10%] lg:h-[calc(52svh*var(--mach-pscale))] lg:translate-y-0"
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Scroll cue                                                        */
/* ------------------------------------------------------------------ */

/**
 * A travelling hairline at the foot of the copy column.
 *
 * Wordless on purpose — it needs no CMS copy and no translation, and it reads
 * the same in every language the storefront ever runs in.
 */
function ScrollCue({ tint, reduced }: { tint: string; reduced: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`absolute bottom-0 left-5 z-10 hidden h-20 w-px overflow-hidden sm:left-8 lg:left-12 lg:block xl:left-16 ${tint}`}>
      {!reduced && (
        <motion.span
          className="absolute inset-x-0 top-0 block h-8 bg-white"
          initial={{ y: -32 }}
          animate={{ y: 80 }}
          transition={{
            duration: 2.6,
            ease: "easeInOut",
            repeat: Number.POSITIVE_INFINITY,
            repeatDelay: 0.5,
          }}
        />
      )}
    </div>
  );
}

/** The arrow that rides the primary CTA. */
function CtaArrow() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-px w-5 shrink-0 bg-current transition-transform duration-300 group-hover:translate-x-1"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Hero                                                              */
/* ------------------------------------------------------------------ */

export function MachHero({
  content,
  onCtaClick,
}: {
  content: HomepageHeroContent;
  onCtaClick?: (link: string) => void;
}) {
  const reduced = useReducedMotion() ?? false;

  /* ── Media resolution ── */

  // Content saved before the campaign-media slot existed still carries the old
  // flat background fields — honour them rather than showing nothing.
  const legacySlot: MediaSlot | undefined =
    isMediaSlotEmpty(content.media) && content.backgroundImage
      ? {
          kind: "image",
          desktopUrl: content.backgroundImage,
          mobileUrl: content.mobileBackgroundImage ?? "",
          alt: "",
        }
      : undefined;

  const sceneSlot = legacySlot ?? content.media;
  const hasScene = !isMediaSlotEmpty(sceneSlot);
  const productSlot = content.productMedia;
  const hasProduct = !isMediaSlotEmpty(productSlot);
  const hasMedia = hasScene || hasProduct;

  const layout: HeroMediaLayout = content.mediaLayout ?? "split";
  const isSplit = layout === "split";

  /* ── Treatment ── */

  const align: TextAlign = content.align ?? "left";
  const vAlign = content.verticalAlign ?? "bottom";
  // A dark-on-light treatment only makes sense with a photograph under the
  // copy. In the split the copy sits on the ink ground, so it always reads
  // light there whatever the client picked for the (absent) image.
  const theme: TextTheme =
    !isSplit && hasScene ? (content.textTheme ?? "light") : "light";
  const text = textClassesForTheme(theme);
  const cta = heroCtaPairForTheme(theme);
  const washBase = theme === "dark" ? "255,255,255" : "0,0,0";
  const scrim = Math.min(100, Math.max(0, content.overlayOpacity ?? 55)) / 100;
  const productScale =
    Math.min(140, Math.max(60, content.productScale ?? 100)) / 100;
  // Deep enough for white type, short of opaque so the picture still reads
  // through it. A solid stop is what made the copy side look like a black box
  // bolted onto the photograph rather than part of it.
  const dWash = Math.min(0.93, 0.62 + scrim * 0.55);
  const mWash = Math.min(0.92, 0.6 + scrim * 0.55);

  // The split always shares the frame. Full-bleed only does when there is a
  // photograph in it; alone, the headline takes the extra size and the width.
  const sharesFrame = isSplit || hasMedia;
  const headingCls = sharesFrame ? HEADING_HERO_CAMPAIGN : HEADING_HERO_SOLO;

  /* ── Copy alignment ── */

  const alignCls =
    align === "center"
      ? "items-center text-center"
      : align === "right"
        ? "items-end text-right"
        : "items-start text-left";

  const vAlignCls =
    vAlign === "top"
      ? "justify-start"
      : vAlign === "middle"
        ? "justify-center"
        : "justify-end";

  /* ── CTAs ── */

  const primaryHref = content.ctaLink;
  const showPrimary =
    Boolean(content.ctaText?.trim()) && !isPlaceholderLink(primaryHref);
  const secondaryHref = content.secondaryCtaLink;
  const showSecondary =
    Boolean(content.secondaryCtaText?.trim()) &&
    !isPlaceholderLink(secondaryHref);

  /** Entry animation for one copy element, stepped by `delay`. */
  const fade = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 30 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.8, ease: EASE_OUT, delay },
        };

  const eyebrow: ReactNode = content.subtitle ? (
    <motion.p {...fade(0.08)} className={`${EYEBROW} ${text.eyebrow}`}>
      <span
        aria-hidden="true"
        className={`inline-block h-px w-10 shrink-0 lg:w-16 ${text.tick}`}
      />
      {content.subtitle}
    </motion.p>
  ) : null;

  const action = (
    href: string,
    label: string,
    className: string,
    children: ReactNode,
  ) =>
    onCtaClick ? (
      <button
        type="button"
        onClick={() => onCtaClick(href)}
        className={className}>
        {children}
      </button>
    ) : (
      <a href={href} aria-label={label} className={className}>
        {children}
      </a>
    );

  return (
    <section className="relative isolate w-full overflow-hidden bg-[var(--mach-ink)]">
      {/* ── Split scene ──
          Banded to the top of the frame on a phone, running the whole frame on
          desktop. Campaign photography is shot wide; cropping it to the stage
          column would throw away the composition it was framed for, so on a
          large screen the picture bleeds and the wash below is what hands the
          left half back to the copy. */}
      {isSplit && hasScene && (
        <>
          <motion.div
            className="absolute inset-0 [&>picture]:block [&>picture]:h-full [&>picture]:w-full"
            initial={reduced ? false : { scale: 1.07 }}
            animate={{ scale: 1 }}
            transition={{ duration: 2.2, ease: EASE_OUT }}>
            <MachMedia slot={sceneSlot} priority />
          </motion.div>

          {/* Phone: the copy sits *on* the picture, so readability comes from a
              gradient rising out of the foot of the frame rather than from a
              black block below it. The top two-thirds stay close to untouched,
              which is where the packaging colour lives. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 lg:hidden"
            style={{
              background: `linear-gradient(to top, rgba(0,0,0,${mWash.toFixed(
                3,
              )}) 0%, rgba(0,0,0,${(mWash * 0.9).toFixed(3)}) 26%, rgba(0,0,0,${(
                mWash * 0.52
              ).toFixed(3)}) 48%, rgba(0,0,0,${(mWash * 0.2).toFixed(
                3,
              )}) 70%, rgba(0,0,0,${(scrim * 0.16).toFixed(3)}) 100%)`,
            }}
          />

          {/* Desktop: graded across the frame. Solid ink under the copy,
              clearing completely by the time it reaches the stage, so the
              subject keeps full contrast instead of being dimmed with it. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden lg:block"
            style={{
              background: `linear-gradient(to ${
                align === "right" ? "left" : "right"
              }, rgba(0,0,0,${dWash.toFixed(3)}) 0%, rgba(0,0,0,${(
                dWash * 0.9
              ).toFixed(3)}) 20%, rgba(0,0,0,${(dWash * 0.66).toFixed(
                3,
              )}) 36%, rgba(0,0,0,${(dWash * 0.26).toFixed(
                3,
              )}) 55%, rgba(0,0,0,0) 76%)`,
            }}
          />
          {/* Foot of the frame — keeps the CTA row and the handoff to the
              marquee off any bright patch of photograph. */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 hidden h-2/5 bg-linear-to-t from-[var(--mach-ink)] via-[var(--mach-ink)]/40 to-transparent lg:block"
          />
        </>
      )}

      {/* ── Full-bleed scene ──
          The other layout: one photograph across the frame with the copy
          overlaid. */}
      {!isSplit && hasScene && (
        <>
          <motion.div
            className="absolute inset-0 [&>picture]:block [&>picture]:h-full [&>picture]:w-full"
            initial={reduced ? false : { scale: 1.07 }}
            animate={{ scale: 1 }}
            transition={{ duration: 2.2, ease: EASE_OUT }}>
            <MachMedia slot={sceneSlot} priority />
          </motion.div>
          {/* Graded across the frame rather than flat: a uniform scrim dims the
              subject as hard as the background and turns a campaign photograph
              into wallpaper. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 z-3"
            style={{
              background: `linear-gradient(${
                align === "right" ? "to left" : "to right"
              }, rgba(${washBase},${scrim}) 0%, rgba(${washBase},${
                scrim * 0.8
              }) 34%, rgba(${washBase},${scrim * 0.26}) 64%, rgba(${washBase},0) 92%)`,
            }}
          />
          <div
            aria-hidden="true"
            className={`absolute inset-x-0 bottom-0 z-3 h-1/2 ${
              theme === "dark"
                ? "bg-linear-to-t from-white/85 to-transparent"
                : "bg-linear-to-t from-black/85 to-transparent"
            }`}
          />
        </>
      )}

      {/* Full-bleed pack shot — high and off the right edge on a phone, held
          in the right half on desktop. */}
      {!isSplit && hasProduct && productSlot && (
        <div className="absolute inset-y-0 right-0 z-6 flex w-[62%] items-center justify-center lg:w-[44%]">
          <PackShot
            slot={productSlot}
            scale={productScale}
            reduced={reduced}
            className="h-[calc(36svh*var(--mach-pscale))] -translate-y-[18%] translate-x-[14%] lg:h-[calc(64svh*var(--mach-pscale))] lg:translate-x-0 lg:translate-y-0"
          />
        </div>
      )}

      {/* Head of the frame — the navbar sits transparent over this. Always
          drawn: on a phone the stage reaches the top of the frame. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-32 lg:h-40 ${
          theme === "dark"
            ? "bg-linear-to-b from-white/75 via-white/25 to-transparent"
            : "bg-linear-to-b from-black/80 via-black/30 to-transparent"
        }`}
      />

      {/* ── Composition ──
          One layer on a phone — the copy is the only thing in flow, sitting at
          the foot of the picture — and a split grid from lg up, where the copy
          takes its own column beside the media. */}
      <div className="relative z-4 flex min-h-[78svh] w-full flex-col lg:grid lg:min-h-[76svh] lg:grid-cols-[36fr_64fr]">
        {/* Copy */}
        <div
          className={`flex flex-1 flex-col ${vAlignCls} lg:col-start-1 lg:row-start-1 ${
            isSplit && hasMedia ? "pt-28 sm:pt-32" : "pt-28"
          } px-5 pb-12 sm:px-8 sm:pb-14 lg:px-12 lg:pb-14 lg:pt-28 xl:px-14`}>
          {/* One block, and the placement lives on the cell itself. The copy
              used to hang off two nested `h-full` / `flex-1` wrappers left over
              from an earlier composition, which quietly stopped resolving once
              the stage came out of flow and left the copy stranded at the top
              of the picture. */}
          <div className={`flex w-full flex-col ${alignCls}`}>
            {eyebrow}

            <motion.h1
              {...fade(0.18)}
              className={`mt-5 max-w-[15ch] ${headingCls} ${text.heading}`}>
              {content.title}
            </motion.h1>

            {content.supportingText && (
              <motion.p
                {...fade(0.3)}
                className={`mt-5 max-w-[34ch] text-[14px] leading-[1.6] sm:text-[15px] lg:mt-6 ${text.body}`}>
                {content.supportingText}
              </motion.p>
            )}

            {(showPrimary || showSecondary) && (
              <motion.div
                {...fade(0.42)}
                className={`mt-7 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-6 lg:mt-8 ${
                  align === "center"
                    ? "sm:justify-center"
                    : align === "right"
                      ? "sm:justify-end"
                      : ""
                }`}>
                {showPrimary &&
                  action(
                    primaryHref,
                    content.ctaText,
                    `${cta.primary} w-full sm:w-auto`,
                    <>
                      {content.ctaText}
                      <CtaArrow />
                    </>,
                  )}
                {showSecondary &&
                  action(
                    secondaryHref as string,
                    content.secondaryCtaText as string,
                    `${cta.secondary} w-full justify-center sm:w-auto sm:justify-start`,
                    <span className="relative inline-block">
                      {content.secondaryCtaText}
                      <span
                        aria-hidden="true"
                        className="absolute -bottom-1.5 left-0 block h-px w-full origin-left scale-x-100 bg-current opacity-40 transition-opacity duration-300 group-hover:opacity-100"
                      />
                    </span>,
                  )}
              </motion.div>
            )}
          </div>
        </div>

        {/* Stage */}
        {isSplit && (
          <Stage
            productSlot={productSlot}
            hasProduct={hasProduct}
            hasScene={hasScene}
            productScale={productScale}
            reduced={reduced}
            // Out of flow on a phone, so it floats over the upper half of the
            // picture instead of pushing the copy into a block beneath it.
            //
            // Back in flow from `lg` as a *relative* grid item, never `static`:
            // the stage's own lighting and pack-shot layers are `absolute
            // inset-0`, so a static cell hands them to the grid container
            // instead — one transparent layer stretched across the whole
            // composition, painted after the copy column and swallowing every
            // click on the CTAs beneath it.
            className={`pointer-events-none absolute inset-x-0 top-0 z-2 h-[58%] lg:pointer-events-auto lg:relative lg:z-auto lg:h-auto lg:col-start-2 lg:row-start-1 ${
              hasMedia ? "" : "hidden lg:block"
            }`}
          />
        )}
      </div>

      <ScrollCue
        tint={theme === "dark" ? "bg-black/15" : "bg-white/20"}
        reduced={reduced}
      />

      <Vignette />
      <Grain />

      {/* Hard bottom edge — the hero hands off into the marquee rather than
          fading into it. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 z-30 h-px bg-white/20"
      />
    </section>
  );
}
