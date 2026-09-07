import { memo } from "react";
import type { MediaSlot } from "#root/shared/types/homepage-content";
import { isMediaSlotEmpty } from "#root/shared/types/homepage-content";

/**
 * Renders a CMS `MediaSlot` as a full-bleed layer.
 *
 * Handles the three things every large Mach visual needs and no section should
 * re-solve:
 *   - a dedicated mobile crop when the client supplied one
 *   - video slots, muted/looped/inline with a poster frame
 *   - the slot's focal point, so a hard full-bleed crop can be re-centred
 *     from the CMS rather than needing the asset re-cut
 *
 * Renders nothing when the slot is empty — sections decide their own fallback.
 */

/**
 * Turns a stored path into something the browser can actually request.
 *
 * Bare filenames are what the older upload paths persist, so they get the
 * `/uploads/` prefix. Absolute URLs, root-relative paths and inline `data:`
 * URIs are already resolvable and must be passed through untouched — prefixing
 * one produces a URL that silently 404s.
 */
export function normalizeMediaUrl(raw: string | undefined | null): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  if (
    value.startsWith("http") ||
    value.startsWith("/") ||
    value.startsWith("data:") ||
    value.startsWith("blob:")
  ) {
    return value;
  }
  return `/uploads/${value}`;
}

function objectPosition(slot: MediaSlot): string {
  const x = slot.focalPoint?.x ?? 50;
  const y = slot.focalPoint?.y ?? 50;
  return `${x}% ${y}%`;
}

export interface MachMediaProps {
  slot: MediaSlot | undefined;
  className?: string;
  /**
   * Hints the browser to fetch this immediately. Set on the hero only —
   * everything below the fold should stay lazy.
   */
  priority?: boolean;
}

export const MachMedia = memo(function MachMedia({
  slot,
  className = "",
  priority = false,
}: MachMediaProps) {
  if (!slot || isMediaSlotEmpty(slot)) return null;

  const desktop = normalizeMediaUrl(slot.desktopUrl);
  const mobile = normalizeMediaUrl(slot.mobileUrl) || desktop;
  const poster = normalizeMediaUrl(slot.posterUrl);
  const position = objectPosition(slot);

  if (slot.kind === "video") {
    // A mobile-specific source is swapped by <source media=...>; browsers pick
    // the first matching source, so the mobile entry has to come first.
    return (
      <video
        className={`h-full w-full object-cover ${className}`}
        style={{ objectPosition: position }}
        autoPlay
        muted
        loop
        playsInline
        preload={priority ? "auto" : "metadata"}
        poster={poster || undefined}
        aria-label={slot.alt || undefined}>
        {mobile !== desktop && (
          <source src={mobile} media="(max-width: 767px)" />
        )}
        <source src={desktop} />
      </video>
    );
  }

  return (
    <picture>
      {mobile !== desktop && (
        <source media="(max-width: 767px)" srcSet={mobile} />
      )}
      <img
        src={desktop}
        alt={slot.alt || ""}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding={priority ? "sync" : "async"}
        className={`h-full w-full object-cover ${className}`}
        style={{ objectPosition: position }}
      />
    </picture>
  );
});

/**
 * Bottom-weighted scrim placed between media and overlaid copy.
 *
 * Strength is CMS-controlled per section because the right value depends
 * entirely on the photograph — a blown-out gym shot needs far more than a dark
 * studio product still.
 */
export function MachScrim({
  opacity = 45,
  theme = "light",
}: {
  opacity?: number;
  theme?: "light" | "dark";
}) {
  const clamped = Math.min(100, Math.max(0, opacity)) / 100;
  // Light text needs darkness behind it and vice versa.
  const base = theme === "dark" ? "255,255,255" : "0,0,0";
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0"
      style={{
        background: `linear-gradient(to top, rgba(${base},${clamped}) 0%, rgba(${base},${clamped * 0.62}) 42%, rgba(${base},${clamped * 0.15}) 100%)`,
      }}
    />
  );
}
