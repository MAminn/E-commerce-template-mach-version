import type { MachSectionBackground } from "#root/shared/types/homepage-content";
import {
  clampSectionOverlayOpacity,
  isSectionBackgroundActive,
  resolveSectionBackground,
} from "#root/shared/types/homepage-content";
import { normalizeMediaUrl } from "../MachMedia";
import type { MachRowGround } from "./MachProductRow";
import { MACH_ROW_GROUND_CLASSES, MACH_ROW_GROUND_TEXT } from "./MachProductRow";

/**
 * The optional image or video behind one product section, and the wash that
 * makes the section readable on top of it.
 *
 * Every product section on the Mach homepage — the four curated merchandising
 * shelves and every broad group — can be given a background in the CMS, and
 * all three of the components a section can render through (the dense row, the
 * carousel, the feature panels) lay it the same way:
 *
 *     section
 *       media     z-0
 *       overlay   z-[1]
 *       content   z-10
 *
 * Three rules hold it together, and all three are the reason this is one
 * module rather than three copies:
 *
 *  1. **It covers the section, not the products.** Both layers are children of
 *     the `<section>` itself, so they run under the heading, the sub-heading,
 *     the shelf, the carousel arrows and the "view all" alike. A background
 *     that started below the header would read as a band behind the cards.
 *
 *  2. **It changes nothing about the section's height.** `object-cover` on a
 *     layer pinned to `inset-0` takes its size from whatever the content came
 *     to — there is no fixed height anywhere here, so a section with a
 *     background is exactly as tall as the same section without one.
 *
 *  3. **A section with no background is untouched.** `machSectionBackdrop`
 *     returns the classes the section already had whenever the background is
 *     inactive, and nothing renders here at all — no media, and no overlay.
 *
 * The media is decorative: it is hidden from assistive technology, takes no
 * pointer events, and video carries no audio and no controls.
 */

/**
 * Everything a section needs to know about its own background, in one answer.
 *
 * Written as one function because the parts have to agree. A section with a
 * background must drop its ground's opaque *fill*, or the fill paints straight
 * over the media; it must take its type colour from the client's chosen text
 * theme rather than from the ground it would otherwise have been on; and its
 * content must sit above the wash. Returning all of that from one place is
 * what stops a section painting its ground over its own background, or
 * lighting its heading against a wash going the other way.
 *
 * `onDark` is the load-bearing part, and deliberately reuses the flag this
 * storefront already has. Every Mach component that renders type — the section
 * head, the product card's name, meta and price, the carousel controls, the
 * feature panel — already takes an `onDark` boolean and has a designed
 * treatment for both states. So a light text theme is simply "this section is
 * being read as a dark surface now", and the whole typography treatment
 * follows from decisions the design already went through, rather than from a
 * second set of colour classes invented for backgrounds.
 *
 * With no background every field is what the component already had: the full
 * ground class, no wrapper class, and `onDark` from the ground itself.
 */
export interface MachSectionBackdropState {
  active: boolean;
  sectionCls: string;
  contentCls: string;
  /** Whether the section's own type renders light. */
  onDark: boolean;
}

export function machSectionBackdrop(
  ground: MachRowGround,
  background: MachSectionBackground | null | undefined,
): MachSectionBackdropState {
  const active = isSectionBackgroundActive(background);
  if (!active) {
    return {
      active,
      sectionCls: MACH_ROW_GROUND_CLASSES[ground],
      contentCls: "",
      onDark: ground === "ink",
    };
  }

  // Light text means the section is read as a dark surface, whatever ground it
  // would have been on without the picture.
  const onDark = resolveSectionBackground(background).textTheme !== "dark";
  return {
    active,
    // `isolate` keeps the three levels private to this section, so a
    // background cannot interact with the stacking of the sections around it.
    sectionCls: `${
      MACH_ROW_GROUND_TEXT[onDark ? "ink" : "white"]
    } relative isolate overflow-hidden`,
    contentCls: "relative z-10",
    onDark,
  };
}

export function MachSectionBackdrop({
  background,
}: {
  background: MachSectionBackground | null | undefined;
}) {
  const resolved = resolveSectionBackground(background);
  if (!isSectionBackgroundActive(resolved)) return null;

  const url = normalizeMediaUrl(resolved.url);
  const layer =
    "pointer-events-none absolute inset-0 z-0 h-full w-full object-cover";

  /**
   * The wash between the media and the words.
   *
   * Flat, not the bottom-weighted `MachScrim` the hero and the campaign
   * banners use. Those overlay one block of copy sitting at the foot of an
   * image, so a gradient puts the darkness where the words are and leaves the
   * top of the picture alone. A product section's words are everywhere in it —
   * heading at the top, prices at the bottom, controls on the right — so an
   * even wash is the only one that makes the whole section readable.
   *
   * Black under light text, white under dark text, at the strength the client
   * set. The media itself is never touched: the photograph keeps its own
   * contrast and only this layer changes.
   */
  const overlay = (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[1]"
      style={{
        backgroundColor: `rgba(${
          resolved.textTheme === "dark" ? "255,255,255" : "0,0,0"
        },${clampSectionOverlayOpacity(resolved.overlayOpacity) / 100})`,
      }}
    />
  );

  if (resolved.type === "video") {
    return (
      <>
        <video
          className={layer}
          src={url}
          autoPlay
          muted
          loop
          playsInline
          // Metadata rather than the whole file: the section is below the fold
          // and the browser starts the stream itself once it is played. `none`
          // would be cheaper and is wrong — an autoplaying element with nothing
          // buffered is a background that arrives late or not at all.
          preload="metadata"
          aria-hidden="true"
          tabIndex={-1}
        />
        {overlay}
      </>
    );
  }

  return (
    <>
      <img
        className={layer}
        src={url}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
      />
      {overlay}
    </>
  );
}
