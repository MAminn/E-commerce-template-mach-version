import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import type {
  HomepageUgcContent,
  UgcVideoItem,
} from "#root/shared/types/homepage-content";
import {
  formatUgcHandle,
  renderableUgcItems,
} from "#root/shared/types/homepage-ugc";
import { normalizeMediaUrl } from "../MachMedia";
import {
  EYEBROW,
  GROUND_INK_SOFT,
  GUTTER,
  RULE_ON_DARK,
  SHELL,
  TEXT_MUTE_ON_DARK,
} from "../machTokens";
import {
  RING_OFFSET,
  TRACK_GUTTER,
  machCarouselScrollStep,
} from "./MachProductCarousel";
import { MachSectionHead } from "./MachSectionHead";

/**
 * UGC / "Judge Me" — real customer videos the store owner uploads.
 *
 * Presented as a row of vertical 9:16 frames on the page's own terms: square
 * geometry, the MACH section header, the same native scroll-snap track and
 * square arrow pair the product carousel uses. It is customer evidence set in
 * the storefront's layout, not a social feed embedded in it.
 *
 * **Nothing here is invented.** Every heading, video, poster, creator name,
 * handle and caption is read from the homepage CMS, and a field the owner left
 * empty is simply absent — there is no placeholder creator, no stock clip and
 * no "coming soon" band. Switched off, or switched on with nothing uploaded,
 * the section renders nothing at all.
 *
 * **Playback is manual.** Nothing autoplays, with or without sound. A video
 * loads no media until its card is near the screen, and then only its
 * metadata — or nothing, when the owner supplied a poster to show instead. A
 * tap on the play control starts it with sound and hands over to the
 * browser's own controls; starting one pauses any other.
 */

/** Marks a card so the scroll step can measure a real one. */
const UGC_CARD_ATTRIBUTE = "data-mach-ugc-card";

/**
 * Card width at each breakpoint.
 *
 * A phone shows one card prominently with the next one peeking in: ~78vw,
 * capped so a large phone does not turn a 9:16 frame into a full screen of
 * video. From `sm` the width is fixed in `rem` — a 240-300px column of
 * vertical video, three to four across a desktop with the next one cut at the
 * content edge as the "there is more" cue. Fixed rather than a fraction of the
 * column so a 1920 screen shows more videos, not taller ones.
 */
const CARD_WIDTH = [
  "w-[min(78vw,18.5rem)]",
  "sm:w-[15rem]",
  "md:w-[15.5rem]",
  "lg:w-[16.5rem]",
  "xl:w-[17.5rem]",
  "2xl:w-[18.75rem]",
].join(" ");

const CARD_GAP = "gap-3 sm:gap-4 lg:gap-5";

/**
 * How far a video's own shape may sit from 9:16 before the frame letterboxes
 * it instead of filling. Phone footage is 9:16 and fills the frame edge to
 * edge; a landscape or square upload is shown whole on the ink ground rather
 * than having most of the picture cropped away.
 */
const VERTICAL_TOLERANCE = 0.12;

/** `object-fit` for a video of the given intrinsic size. */
export function ugcVideoFit(width: number, height: number): "cover" | "contain" {
  if (!(width > 0) || !(height > 0)) return "cover";
  const target = 9 / 16;
  return Math.abs(width / height - target) / target <= VERTICAL_TOLERANCE
    ? "cover"
    : "contain";
}

/** The accessible name of one video and of its play control. */
export function ugcVideoLabel(
  item: Pick<UgcVideoItem, "creatorName" | "creatorHandle">,
  index: number,
  count: number,
): string {
  const who = item.creatorName?.trim() || formatUgcHandle(item.creatorHandle);
  const position = `Customer video ${index + 1} of ${count}`;
  return who ? `${position}, by ${who}` : position;
}

/**
 * True once the element has come within reach of the viewport, and stays
 * true. Until then the card's video is `preload="none"`, so a row of eight
 * videos far below the fold costs the homepage nothing.
 */
function useNearViewport(ref: React.RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, near]);
  return near;
}

function UgcCard({
  item,
  index,
  count,
}: {
  item: UgcVideoItem;
  index: number;
  count: number;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  const near = useNearViewport(frameRef);

  const src = normalizeMediaUrl(item.videoUrl);
  const poster = normalizeMediaUrl(item.posterUrl) || undefined;
  const name = item.creatorName?.trim() ?? "";
  const handle = formatUgcHandle(item.creatorHandle);
  const caption = item.caption?.trim() ?? "";
  const label = ugcVideoLabel(item, index, count);

  // With a poster there is already something to look at, so nothing is
  // fetched before the shopper asks. Without one, the first frame is worth a
  // metadata request — but only once the card is close to the screen.
  const wantsMetadata = !poster && near;
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !wantsMetadata || started) return;
    if (video.preload !== "metadata") {
      video.preload = "metadata";
      video.load();
    }
  }, [wantsMetadata, started]);

  const play = () => {
    const video = videoRef.current;
    if (!video) return;
    setStarted(true);
    video.play().then(
      // The browser's controls take over from here; focus follows so a
      // keyboard user lands on them rather than on a control that is gone.
      () => video.focus({ preventScroll: true }),
      () => setStarted(false),
    );
  };

  return (
    <li
      {...{ [UGC_CARD_ATTRIBUTE]: "" }}
      className={`shrink-0 snap-start ${CARD_WIDTH}`}>
      <div
        ref={frameRef}
        className='relative aspect-[9/16] w-full overflow-hidden bg-[var(--mach-ink)]'>
        {/* biome-ignore lint/a11y/useMediaCaption: owner-uploaded clips carry no caption file, and the section never invents one */}
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          preload='none'
          playsInline
          controls={started}
          aria-label={label}
          onLoadedMetadata={(e) =>
            setFit(
              ugcVideoFit(e.currentTarget.videoWidth, e.currentTarget.videoHeight),
            )
          }
          onEnded={() => setStarted(false)}
          className={`absolute inset-0 h-full w-full ${
            fit === "cover" ? "object-cover" : "object-contain"
          }`}
        />

        {!started && (
          <button
            type='button'
            onClick={play}
            aria-label={`Play ${label}`}
            className='group absolute inset-0 flex items-center justify-center focus-visible:outline-none'>
            <span
              aria-hidden='true'
              className='inline-flex h-14 w-14 items-center justify-center bg-white text-[var(--mach-ink)] ring-1 ring-inset ring-white transition-colors duration-200 group-hover:bg-[var(--mach-ink)] group-hover:text-white group-focus-visible:bg-[var(--mach-ink)] group-focus-visible:text-white group-focus-visible:ring-2'>
              <Play className='ml-0.5 h-5 w-5 fill-current' strokeWidth={1.75} />
            </span>
          </button>
        )}
      </div>

      {(name || handle || caption) && (
        <div className='mt-3 min-w-0'>
          {(name || handle) && (
            <p className='flex flex-wrap items-baseline gap-x-2 gap-y-0.5'>
              {name && (
                <span
                  dir='auto'
                  className='text-[12px] font-bold uppercase leading-snug tracking-[0.14em] text-white'>
                  {name}
                </span>
              )}
              {handle && (
                <span
                  dir='auto'
                  className={`text-[12px] leading-snug ${TEXT_MUTE_ON_DARK}`}>
                  {handle}
                </span>
              )}
            </p>
          )}
          {caption && (
            <p
              dir='auto'
              className={`line-clamp-3 text-[13px] leading-[1.55] text-white/75 ${
                name || handle ? "mt-1.5" : ""
              }`}>
              {caption}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function MachUgcSection({ content }: { content: HomepageUgcContent }) {
  const items = renderableUgcItems(content);
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLUListElement>(null);
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [canScrollOn, setCanScrollOn] = useState(false);
  const prefersReducedMotion = useReducedMotion() ?? false;

  const syncControls = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const offset = Math.abs(el.scrollLeft);
    const overflow = el.scrollWidth - el.clientWidth;
    setCanScrollBack(offset > 4);
    setCanScrollOn(offset < overflow - 4);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies(items.length): the track mounts, and its overflow changes, with the item count
  useEffect(() => {
    syncControls();
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", syncControls, { passive: true });
    window.addEventListener("resize", syncControls);
    return () => {
      el.removeEventListener("scroll", syncControls);
      window.removeEventListener("resize", syncControls);
    };
  }, [syncControls, items.length]);

  // One video at a time. `play` does not bubble, but every event passes
  // through its ancestors on the way down, so one capture listener on the
  // section hears all of them.
  // biome-ignore lint/correctness/useExhaustiveDependencies(items.length): the section only mounts once there are videos
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const onPlay = (event: Event) => {
      for (const video of section.querySelectorAll("video")) {
        if (video !== event.target && !video.paused) video.pause();
      }
    };
    section.addEventListener("play", onPlay, true);
    return () => section.removeEventListener("play", onPlay, true);
  }, [items.length]);

  const scrollByPage = useCallback(
    (direction: 1 | -1) => {
      const el = trackRef.current;
      if (!el) return;
      const card = el.querySelector<HTMLElement>(`[${UGC_CARD_ATTRIBUTE}]`);
      const gap = Number.parseFloat(getComputedStyle(el).columnGap || "0") || 0;
      const step = machCarouselScrollStep(
        el.clientWidth,
        card?.getBoundingClientRect().width ?? el.clientWidth,
        gap,
      );
      el.scrollBy({
        left: step * direction,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    },
    [prefersReducedMotion],
  );

  // Arrow keys page the row while the track itself has focus. A focused video
  // keeps its own arrow keys, which seek.
  const onTrackKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    scrollByPage(event.key === "ArrowRight" ? 1 : -1);
  };

  if (!content.enabled || items.length === 0) return null;

  const eyebrow = content.eyebrow?.trim() ?? "";
  const heading = content.heading?.trim() ?? "";
  const subheading = content.subheading?.trim() ?? "";
  const regionLabel = heading || eyebrow || "Customer videos";
  const showControls = canScrollBack || canScrollOn;

  const controlCls = [
    "relative inline-flex h-11 w-11 items-center justify-center border",
    "border-white/30 text-white transition-colors duration-200",
    "hover:z-10 focus-visible:z-10",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2",
    RING_OFFSET["ink-soft"],
    "enabled:hover:border-white enabled:hover:bg-white enabled:hover:text-[var(--mach-ink)]",
    "disabled:cursor-not-allowed disabled:opacity-30",
  ].join(" ");

  // Hidden below `md`, where the row is swiped; only drawn at all when there
  // is somewhere to scroll to, so one or two videos get no dead controls.
  const controls = showControls ? (
    <div className='hidden items-center md:flex' data-testid='mach-ugc-controls'>
      <button
        type='button'
        onClick={() => scrollByPage(-1)}
        disabled={!canScrollBack}
        aria-label='Previous customer videos'
        className={controlCls}>
        <ChevronLeft aria-hidden='true' strokeWidth={1.75} className='h-4.5 w-4.5' />
      </button>
      <button
        type='button'
        onClick={() => scrollByPage(1)}
        disabled={!canScrollOn}
        aria-label='Next customer videos'
        className={`${controlCls} -ml-px`}>
        <ChevronRight aria-hidden='true' strokeWidth={1.75} className='h-4.5 w-4.5' />
      </button>
    </div>
  ) : undefined;

  return (
    <section
      ref={sectionRef}
      id='ugc'
      aria-label={regionLabel}
      data-testid='mach-ugc'
      className={`${GROUND_INK_SOFT} scroll-mt-24 border-t ${RULE_ON_DARK}`}>
      <div className={`${SHELL} ${GUTTER} py-12 sm:py-14 lg:py-16`}>
        {heading ? (
          <MachSectionHead
            eyebrow={eyebrow || undefined}
            title={heading}
            subtitle={subheading || undefined}
            size='sm'
            onDark
            actions={controls}
          />
        ) : (
          (eyebrow || subheading || controls) && (
            // The owner cleared the heading: show what is left, with the same
            // type, and no invented title in its place.
            <div className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
              <div className='min-w-0'>
                {eyebrow && (
                  <p className={`${EYEBROW} text-white/70`}>
                    <span
                      aria-hidden='true'
                      className='inline-block h-[2px] w-6 shrink-0 bg-white'
                    />
                    {eyebrow}
                  </p>
                )}
                {subheading && (
                  <p className={`mt-2 max-w-xl text-[13px] leading-relaxed sm:text-[14px] ${TEXT_MUTE_ON_DARK}`}>
                    {subheading}
                  </p>
                )}
              </div>
              {controls}
            </div>
          )
        )}

        {/* The track: native horizontal scrolling with snap points, bled to
            the screen edge on a phone and paid back as padding, exactly as the
            product carousel does. `py-1` keeps a focus ring from being
            clipped by the scroll container. */}
        <ul
          ref={trackRef}
          aria-label={regionLabel}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-scrollable region
          tabIndex={0}
          onKeyDown={onTrackKeyDown}
          data-testid='mach-ugc-track'
          className={`mach-scroll-hide mt-7 flex snap-x snap-mandatory items-start overflow-x-auto overscroll-x-contain py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mach-ink-soft)] lg:mt-8 ${TRACK_GUTTER} ${CARD_GAP}`}>
          {items.map((item, index) => (
            <UgcCard
              key={item.id}
              item={item}
              index={index}
              count={items.length}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
