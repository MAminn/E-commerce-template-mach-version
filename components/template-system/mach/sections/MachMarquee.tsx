import { useMemo } from "react";
import type { HomepageHeroMarqueeContent } from "#root/shared/types/homepage-content";

/**
 * Kinetic strip that runs under the hero.
 *
 * This is where the page's energy comes from without spending any colour on
 * it — a single CMS line repeated edge-to-edge, scrolling continuously.
 *
 * The track is duplicated and translated by exactly -50%, which is what makes
 * the loop seamless at any content width. Motion is CSS-driven (see
 * `.mach-marquee-track` in layouts/style.css) and disabled entirely under
 * `prefers-reduced-motion`, where it degrades to a static repeated line.
 */
export function MachMarquee({
  content,
}: {
  content: HomepageHeroMarqueeContent;
}) {
  const separator = content.separator?.trim() || "•";
  const speed = content.speedSeconds ?? 28;
  const invert = content.invert ?? true;

  // Enough repeats that the track overflows even very wide viewports before
  // the loop point is reached.
  const items = useMemo(() => Array.from({ length: 8 }, (_, i) => i), []);

  if (!content.text?.trim()) return null;

  const groundCls = invert
    ? "bg-[var(--mach-ink)] text-white"
    : "bg-white text-[var(--mach-ink)]";
  const ruleCls = invert ? "border-white/12" : "border-[var(--mach-ink)]/12";

  const renderRun = (key: string) => (
    <div key={key} className="flex shrink-0 items-center">
      {items.map((i) => (
        <span
          key={i}
          className="flex items-center whitespace-nowrap text-[15px] font-black uppercase tracking-[0.22em] sm:text-[18px] lg:text-[22px]">
          {content.text}
          <span aria-hidden="true" className="mx-6 opacity-40 sm:mx-9">
            {separator}
          </span>
        </span>
      ))}
    </div>
  );

  return (
    <section
      aria-label={content.text}
      className={`relative w-full overflow-hidden border-y py-5 sm:py-6 lg:py-7 ${groundCls} ${ruleCls}`}>
      <div
        className="mach-marquee-track"
        data-direction={content.direction ?? "left"}
        style={{ animationDuration: `${speed}s` }}>
        {/* Two identical runs — the second is what the first loops into. */}
        {renderRun("run-a")}
        {renderRun("run-b")}
      </div>
    </section>
  );
}
