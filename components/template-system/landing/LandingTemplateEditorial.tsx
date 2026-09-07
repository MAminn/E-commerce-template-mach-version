import type React from "react";
import { useState, memo } from "react";
import { Skeleton } from "#root/components/ui/skeleton";
import { Input } from "#root/components/ui/input";
import { Label } from "#root/components/ui/label";
import type { HomepageContent } from "#root/shared/types/homepage-content";
import { VALUE_PROP_ICON_MAP as ICON_MAP } from "#root/components/template-system/shared/value-prop-icons";
import type { FeaturedProduct } from "../home/HomeFeaturedProducts";
import type { CategoryStripItem } from "#root/components/shop/CategoryStrip";
import type { NewArrivalProduct } from "#root/components/shop/NewArrivals";
import { getProductUrl } from "#root/lib/utils/route-helpers";
import { EditorialChrome } from "../editorial/EditorialChrome";
import { Reveal } from "../motion/Reveal";
import { StaggerContainer, StaggerItem } from "../motion/Stagger";
import { ParallaxImage } from "../motion/ParallaxImage";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface LandingTemplateEditorialProps {
  content: HomepageContent;
  featuredProducts?: FeaturedProduct[];
  discountedProducts?: FeaturedProduct[];
  categories?: CategoryStripItem[];
  categoriesLoading?: boolean;
  newArrivals?: NewArrivalProduct[];
  newArrivalsLoading?: boolean;
  className?: string;
  onCtaClick?: (link: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const NOISE_SVG =
  "data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='256' height='256' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E";

/** Shared eyebrow treatment — small, heavy, wide-tracked, accent-marked. */
const EYEBROW =
  "inline-flex items-center gap-3 text-[10px] sm:text-[11px] tracking-[0.3em] uppercase font-bold";

/** Assertive primary CTA — flat volt block, no gradient or glow. */
const CTA_PRIMARY =
  "inline-flex items-center justify-center bg-[var(--mach-accent)] text-[var(--mach-on-accent)] px-9 py-4 text-[12px] tracking-[0.2em] uppercase font-bold transition-colors duration-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mach-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mach-ink)]";

/** Secondary CTA on a dark ground. */
const CTA_GHOST_DARK =
  "inline-flex items-center justify-center border border-white/30 px-9 py-4 text-[12px] tracking-[0.2em] uppercase font-bold text-white transition-colors duration-300 hover:border-white hover:bg-white hover:text-[var(--mach-ink)]";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function safePrice(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

function formatPrice(v: number): string {
  return `EGP ${v.toFixed(2)}`;
}

/** Normalize a raw file path / URL so it resolves correctly in the browser. */
function normalizeUrl(raw: string): string {
  if (raw.startsWith("http") || raw.startsWith("/")) return raw;
  return `/uploads/${raw}`;
}

function resolveImage(
  product: FeaturedProduct | NewArrivalProduct,
): string | null {
  const primary = product.images?.find((i) => i.isPrimary);
  if (primary?.url) return normalizeUrl(primary.url);
  if (product.images?.[0]?.url) return normalizeUrl(product.images[0].url);
  if (product.imageUrl) return normalizeUrl(product.imageUrl);
  return null;
}

function resolveSecondaryImage(
  product: FeaturedProduct | NewArrivalProduct,
): string | null {
  if (!product.images || product.images.length < 2) return null;
  const primaryIdx = product.images.findIndex((i) => i.isPrimary);
  const secondIdx = primaryIdx >= 0 ? (primaryIdx === 0 ? 1 : 0) : 1;
  const url = product.images[secondIdx]?.url;
  return url ? normalizeUrl(url) : null;
}

/** Normalize a category image URL (raw filename from DB). */
function resolveCategoryImage(
  imageUrl: string | null | undefined,
): string | null {
  if (!imageUrl) return null;
  return normalizeUrl(imageUrl);
}

/** Append a `section` filter to a shop link without breaking existing params. */
function withSection(link: string | undefined, section: string): string {
  const base = link || "/shop";
  return `${base}${base.includes("?") ? "&" : "?"}section=${section}`;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

/** Thin accent tick used to open every eyebrow line. */
function AccentTick({ dark = false }: { dark?: boolean }) {
  return (
    <span
      aria-hidden='true'
      className={`inline-block h-[2px] w-6 shrink-0 ${
        dark ? "bg-[var(--mach-accent)]" : "bg-[var(--mach-ink)]"
      }`}
    />
  );
}

export const EditorialProductTile = memo(function EditorialProductTile({
  product,
}: {
  product: FeaturedProduct | NewArrivalProduct;
}) {
  const img = resolveImage(product);
  const secondaryImg = resolveSecondaryImage(product);
  const discount = safePrice(product.discountPrice);
  const hasDiscount = discount != null && discount < product.price;
  const isSoldOut = !product.available || product.stock <= 0;
  const discountPct =
    hasDiscount && product.price > 0
      ? Math.round(((product.price - discount) / product.price) * 100)
      : 0;

  return (
    <a
      href={getProductUrl(product)}
      className='group block outline-none focus-visible:ring-2 focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-2'>
      <div className='relative aspect-4/5 w-full overflow-hidden rounded-lg bg-[var(--mach-paper-soft)]'>
        {img ? (
          <>
            <img
              src={img}
              alt={product.name}
              loading='lazy'
              decoding='async'
              className={`absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04] ${
                secondaryImg ? "group-hover:opacity-0" : ""
              }`}
            />
            {secondaryImg && (
              <img
                src={secondaryImg}
                alt=''
                loading='lazy'
                decoding='async'
                className='absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100'
              />
            )}
          </>
        ) : (
          <div className='absolute inset-0 flex items-center justify-center'>
            <span className='text-[10px] tracking-[0.28em] uppercase font-bold text-stone-400'>
              No image
            </span>
          </div>
        )}

        {/* Flat status flags — no gradients, no glow */}
        {discountPct > 0 && (
          <span className='absolute left-3 top-3 bg-[var(--mach-accent)] px-2 py-1 text-[10px] font-bold tracking-[0.12em] uppercase text-[var(--mach-on-accent)]'>
            −{discountPct}%
          </span>
        )}
        {isSoldOut && (
          <span className='absolute right-3 top-3 bg-[var(--mach-ink)] px-2 py-1 text-[10px] font-bold tracking-[0.12em] uppercase text-white'>
            Sold out
          </span>
        )}
      </div>

      <div className='mt-3.5'>
        {product.categoryName && (
          <p className='text-[10px] tracking-[0.24em] uppercase font-bold text-stone-500'>
            {product.categoryName}
          </p>
        )}
        <p className='mt-1.5 text-[15px] font-bold uppercase tracking-[0.01em] text-[var(--mach-ink)] leading-snug line-clamp-2 group-hover:underline underline-offset-4 decoration-2'>
          {product.name}
        </p>
        <div className='mt-1.5 flex items-center gap-2 text-sm'>
          {hasDiscount ? (
            <>
              <span className='font-bold text-[var(--mach-ink)]'>
                {formatPrice(discount)}
              </span>
              <span className='text-stone-500 line-through'>
                {formatPrice(product.price)}
              </span>
            </>
          ) : (
            <span className='font-semibold text-stone-700'>
              {formatPrice(product.price)}
            </span>
          )}
        </div>
      </div>
    </a>
  );
});

function SkeletonTile() {
  return (
    <div>
      <Skeleton className='aspect-4/5 w-full rounded-lg' />
      <Skeleton className='mt-3 h-3 w-20 rounded' />
      <Skeleton className='mt-2 h-4 w-32 rounded' />
    </div>
  );
}

function SkeletonTileGrid({ count = 8 }: { count?: number }) {
  return (
    <div className='grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4'>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonTile key={i} />
      ))}
    </div>
  );
}

/**
 * Shared empty state for catalogue-driven sections.
 *
 * The storefront ships before the catalogue does, so every product/category
 * section needs to hold its shape with zero rows rather than collapsing into
 * a bare heading.
 */
function CatalogEmptyState({
  label,
  note,
}: {
  label: string;
  note: string;
}) {
  return (
    <div className='flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-white/60 px-6 py-16 text-center sm:py-20'>
      <span className='inline-block h-[3px] w-8 bg-[var(--mach-accent)]' />
      <p className='mt-5 text-[12px] font-bold uppercase tracking-[0.24em] text-[var(--mach-ink)]'>
        {label}
      </p>
      <p className='mt-2 max-w-sm text-sm leading-relaxed text-stone-500'>
        {note}
      </p>
    </div>
  );
}

/**
 * Section heading shared by every product rail.
 * Heavy uppercase type + accent eyebrow, matching the Mach chrome.
 */
function SectionHead({
  eyebrow,
  title,
  subtitle,
  action,
  dark = false,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div className='flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between'>
      <div>
        <p
          className={`${EYEBROW} ${dark ? "text-white/60" : "text-stone-500"}`}>
          <AccentTick dark={dark} />
          {eyebrow}
        </p>
        <h2
          className={`mt-4 text-[clamp(1.9rem,4.5vw,3.25rem)] font-black uppercase leading-[0.95] tracking-[-0.015em] ${
            dark ? "text-white" : "text-[var(--mach-ink)]"
          }`}>
          {title}
        </h2>
        {subtitle && (
          <p
            className={`mt-3 max-w-lg text-sm leading-relaxed sm:text-[15px] ${
              dark ? "text-white/60" : "text-stone-600"
            }`}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

/** Underlined "view all" affordance used by each rail head. */
function ViewAllAction({
  label,
  href,
  onCtaClick,
}: {
  label: string;
  href: string;
  onCtaClick?: (link: string) => void;
}) {
  const cls =
    "inline-flex shrink-0 text-[12px] font-bold uppercase tracking-[0.16em] text-[var(--mach-ink)] underline underline-offset-8 decoration-2 decoration-[var(--mach-accent)] transition-colors hover:text-stone-600";
  if (onCtaClick) {
    return (
      <button type='button' onClick={() => onCtaClick(href)} className={cls}>
        {label}
      </button>
    );
  }
  return (
    <a href={href} className={cls}>
      {label}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */

export function LandingTemplateEditorial({
  content,
  featuredProducts,
  discountedProducts,
  categories,
  categoriesLoading = false,
  newArrivals,
  newArrivalsLoading = false,
  className = "",
  onCtaClick,
}: LandingTemplateEditorialProps) {
  const [newsletterSubmitted, setNewsletterSubmitted] = useState(false);

  const hasFeatured = Boolean(featuredProducts && featuredProducts.length > 0);
  const hasCategories = Boolean(categories && categories.length > 0);

  return (
    <EditorialChrome>
      <div
        className={`landing-template-editorial overflow-x-clip bg-[var(--mach-paper)] ${className}`}>
        {/* ============================================================ */}
        {/*  HERO                                                        */}
        {/* ============================================================ */}
        {content.hero.enabled && (
          <section className='relative isolate min-h-svh w-full overflow-hidden bg-[var(--mach-ink)]'>
            {/* Background image when supplied; otherwise a self-contained
                graphic treatment so the hero never requests a missing upload. */}
            {content.hero.backgroundImage ? (
              <>
                {/* Mobile / tablet: <picture> with optional mobile image */}
                <div className='absolute inset-0 lg:hidden'>
                  <picture>
                    {content.hero.mobileBackgroundImage && (
                      <source
                        media='(max-width: 640px)'
                        srcSet={content.hero.mobileBackgroundImage}
                      />
                    )}
                    <img
                      src={content.hero.backgroundImage}
                      alt=''
                      className='h-full w-full object-cover object-[center_30%] sm:object-[center_35%]'
                    />
                  </picture>
                </div>
                {/* Desktop: parallax */}
                <div className='absolute inset-0 hidden lg:block'>
                  <ParallaxImage
                    src={content.hero.backgroundImage}
                    alt=''
                    strength={18}
                    className='object-center'
                  />
                </div>
                {/* Bottom-weighted scrim for text readability */}
                <div className='absolute inset-0 bg-linear-to-t from-black/80 via-black/40 to-black/10' />
              </>
            ) : (
              <div aria-hidden='true' className='absolute inset-0'>
                {/* Flat ink ground */}
                <div className='absolute inset-0 bg-[var(--mach-ink)]' />
                {/* Two hard diagonal bands — energy without gradients */}
                <div className='absolute -right-[18%] top-[-25%] h-[160%] w-[38%] rotate-12 bg-[var(--mach-ink-soft)]' />
                <div className='absolute -right-[6%] top-[-25%] h-[160%] w-[6px] rotate-12 bg-[var(--mach-accent)] opacity-80' />
                {/* Oversized outlined wordmark, cropped by the viewport */}
                <span
                  className='pointer-events-none absolute -bottom-[6vw] -left-[2vw] select-none text-[26vw] font-black uppercase leading-none tracking-[-0.04em] text-transparent lg:text-[20vw]'
                  style={{
                    WebkitTextStroke: "1px rgba(255,255,255,0.07)",
                  }}>
                  MACH
                </span>
              </div>
            )}

            {/* Film grain — keeps large flat fields from looking dead */}
            <div
              aria-hidden='true'
              className='pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay'
              style={{
                backgroundImage: `url("${NOISE_SVG}")`,
                backgroundSize: "150px 150px",
              }}
            />

            {/* Hero content — bottom-left composition */}
            <div className='relative z-10 flex min-h-svh items-end'>
              <div className='w-full max-w-2xl px-6 pb-20 pt-28 sm:px-10 sm:pb-24 lg:max-w-4xl lg:px-16 lg:pb-28'>
                {/* Eyebrow */}
                <Reveal variant='fadeIn' delay={0.15}>
                  <p className={`${EYEBROW} text-[var(--mach-accent)]`}>
                    <AccentTick dark />
                    {content.hero.subtitle || "MACH SUPPLEMENTS"}
                  </p>
                </Reveal>

                {/* Headline */}
                <Reveal variant='fadeUp' delay={0.3}>
                  <h1 className='mt-6 max-w-3xl text-[clamp(2.5rem,7vw,5.25rem)] font-black uppercase leading-[0.9] tracking-[-0.03em] text-white'>
                    {content.hero.title}
                  </h1>
                </Reveal>

                {/* Supporting copy */}
                {content.hero.supportingText && (
                  <Reveal variant='fadeUp' delay={0.42}>
                    <p className='mt-7 max-w-md text-[15px] leading-relaxed text-white/70 sm:text-base'>
                      {content.hero.supportingText}
                    </p>
                  </Reveal>
                )}

                {/* CTAs */}
                <Reveal variant='fadeUp' delay={0.55}>
                  <div className='mt-10 flex flex-col gap-3 sm:mt-12 sm:flex-row sm:items-center sm:gap-4'>
                    {onCtaClick ? (
                      <button
                        type='button'
                        onClick={() => onCtaClick(content.hero.ctaLink)}
                        className={CTA_PRIMARY}>
                        {content.hero.ctaText}
                      </button>
                    ) : (
                      <a href={content.hero.ctaLink} className={CTA_PRIMARY}>
                        {content.hero.ctaText}
                      </a>
                    )}
                    {onCtaClick ? (
                      <button
                        type='button'
                        onClick={() => onCtaClick("/#categories")}
                        className={CTA_GHOST_DARK}>
                        Browse Categories
                      </button>
                    ) : (
                      <a href='/#categories' className={CTA_GHOST_DARK}>
                        Browse Categories
                      </a>
                    )}
                  </div>
                </Reveal>
              </div>
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/*  BRAND STATEMENT                                             */}
        {/* ============================================================ */}
        {content.brandStatement.enabled && (
          <section id='about' className='bg-white scroll-mt-24'>
            {/* ── ROW 1: Statement panel + supporting visual ── */}
            <div className='grid grid-cols-1 lg:grid-cols-12'>
              {/* TEXT BLOCK — dark, type-led, carries the positioning */}
              <Reveal
                variant='fadeUp'
                className='order-2 flex flex-col justify-center bg-[var(--mach-ink)] px-8 py-16 sm:px-12 sm:py-20 lg:order-1 lg:col-span-6 lg:px-16 lg:py-24 xl:px-20'>
                <p className={`${EYEBROW} text-[var(--mach-accent)]`}>
                  <AccentTick dark />
                  Built for the work
                </p>
                <h2 className='mt-6 text-[clamp(2rem,4.2vw,3.5rem)] font-black uppercase leading-[0.95] tracking-[-0.02em] text-white'>
                  {content.brandStatement.title}
                </h2>
                <p className='mt-7 max-w-md text-[15px] leading-[1.8] text-white/60'>
                  {content.brandStatement.description}
                </p>
                {onCtaClick ? (
                  <button
                    type='button'
                    onClick={() => onCtaClick(content.categories.ctaLink || "/shop")}
                    className='mt-10 self-start text-[12px] font-bold uppercase tracking-[0.18em] text-white underline decoration-2 decoration-[var(--mach-accent)] underline-offset-8 transition-colors hover:text-[var(--mach-accent)]'>
                    {content.categories.ctaText || "SHOP ALL"}
                  </button>
                ) : (
                  <a
                    href={content.categories.ctaLink || "/shop"}
                    className='mt-10 self-start text-[12px] font-bold uppercase tracking-[0.18em] text-white underline decoration-2 decoration-[var(--mach-accent)] underline-offset-8 transition-colors hover:text-[var(--mach-accent)]'>
                    {content.categories.ctaText || "SHOP ALL"}
                  </a>
                )}
              </Reveal>

              {/* VISUAL — brand image when supplied, otherwise a typographic
                  panel so the row never renders as an empty grey box. */}
              <Reveal
                variant='clipReveal'
                delay={0.1}
                className='order-1 lg:order-2 lg:col-span-6'>
                <div className='relative aspect-4/3 w-full overflow-hidden bg-[var(--mach-paper-soft)] sm:aspect-16/10 lg:aspect-auto lg:min-h-[70vh]'>
                  {content.brandStatement.image ? (
                    <>
                      {/* Mobile: plain img */}
                      <img
                        src={content.brandStatement.image}
                        alt={content.brandStatement.title}
                        loading='lazy'
                        decoding='async'
                        className='absolute inset-0 h-full w-full object-cover lg:hidden'
                      />
                      {/* Desktop: parallax */}
                      <div className='absolute inset-0 hidden lg:block'>
                        <ParallaxImage
                          src={content.brandStatement.image}
                          alt={content.brandStatement.title}
                          strength={12}
                        />
                      </div>
                    </>
                  ) : (
                    <div className='absolute inset-0 flex flex-col justify-center gap-8 px-8 py-14 sm:px-12 lg:px-16'>
                      {[
                        { k: "01", v: "Transparent labels" },
                        { k: "02", v: "Certified manufacturing" },
                        { k: "03", v: "Trained-on, tested, restocked" },
                      ].map((row) => (
                        <div
                          key={row.k}
                          className='flex items-baseline gap-6 border-b border-[var(--mach-ink)]/10 pb-6'>
                          <span className='text-[11px] font-bold tracking-[0.2em] text-[var(--mach-ink)]/40'>
                            {row.k}
                          </span>
                          <span className='text-[clamp(1.1rem,2.2vw,1.75rem)] font-black uppercase leading-tight tracking-[-0.01em] text-[var(--mach-ink)]'>
                            {row.v}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Noise overlay */}
                  <div
                    aria-hidden='true'
                    className='pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-multiply'
                    style={{
                      backgroundImage: `url("${NOISE_SVG}")`,
                      backgroundSize: "128px 128px",
                    }}
                  />
                </div>
              </Reveal>
            </div>

            {/* ── ROW 2: Category tiles (only once real categories exist) ── */}
            {categories && categories.length >= 2 && (
              <StaggerContainer className='grid grid-cols-1 sm:grid-cols-3'>
                {categories.slice(0, 3).map((cat) => {
                  const catImg = resolveCategoryImage(cat.imageUrl);
                  return (
                    <StaggerItem key={cat.id}>
                      <a
                        href={`/categories/${cat.slug}`}
                        className='group relative block aspect-4/3 w-full overflow-hidden bg-[var(--mach-paper-soft)]'>
                        {catImg ? (
                          <img
                            src={catImg}
                            alt={cat.name}
                            loading='lazy'
                            decoding='async'
                            className='absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]'
                          />
                        ) : (
                          <div className='absolute inset-0 bg-[var(--mach-paper-soft)]' />
                        )}
                        <div className='absolute inset-0 bg-linear-to-t from-black/70 to-transparent' />
                        <p className='absolute bottom-5 left-6 text-[13px] font-bold uppercase tracking-[0.16em] text-white'>
                          {cat.name}
                        </p>
                        <span
                          aria-hidden='true'
                          className='absolute bottom-0 left-0 h-[3px] w-0 bg-[var(--mach-accent)] transition-all duration-500 group-hover:w-full'
                        />
                      </a>
                    </StaggerItem>
                  );
                })}
              </StaggerContainer>
            )}
          </section>
        )}

        {/* ============================================================ */}
        {/*  CATEGORIES                                                  */}
        {/* ============================================================ */}
        {content.categories.enabled && (
          <section
            id='categories'
            className='scroll-mt-24 bg-[var(--mach-paper)] py-20 sm:py-24 lg:py-28'>
            <div className='mx-auto max-w-6xl px-5 sm:px-8 lg:px-10'>
              <Reveal variant='fadeUp'>
                <SectionHead
                  eyebrow='The Range'
                  title={content.categories.title}
                  subtitle={content.categories.subtitle}
                  action={
                    <ViewAllAction
                      label={content.categories.ctaText || "SHOP ALL"}
                      href={content.categories.ctaLink || "/shop"}
                      onCtaClick={onCtaClick}
                    />
                  }
                />
              </Reveal>

              <div className='mt-12 sm:mt-14'>
                {categoriesLoading ? (
                  <div className='space-y-6'>
                    {Array.from({ length: 4 }, (_, i) => (
                      <div key={i} className='flex items-center gap-6'>
                        <Skeleton className='h-20 w-20 shrink-0 rounded-lg sm:h-24 sm:w-24' />
                        <Skeleton className='h-6 w-40 rounded' />
                      </div>
                    ))}
                  </div>
                ) : hasCategories ? (
                  <StaggerContainer className='divide-y divide-[var(--mach-ink)]/10 border-y border-[var(--mach-ink)]/10'>
                    {categories!.map((cat) => {
                      const catImg = resolveCategoryImage(cat.imageUrl);
                      return (
                        <StaggerItem key={cat.id}>
                          <a
                            href={`/categories/${cat.slug}`}
                            className='group -mx-4 flex items-center gap-6 rounded-sm px-4 py-6 transition-colors duration-300 hover:bg-white sm:-mx-5 sm:gap-8 sm:px-5 sm:py-8'>
                            {/* Square thumbnail */}
                            <div className='relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-[var(--mach-paper-soft)] sm:h-24 sm:w-24 lg:h-28 lg:w-28'>
                              {catImg ? (
                                <img
                                  src={catImg}
                                  alt={cat.name}
                                  loading='lazy'
                                  decoding='async'
                                  className='absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]'
                                />
                              ) : (
                                <div className='absolute inset-0 flex items-center justify-center'>
                                  <span className='text-lg font-black uppercase text-[var(--mach-ink)]/25'>
                                    {cat.name.charAt(0)}
                                  </span>
                                </div>
                              )}
                            </div>

                            <div className='flex min-w-0 flex-1 items-center justify-between'>
                              <h3 className='truncate text-xl font-black uppercase tracking-[-0.01em] text-[var(--mach-ink)] transition-colors duration-300 group-hover:text-stone-500 sm:text-2xl lg:text-3xl'>
                                {cat.name}
                              </h3>
                              <span className='ml-6 inline-flex shrink-0 text-[11px] font-bold uppercase tracking-[0.18em] text-stone-400 transition-all duration-300 group-hover:translate-x-1 group-hover:text-[var(--mach-ink)] sm:text-[12px]'>
                                Shop →
                              </span>
                            </div>
                          </a>
                        </StaggerItem>
                      );
                    })}
                  </StaggerContainer>
                ) : (
                  <CatalogEmptyState
                    label='Categories launching soon'
                    note='The Mach range is being loaded in. Check back shortly — or browse everything currently in stock.'
                  />
                )}
              </div>
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/*  NEW ARRIVALS                                                */}
        {/* ============================================================ */}
        {(newArrivalsLoading || (newArrivals && newArrivals.length > 0)) &&
          content.newArrivals?.enabled !== false && (
            <section className='bg-white py-16 sm:py-20 lg:py-24'>
              <div className='mx-auto max-w-6xl px-5 sm:px-8 lg:px-10'>
                <Reveal variant='fadeUp'>
                  <SectionHead
                    eyebrow='Just landed'
                    title={content.newArrivals?.title || "NEW DROPS"}
                    subtitle='The latest additions to the Mach line-up.'
                    action={
                      <ViewAllAction
                        label={content.newArrivals?.viewAllText || "VIEW ALL"}
                        href={withSection(
                          content.newArrivals?.viewAllLink,
                          "newarrivals",
                        )}
                        onCtaClick={onCtaClick}
                      />
                    }
                  />
                </Reveal>
                <div className='mt-10 sm:mt-12'>
                  {newArrivalsLoading ? (
                    <SkeletonTileGrid count={4} />
                  ) : (
                    <StaggerContainer className='grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4'>
                      {newArrivals!.slice(0, 8).map((product) => (
                        <StaggerItem key={product.id}>
                          <EditorialProductTile product={product} />
                        </StaggerItem>
                      ))}
                    </StaggerContainer>
                  )}
                </div>
              </div>
            </section>
          )}

        {/* ============================================================ */}
        {/*  OFFERS / DISCOUNTED                                         */}
        {/* ============================================================ */}
        {content.discountedProducts?.enabled &&
          discountedProducts &&
          discountedProducts.length > 0 && (
            <section className='bg-[var(--mach-ink)] py-16 sm:py-20 lg:py-24'>
              <div className='mx-auto max-w-6xl px-5 sm:px-8 lg:px-10'>
                <Reveal variant='fadeUp'>
                  <SectionHead
                    dark
                    eyebrow='Limited'
                    title={content.discountedProducts.title}
                    action={
                      <a
                        href={withSection(
                          content.discountedProducts.viewAllLink,
                          "offers",
                        )}
                        onClick={
                          onCtaClick
                            ? (e) => {
                                e.preventDefault();
                                onCtaClick(
                                  withSection(
                                    content.discountedProducts!.viewAllLink,
                                    "offers",
                                  ),
                                );
                              }
                            : undefined
                        }
                        className='inline-flex shrink-0 text-[12px] font-bold uppercase tracking-[0.16em] text-white underline decoration-2 decoration-[var(--mach-accent)] underline-offset-8 transition-colors hover:text-[var(--mach-accent)]'>
                        {content.discountedProducts.viewAllText || "VIEW ALL"}
                      </a>
                    }
                  />
                </Reveal>
                <div className='mt-10 rounded-xl bg-[var(--mach-paper)] p-5 sm:mt-12 sm:p-8'>
                  <StaggerContainer className='grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4'>
                    {discountedProducts.map((product) => (
                      <StaggerItem key={product.id}>
                        <EditorialProductTile product={product} />
                      </StaggerItem>
                    ))}
                  </StaggerContainer>
                </div>
              </div>
            </section>
          )}

        {/* ============================================================ */}
        {/*  BEST SELLERS / FEATURED                                     */}
        {/* ============================================================ */}
        {content.featuredProducts.enabled && (
          <section className='bg-[var(--mach-paper)] py-16 sm:py-20 lg:py-24'>
            <div className='mx-auto max-w-6xl px-5 sm:px-8 lg:px-10'>
              <Reveal variant='fadeUp'>
                <SectionHead
                  eyebrow='Most reordered'
                  title={content.featuredProducts.title}
                  subtitle={content.featuredProducts.subtitle}
                  action={
                    <ViewAllAction
                      label={content.featuredProducts.viewAllText || "VIEW ALL"}
                      href={withSection(
                        content.featuredProducts.viewAllLink,
                        "featured",
                      )}
                      onCtaClick={onCtaClick}
                    />
                  }
                />
              </Reveal>
              <div className='mt-10 sm:mt-12'>
                {!featuredProducts ? (
                  <SkeletonTileGrid count={8} />
                ) : hasFeatured ? (
                  <StaggerContainer className='grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4'>
                    {featuredProducts.map((product) => (
                      <StaggerItem key={product.id}>
                        <EditorialProductTile product={product} />
                      </StaggerItem>
                    ))}
                  </StaggerContainer>
                ) : (
                  <CatalogEmptyState
                    label='Products landing soon'
                    note='The first Mach drop is on its way. Join the crew below and you will hear about it first.'
                  />
                )}
              </div>
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/*  VALUE PROPS                                                 */}
        {/* ============================================================ */}
        {content.valueProps.enabled && content.valueProps.items.length > 0 && (
          <section className='bg-white py-14 sm:py-16 lg:py-20'>
            <div className='mx-auto max-w-6xl px-5 sm:px-8 lg:px-10'>
              <StaggerContainer className='grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-[var(--mach-ink)]/10 sm:grid-cols-3'>
                {content.valueProps.items.map((item, idx) => {
                  const IconComp = ICON_MAP[item.icon];
                  return (
                    <StaggerItem key={idx}>
                      <div className='flex h-full flex-col gap-4 bg-white p-7 sm:p-8'>
                        <span className='inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--mach-ink)]'>
                          <IconComp
                            className='h-5 w-5 text-[var(--mach-accent)]'
                            aria-hidden='true'
                          />
                        </span>
                        <div>
                          <p className='text-[13px] font-black uppercase tracking-[0.12em] text-[var(--mach-ink)]'>
                            {item.title}
                          </p>
                          <p className='mt-2 text-sm leading-relaxed text-stone-600'>
                            {item.description}
                          </p>
                        </div>
                      </div>
                    </StaggerItem>
                  );
                })}
              </StaggerContainer>
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/*  NEWSLETTER                                                  */}
        {/* ============================================================ */}
        {content.newsletter.enabled && (
          <section className='bg-[var(--mach-ink)] py-16 text-white sm:py-20 lg:py-24'>
            <div className='mx-auto max-w-6xl px-5 sm:px-8 lg:px-10'>
              <div className='grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-end'>
                <Reveal variant='fadeUp' className='lg:col-span-6'>
                  <p className={`${EYEBROW} text-[var(--mach-accent)]`}>
                    <AccentTick dark />
                    Newsletter
                  </p>
                  <h2 className='mt-4 text-[clamp(1.9rem,4.5vw,3.25rem)] font-black uppercase leading-[0.95] tracking-[-0.015em] text-white'>
                    {content.newsletter.title}
                  </h2>
                  <p className='mt-4 max-w-md text-sm leading-relaxed text-white/60 sm:text-base'>
                    {content.newsletter.subtitle}
                  </p>
                </Reveal>
                <Reveal variant='fadeUp' delay={0.15} className='lg:col-span-6'>
                  {newsletterSubmitted ? (
                    <p className='text-sm font-semibold uppercase tracking-[0.16em] text-[var(--mach-accent)]'>
                      You're in. Welcome to the crew.
                    </p>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        setNewsletterSubmitted(true);
                        setTimeout(() => setNewsletterSubmitted(false), 3000);
                      }}
                      className='flex flex-col gap-3 sm:flex-row'>
                      <Label
                        htmlFor='editorial-newsletter-email'
                        className='sr-only'>
                        Email
                      </Label>
                      <Input
                        id='editorial-newsletter-email'
                        type='email'
                        required
                        placeholder={content.newsletter.placeholderText}
                        className='h-13 flex-1 rounded-none border border-white/20 bg-white/5 text-white placeholder:text-white/35 focus-visible:border-[var(--mach-accent)] focus-visible:ring-0'
                      />
                      <button type='submit' className={CTA_PRIMARY}>
                        {content.newsletter.ctaText}
                      </button>
                    </form>
                  )}
                  {content.newsletter.privacyText && (
                    <p className='mt-4 text-xs leading-relaxed text-white/35'>
                      {content.newsletter.privacyText}
                    </p>
                  )}
                </Reveal>
              </div>
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/*  FOOTER CTA                                                  */}
        {/* ============================================================ */}
        {content.footerCta.enabled && (
          <section className='bg-[var(--mach-accent)] py-16 sm:py-20 lg:py-24'>
            <div className='mx-auto max-w-6xl px-5 sm:px-8 lg:px-10'>
              <Reveal variant='fadeUp'>
                <div className='mx-auto max-w-3xl text-center'>
                  <p className='text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--mach-on-accent)]/60 sm:text-[11px]'>
                    {content.footerCta.subtitle}
                  </p>
                  <h2 className='mt-4 text-[clamp(2rem,5.5vw,4rem)] font-black uppercase leading-[0.92] tracking-[-0.02em] text-[var(--mach-on-accent)]'>
                    {content.footerCta.title}
                  </h2>
                  <div className='mt-9'>
                    {onCtaClick ? (
                      <button
                        type='button'
                        onClick={() => onCtaClick(content.footerCta.ctaLink)}
                        className='inline-flex items-center justify-center bg-[var(--mach-ink)] px-10 py-4 text-[12px] font-bold uppercase tracking-[0.2em] text-white transition-colors duration-300 hover:bg-white hover:text-[var(--mach-ink)]'>
                        {content.footerCta.ctaText}
                      </button>
                    ) : (
                      <a
                        href={content.footerCta.ctaLink}
                        className='inline-flex items-center justify-center bg-[var(--mach-ink)] px-10 py-4 text-[12px] font-bold uppercase tracking-[0.2em] text-white transition-colors duration-300 hover:bg-white hover:text-[var(--mach-ink)]'>
                        {content.footerCta.ctaText}
                      </a>
                    )}
                  </div>
                </div>
              </Reveal>
            </div>
          </section>
        )}
      </div>
    </EditorialChrome>
  );
}

LandingTemplateEditorial.displayName = "LandingTemplateEditorial";
