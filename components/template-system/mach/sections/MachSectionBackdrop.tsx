import type { MachSectionBackground } from "#root/shared/types/homepage-content";
import {
  isSectionBackgroundActive,
  resolveSectionBackground,
} from "#root/shared/types/homepage-content";
import { normalizeMediaUrl } from "../MachMedia";
import type { MachRowGround } from "./MachProductRow";
import { MACH_ROW_GROUND_CLASSES, MACH_ROW_GROUND_TEXT } from "./MachProductRow";

/**
 * The optional image or video behind one product section.
 *
 * Every product section on the Mach homepage — the four curated merchandising
 * shelves and every broad group — can be given a background in the CMS, and
 * all three of the components a section can render through (the dense row, the
 * carousel, the feature panels) lay it the same way: one absolutely positioned
 * layer covering the whole section, with the section's own content lifted a
 * stacking level above it.
 *
 * Three rules hold it together, and all three are the reason this is one
 * module rather than three copies:
 *
 *  1. **It covers the section, not the products.** The layer is a child of the
 *     `<section>` itself, so it runs under the heading, the sub-heading, the
 *     shelf, the carousel arrows and the "view all" alike. A background that
 *     started below the header would read as a band behind the cards.
 *
 *  2. **It changes nothing about the section's height.** `object-cover` on a
 *     layer pinned to `inset-0` takes its size from whatever the content came
 *     to — there is no fixed height anywhere here, so a section with a
 *     background is exactly as tall as the same section without one.
 *
 *  3. **A section with no background is untouched.** `machSectionBackdrop`
 *     returns the classes the section already had whenever the background is
 *     inactive, so the existing storefront markup is unchanged for every
 *     section the client has not configured — which is all of them until they
 *     do.
 *
 * The media is decorative: it is hidden from assistive technology, takes no
 * pointer events, and video carries no audio and no controls.
 */

/**
 * The classes a section and its content wrapper take, given its ground and
 * whether it has a background.
 *
 * Written as one function because the two halves have to agree. A section
 * keeps its ground's *text* colour when a background is laid behind it — the
 * heading on Offers stays white — but must drop the ground's opaque *fill*, or
 * the fill paints straight over the media. Returning both class strings from
 * one place is what stops a section painting its ground over its own
 * background, which is the single way this feature can fail silently.
 *
 * With no background both strings are what the component already had: the full
 * ground class, and no wrapper class at all.
 */
export function machSectionBackdrop(
  ground: MachRowGround,
  background: MachSectionBackground | null | undefined,
): { active: boolean; sectionCls: string; contentCls: string } {
  const active = isSectionBackgroundActive(background);
  if (!active) {
    return {
      active,
      sectionCls: MACH_ROW_GROUND_CLASSES[ground],
      contentCls: "",
    };
  }
  return {
    active,
    // `isolate` keeps the two levels below private to this section, so a
    // background cannot interact with the stacking of the sections around it.
    sectionCls: `${MACH_ROW_GROUND_TEXT[ground]} relative isolate overflow-hidden`,
    contentCls: "relative z-10",
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

  if (resolved.type === "video") {
    return (
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
    );
  }

  return (
    <img
      className={layer}
      src={url}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
    />
  );
}
