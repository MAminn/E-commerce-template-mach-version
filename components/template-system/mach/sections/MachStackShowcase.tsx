import { Link } from "#root/components/utils/Link";
import { getProductUrl } from "#root/lib/utils/route-helpers";
import { STORE_CURRENCY } from "#root/shared/config/branding";
import { isPlaceholderLink } from "#root/shared/types/layout-settings";
import { StaggerContainer, StaggerItem } from "../../motion/Stagger";
import { normalizeMediaUrl } from "../MachMedia";
import type { MachProduct } from "../MachProductCard";
import { MachQuickAdd } from "../MachQuickAdd";
import type { MachRowGround } from "./MachProductRow";
import { HEADING_FEATURE, LINK_ACTION } from "../machTokens";

/**
 * Stacks & Bundles — the page's feature merchandising block.
 *
 * Every other product section on this page is a *row*: four equal cards on a
 * shelf, sized on the assumption that a catalogue keeps arriving. Stacks is
 * not that. A store carries two or three bundles, deliberately, and dropping
 * two catalogue cards into a four-column grid reads as a section that failed
 * to load rather than as a curated pair. So this section is built the other
 * way round — it takes the count it is given and composes for it:
 *
 *   1 product    one wide panel, media beside copy
 *   2 products   a 52/48 pair — the first bundle leads, only just
 *   3 products   equal thirds
 *   4+           two-up, so panels stay large instead of shrinking to fit
 *
 * **Prominent, not oversized.** This block earns a wider measure and larger
 * pack shots than the shelves below it, and nothing more. The earlier
 * treatment ran a 440–720px media stage, which turned two bundles into two
 * full-viewport editorial cards and pushed New Drops off the bottom of the
 * screen. The reference stores do the opposite: their merchandising tiles are
 * visual-first and full-width but *short*, so the imagery lands and the next
 * block arrives immediately. The stage is capped at 400px now, with compact
 * type under it — the panel is still the biggest product object on the page,
 * it just no longer owns a whole scroll.
 *
 * **Neutral shell, full-colour product.** The card, the rules, the type and
 * the action are black, white and grey; the packaging supplies every bit of
 * colour in the section. Products are laid `object-contain` on a white stage
 * with a soft neutral light pool under them — never cropped, never
 * desaturated, never tinted. A pack shot is product information, and half of
 * that information is the colour of the label.
 *
 * **Same purchase action as the shelves.** A bundle is the most expensive
 * thing on the page and was the only merchandising block a shopper could not
 * buy from directly, purely because this section composes its own panels
 * instead of rendering `MachProductCard`. It now mounts `MachQuickAdd` — the
 * same component the shelf cards mount, carrying the same option-state rules,
 * the same cart call and the same confirmation. There is no second
 * implementation of the add behaviour, and the panel's composition, stage
 * height, type and price block are unchanged.
 *
 * Nothing here is authored copy. Title, subtitle and the trailing action come
 * from the homepage CMS; name, category, price, discount, stock and
 * destination come from the product system.
 */

/* ------------------------------------------------------------------ */
/*  Product helpers                                                   */
/* ------------------------------------------------------------------ */

function safePrice(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

function formatPrice(v: number): string {
  return `${STORE_CURRENCY} ${v.toFixed(2)}`;
}

function resolveImage(product: MachProduct): string | null {
  const primary = product.images?.find((i) => i.isPrimary);
  if (primary?.url) return normalizeMediaUrl(primary.url);
  if (product.images?.[0]?.url) return normalizeMediaUrl(product.images[0].url);
  if (product.imageUrl) return normalizeMediaUrl(product.imageUrl);
  return null;
}

/** Second shot, cross-faded on hover where the product has one. */
function resolveSecondaryImage(product: MachProduct): string | null {
  if (!product.images || product.images.length < 2) return null;
  const primaryIdx = product.images.findIndex((i) => i.isPrimary);
  const secondIdx = primaryIdx >= 0 ? (primaryIdx === 0 ? 1 : 0) : 1;
  const url = product.images[secondIdx]?.url;
  return url ? normalizeMediaUrl(url) : null;
}

/* ------------------------------------------------------------------ */
/*  Grounds                                                           */
/* ------------------------------------------------------------------ */

/**
 * This section's own measure.
 *
 * Wider than `SHELL` and on a tighter gutter than `GUTTER`, deliberately: the
 * product rows below are a container of thumbnails, and a feature block held
 * to the same width reads as one of them. Width is now the *only* axis on
 * which this section outranks them — its height is ordinary.
 */
const STACK_SHELL = "mx-auto w-full max-w-[1920px]";
const STACK_GUTTER = "px-5 sm:px-8 lg:px-10 xl:px-12";

const SECTION_GROUND: Record<MachRowGround, string> = {
  white: "bg-white text-[var(--mach-ink)]",
  paper: "bg-[var(--mach-paper)] text-[var(--mach-ink)]",
  ink: "bg-[var(--mach-ink)] text-white",
};

/**
 * How wide each panel runs, decided by how many there are.
 *
 * Two is the case this section exists for: 52/48 rather than 50/50, because a
 * dead-even pair reads as a two-column grid and a leading panel reads as a
 * decision. The offset is deliberately slight — at the previous 55/45 the
 * pair read as a feature and a leftover.
 */
function columnsFor(count: number): string {
  if (count <= 1) return "lg:grid-cols-1";
  if (count === 2) return "lg:grid-cols-[52fr_48fr]";
  if (count === 3) return "lg:grid-cols-3";
  return "lg:grid-cols-2";
}

/* ------------------------------------------------------------------ */
/*  Panel                                                             */
/* ------------------------------------------------------------------ */

function StackPanel({
  product,
  isDark,
  solo,
}: {
  product: MachProduct;
  isDark: boolean;
  /** The one-product arrangement puts media and copy side by side. */
  solo: boolean;
}) {
  const img = resolveImage(product);
  const secondaryImg = resolveSecondaryImage(product);

  const price = safePrice(product.price) ?? 0;
  const discount = safePrice(product.discountPrice);
  const hasDiscount = discount != null && discount < price;
  const isSoldOut = !product.available || product.stock <= 0;
  const discountPct =
    hasDiscount && price > 0
      ? Math.round(((price - discount) / price) * 100)
      : 0;

  const cardCls = isDark
    ? "bg-[var(--mach-ink-raised)] ring-white/10 hover:ring-white/45"
    : "bg-white ring-[var(--mach-ink)]/12 hover:ring-[var(--mach-ink)]";
  const ruleCls = isDark ? "border-white/12" : "border-[var(--mach-ink)]/12";
  const nameCls = isDark ? "text-white" : "text-[var(--mach-ink)]";
  const metaCls = isDark ? "text-white/45" : "text-[var(--mach-mute)]";
  const focusCls = isDark
    ? "focus-visible:ring-white focus-visible:ring-offset-[var(--mach-ink)]"
    : "focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-[var(--mach-paper)]";

  const href = getProductUrl(product);

  return (
    // A *stretched link*, not an `<a>` wrapper. The quick-add inside the stage
    // is a button (and, for a product with option groups, a second anchor),
    // neither of which may be nested inside an anchor — that markup is invalid
    // and does not survive hydration. The panel's own classes are unchanged;
    // the destination simply moved to an overlay that covers the same box, so
    // the composition renders identically.
    <div
      className={`group relative flex h-full w-full flex-col ring-1 ring-inset transition-[box-shadow] duration-300 ${cardCls} ${
        solo ? "lg:flex-row" : ""
      }`}>
      {/* ── Product stage ──
          One height across every panel so an asymmetric pair still lines up
          along the product baseline. Short on purpose: 4:3 on a phone and a
          400px ceiling on desktop keep the pack shot large enough to read
          without letting one bundle occupy the viewport. */}
      <div
        className={`relative aspect-[4/3] w-full shrink-0 overflow-hidden sm:aspect-[16/10] lg:aspect-auto lg:h-[clamp(280px,22vw,400px)] ${
          solo ? "lg:w-[52%]" : ""
        }`}>
        {/* Light pool. Gives the pack shot a floor to stand on without
            introducing a hue — the only shading in the section is neutral. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background: isDark
              ? "radial-gradient(54% 48% at 50% 58%, rgba(255,255,255,0.10), rgba(255,255,255,0.03) 56%, transparent 78%)"
              : "radial-gradient(54% 48% at 50% 58%, rgba(0,0,0,0.07), rgba(0,0,0,0.02) 56%, transparent 78%)",
          }}
        />

        {img ? (
          <>
            <img
              src={img}
              alt={product.name}
              loading="lazy"
              decoding="async"
              className={`absolute inset-0 h-full w-full object-contain p-[3%] transition-[opacity,transform] duration-700 ease-out group-hover:scale-[1.04] ${
                secondaryImg ? "group-hover:opacity-0" : ""
              }`}
            />
            {secondaryImg && (
              <img
                src={secondaryImg}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-contain p-[3%] opacity-0 transition-opacity duration-700 ease-out group-hover:opacity-100"
              />
            )}
          </>
        ) : (
          <div
            aria-hidden="true"
            className={`absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-[0.28em] ${metaCls}`}>
            No image
          </div>
        )}

        {/* Discount — a hard black block, never a coloured badge. */}
        {hasDiscount && !isSoldOut && (
          <span className="absolute left-0 top-0 z-20 bg-[var(--mach-ink)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
            -{discountPct}%
          </span>
        )}

        {isSoldOut && (
          <div
            className={`absolute inset-0 z-20 flex items-center justify-center backdrop-blur-[1px] ${
              isDark ? "bg-black/60" : "bg-white/72"
            }`}>
            <span className="bg-[var(--mach-ink)] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white">
              Sold out
            </span>
          </div>
        )}

        {/* ── Quick add ──
            The same control the shelf cards mount, anchored to this stage and
            painting above the overlay link (z-20 over z-10) so a press here
            adds to the bag instead of opening the product. Absolutely
            positioned, so it adds no height to the panel. */}
        <MachQuickAdd
          product={product}
          href={href}
          imageUrl={img}
          onCharcoal={isDark}
        />
      </div>

      {/* ── Product meta ──
          Category, name and price stacked tight. There is no action square
          any more: the whole panel is the link, and a 64px arrow button was
          buying height to say what the hover ring already says. */}
      <div
        className={`flex flex-1 flex-col border-t px-5 pb-4 pt-3.5 sm:px-6 sm:pb-5 sm:pt-4 ${ruleCls} ${
          solo ? "lg:justify-center lg:border-l lg:border-t-0 lg:px-10" : ""
        }`}>
        {product.categoryName && (
          <p
            className={`text-[10px] font-semibold uppercase tracking-[0.24em] ${metaCls}`}>
            {product.categoryName}
          </p>
        )}

        {/* Two lines maximum, same rule as the shelf cards: a bundle name
            that runs to three lines pushes the pair out of alignment and is
            not being read at this size anyway. */}
        <h3
          className={`mt-1.5 line-clamp-2 font-black uppercase leading-[1.08] tracking-[-0.015em] text-[clamp(1rem,1.2vw,1.3rem)] ${nameCls}`}>
          {product.name}
        </h3>

        {/* One price line, payable price first — it is the number that has to
            read, and the struck original sits beside it rather than above. */}
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            className={`font-black leading-none tracking-[-0.02em] text-[clamp(1.05rem,1.2vw,1.35rem)] ${nameCls}`}>
            {formatPrice(hasDiscount ? (discount as number) : price)}
          </span>
          {hasDiscount && (
            <span
              className={`text-[12px] font-semibold uppercase tracking-[0.12em] line-through ${metaCls}`}>
              {formatPrice(price)}
            </span>
          )}
        </div>
      </div>

      {/* ── Product link ──
          Covers the whole panel, media and meta alike, so everything except
          the quick-add opens the product exactly as it did when the panel
          *was* an anchor. Rendered last so it reads after the product's own
          content in the accessibility tree, and it carries the focus ring the
          root used to. */}
      <a
        href={href}
        className={`absolute inset-0 z-10 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${focusCls}`}>
        <span className="sr-only">{product.name}</span>
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section                                                           */
/* ------------------------------------------------------------------ */

export function MachStackShowcase({
  id,
  title,
  subtitle,
  actionLabel,
  actionHref,
  products,
  isLoading = false,
  ground = "paper",
}: {
  id?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionHref?: string;
  products: MachProduct[];
  isLoading?: boolean;
  ground?: MachRowGround;
}) {
  // Nothing to merchandise, and nothing rendered — an empty bordered box in a
  // merchandising slot reads as broken, not as "coming soon".
  if (isLoading || products.length === 0) return null;

  const isDark = ground === "ink";
  const showAction =
    Boolean(actionLabel?.trim()) && !isPlaceholderLink(actionHref);
  const solo = products.length === 1;

  const headingCls = isDark ? "text-white" : "text-[var(--mach-ink)]";
  const subtitleCls = isDark ? "text-white/55" : "text-[var(--mach-mute)]";
  const actionCls = isDark ? "text-white" : "text-[var(--mach-ink)]";

  return (
    <section
      id={id}
      className={`${SECTION_GROUND[ground]} scroll-mt-24 ${
        isDark ? "" : "border-t border-[var(--mach-ink)]/10"
      }`}>
      {/* Wider than the product rows below it, and on a tighter gutter. The
          feature block out-measures the shelves horizontally; it no longer
          out-measures them vertically. */}
      <div className={`${STACK_SHELL} ${STACK_GUTTER} py-10 sm:py-12 lg:py-14`}>
        {/* ── Header ──
            The same shape as every other section head on the page — title
            left, action right, on one baseline — one size down from the
            shelves and well clear of the hero. This used to open with its own
            rule, a tick, an 18px subtitle and a solid CTA block: four devices
            to introduce two products is a header competing with its content. */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
          <div className="min-w-0">
            <h2 className={`${HEADING_FEATURE} ${headingCls}`}>{title}</h2>
            {subtitle && (
              <p
                className={`mt-3 max-w-xl text-[14px] leading-relaxed sm:text-[15px] ${subtitleCls}`}>
                {subtitle}
              </p>
            )}
          </div>

          {showAction && (
            <Link
              href={actionHref as string}
              className={`${LINK_ACTION} ${actionCls} shrink-0 self-start border-b-2 pb-1 sm:self-auto ${
                isDark ? "border-white" : "border-[var(--mach-ink)]"
              }`}>
              {actionLabel}
            </Link>
          )}
        </div>

        {/* ── Panels ──
            Phones get the same edge-to-edge snap shelf the product rows use
            rather than a stack of full-width panels: two bundles stacked is
            two screens of scrolling before New Drops, where a shelf puts the
            second bundle a thumb-flick away and lets the next section start
            almost immediately. A single bundle has nothing to swipe to, so it
            stays a full-width block. */}
        <StaggerContainer
          className={`mt-7 lg:mt-8 ${
            solo
              ? "grid grid-cols-1"
              : "-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8 lg:mx-0 lg:grid lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0"
          } ${columnsFor(products.length)}`}
          amount={0.1}>
          {products.map((product) => (
            <StaggerItem
              key={product.id}
              className={
                solo
                  ? "flex"
                  : "flex w-[74vw] shrink-0 snap-start sm:w-[58vw] md:w-[46vw] lg:w-auto lg:shrink"
              }>
              <StackPanel product={product} isDark={isDark} solo={solo} />
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}
