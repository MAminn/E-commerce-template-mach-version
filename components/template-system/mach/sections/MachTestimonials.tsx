import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { HomepageContent } from "#root/shared/types/homepage-content";
import { GUTTER, SHELL } from "../machTokens";

type TestimonialsContent = NonNullable<HomepageContent["testimonials"]>;
type Item = TestimonialsContent["items"][number];
type Lang = "en" | "ar";

/**
 * Customer testimonials on the Mach landing page: one compact horizontal
 * row of white cards on the paper ground, scrolled natively (snap points,
 * swipe) with prev/next controls and keyboard support. No autoplay.
 *
 * The records come from the homepage CMS `testimonials` block — hand-edited
 * or CSV-imported — and this component only presents them: nothing here is
 * invented (no avatars, no "verified" claims) and nothing reads
 * product_review.
 *
 * Language: a card shows one language at a time. When any entry carries
 * both versions a small English / العربية control appears in the header;
 * it starts on the site language when a locale cookie is present and on
 * English otherwise. Entries written only in Arabic render as Arabic
 * regardless — direction and font follow the script of the text itself, so
 * an Arabic quote is never uppercased or letter-spaced.
 */

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F]/;
const isArabic = (s: string | undefined) => !!s && ARABIC_RE.test(s);

/** Site language, when a storefront locale is set; the Mach chrome itself
 * has no switch, so this only honours a choice made elsewhere. */
function readSiteLang(): Lang {
  if (typeof document === "undefined") return "en";
  if (document.documentElement.lang?.toLowerCase().startsWith("ar")) return "ar";
  return /(?:^|; )minimal-locale=ar(?:;|$)/.test(document.cookie) ? "ar" : "en";
}

const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function Stars({ rating }: { rating: number }) {
  const r = Math.min(5, Math.max(0, Math.round(rating)));
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={`${r} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={
            i <= r
              ? "h-3.5 w-3.5 fill-[var(--mach-ink)] text-[var(--mach-ink)]"
              : "h-3.5 w-3.5 text-[var(--mach-ink)]/25"
          }
        />
      ))}
    </span>
  );
}

/** Quote clamped to a few lines, with an accessible expander when it needs one. */
function Quote({
  text,
  rtl,
  expanded,
  onToggle,
  id,
}: {
  text: string;
  rtl: boolean;
  expanded: boolean;
  onToggle: () => void;
  id: string;
}) {
  const ref = useRef<HTMLQuoteElement | null>(null);
  const [clamps, setClamps] = useState(false);

  // Whether the collapsed quote actually overflows its clamp — measured, so
  // short quotes get no button and long ones keep it at any text size.
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (expanded) return;
      setClamps(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [expanded, text]);

  const langProps = rtl ? { dir: "rtl" as const, lang: "ar" } : { dir: "ltr" as const };

  return (
    <div className="min-w-0">
      <blockquote
        ref={ref}
        id={id}
        {...langProps}
        className={`whitespace-pre-line text-[0.9375rem] leading-[1.6] text-[var(--mach-ink)]/85 sm:text-base ${
          rtl ? "text-right" : ""
        } ${expanded ? "" : "line-clamp-5"}`}>
        {text}
      </blockquote>
      {(clamps || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={onToggle}
          {...langProps}
          className={`mt-2 text-[0.8125rem] font-semibold text-[var(--mach-ink)] underline underline-offset-4 decoration-[var(--mach-ink)]/40 hover:decoration-[var(--mach-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-2 ${
            rtl ? "block w-full text-right" : ""
          }`}>
          {expanded ? (rtl ? "عرض أقل" : "Show less") : rtl ? "اقرأ المزيد" : "Read more"}
        </button>
      )}
    </div>
  );
}

function TestimonialCard({ item, lang, index }: { item: Item; lang: Lang; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const quoteId = `${useId()}-quote`;

  const useAr = lang === "ar" && !!item.reviewAr?.trim();
  const review = (useAr ? item.reviewAr : item.review)?.trim() ?? "";
  // The name stays paired with the language of the quote being shown.
  const name = ((useAr ? item.nameAr : undefined) ?? item.name).trim();
  const rtl = isArabic(review);
  const nameRtl = isArabic(name);

  return (
    <li
      className="flex min-h-[220px] shrink-0 basis-[84%] snap-start flex-col rounded-lg border border-[var(--mach-paper-line)] bg-white p-5 sm:basis-[calc((100%-1rem)/2)] sm:p-6 lg:basis-[calc((100%-2rem)/3)]"
      aria-label={`Testimonial ${index + 1}`}>
      <Stars rating={item.rating} />
      <div className="mt-3">
        <Quote
          text={review}
          rtl={rtl}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          id={quoteId}
        />
      </div>
      <footer className="mt-auto pt-4">
        <p
          dir={nameRtl ? "rtl" : "ltr"}
          lang={nameRtl ? "ar" : undefined}
          className={
            nameRtl
              ? "text-right text-[0.875rem] font-semibold text-[var(--mach-ink)]"
              : "text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-[var(--mach-ink)]"
          }>
          {name}
        </p>
      </footer>
    </li>
  );
}

export function MachTestimonials({ content }: { content: TestimonialsContent }) {
  const items = useMemo(
    () =>
      (content.items ?? []).filter(
        (item) => item?.name?.trim() && item?.review?.trim(),
      ),
    [content.items],
  );

  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => {
    setLang(readSiteLang());
  }, []);

  const scrollerRef = useRef<HTMLUListElement | null>(null);
  const [nav, setNav] = useState({ overflow: false, atStart: true, atEnd: true });

  const updateNav = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const overflow = max > 1;
    setNav({
      overflow,
      atStart: el.scrollLeft <= 1,
      atEnd: el.scrollLeft >= max - 1,
    });
  }, []);

  useIsoLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateNav();
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateNav);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateNav) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [updateNav, items.length, lang]);

  const scrollByCards = useCallback((direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const first = el.querySelector("li");
    const gap = Number.parseFloat(getComputedStyle(el).columnGap || "16") || 16;
    const step = (first?.getBoundingClientRect().width ?? el.clientWidth) + gap;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * step, behavior: reduce ? "auto" : "smooth" });
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.target !== e.currentTarget) return; // let buttons inside handle their own keys
    if (e.key === "ArrowRight") { e.preventDefault(); scrollByCards(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); scrollByCards(-1); }
    else if (e.key === "Home") { e.preventDefault(); scrollerRef.current?.scrollTo({ left: 0 }); }
    else if (e.key === "End") { e.preventDefault(); scrollerRef.current?.scrollTo({ left: scrollerRef.current.scrollWidth }); }
  };

  if (!content.enabled || items.length === 0) return null;

  const hasBilingual = items.some(
    (i) => !!i.reviewAr?.trim() && !!i.review?.trim(),
  );
  const titleEn = content.title?.trim() || "What our customers say";
  const titleAr = content.titleAr?.trim();
  const title = lang === "ar" && titleAr ? titleAr : titleEn;
  const titleRtl = isArabic(title);
  const count = items.length;

  const navBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--mach-paper-line)] bg-white text-[var(--mach-ink)] transition-colors hover:bg-[var(--mach-ink)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mach-paper)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-white disabled:hover:text-[var(--mach-ink)]";
  const langBtn = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-[0.75rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mach-paper)] ${
      active
        ? "bg-[var(--mach-ink)] text-white"
        : "text-[var(--mach-ink)]/70 hover:text-[var(--mach-ink)]"
    }`;

  return (
    <section
      id="testimonials"
      data-testid="mach-testimonials"
      className="scroll-mt-24 bg-[var(--mach-paper)] text-[var(--mach-ink)]">
      <div className={`${SHELL} ${GUTTER} py-8 sm:py-12`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-[var(--mach-mute)]">
              {count} {count === 1 ? "testimonial" : "testimonials"}
            </p>
            <h2
              dir={titleRtl ? "rtl" : "ltr"}
              lang={titleRtl ? "ar" : undefined}
              className={
                titleRtl
                  ? "mt-1.5 text-[clamp(1.5rem,1.2rem+1.2vw,2.25rem)] font-medium leading-[1.2]"
                  : "mt-1.5 text-[clamp(1.5rem,1.1rem+1.4vw,2.5rem)] font-black uppercase leading-[1] tracking-[-0.02em]"
              }>
              {title}
            </h2>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end sm:gap-3">
            {hasBilingual ? (
              <fieldset
                data-testid="testimonials-lang"
                className="inline-flex items-center rounded-md border border-[var(--mach-paper-line)] bg-white p-0.5">
                <legend className="sr-only">Testimonial language</legend>
                <button
                  type="button"
                  aria-pressed={lang === "en"}
                  onClick={() => setLang("en")}
                  className={langBtn(lang === "en")}>
                  English
                </button>
                <button
                  type="button"
                  lang="ar"
                  aria-pressed={lang === "ar"}
                  onClick={() => setLang("ar")}
                  className={langBtn(lang === "ar")}>
                  العربية
                </button>
              </fieldset>
            ) : (
              <span aria-hidden="true" />
            )}
            {nav.overflow && (
              <div className="flex items-center gap-1.5" data-testid="testimonials-nav">
                <button
                  type="button"
                  className={navBtn}
                  aria-label="Previous testimonials"
                  disabled={nav.atStart}
                  onClick={() => scrollByCards(-1)}>
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={navBtn}
                  aria-label="Next testimonials"
                  disabled={nav.atEnd}
                  onClick={() => scrollByCards(1)}>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/*
          Native horizontal scroller: swipe on touch, arrows and keyboard on
          desktop. `items-stretch` keeps every card the height of the tallest
          so authors line up; an expanded quote grows the row rather than
          clipping. Snap is proximity, not mandatory, so a card wider than the
          viewport (or an expanded one) can still be scrolled through.
        */}
        {/* A scrollable region must be reachable by keyboard (WCAG 2.1.1) —
            browsers focus scrollers natively for the same reason — and
            ArrowLeft/Right/Home/End below scroll it. */}
        <ul
          ref={scrollerRef}
          // biome-ignore lint/a11y/useSemanticElements: a list of testimonials that is also the scroll region
          role="region"
          aria-label="Customer testimonials"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-scrollable region, see above
          tabIndex={0}
          onKeyDown={onKeyDown}
          data-testid="testimonials-scroller"
          className="mach-scroll-hide mt-5 flex snap-x snap-proximity gap-4 overflow-x-auto overscroll-x-contain scroll-smooth pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--mach-paper)] motion-reduce:scroll-auto sm:mt-6">
          {items.map((item, index) => (
            <TestimonialCard
              key={`${index}-${item.name}`}
              item={item}
              lang={lang}
              index={index}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
