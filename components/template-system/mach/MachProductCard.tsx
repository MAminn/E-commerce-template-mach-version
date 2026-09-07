import { memo } from "react";
import { getProductUrl } from "#root/lib/utils/route-helpers";
import { STORE_CURRENCY } from "#root/shared/config/branding";
import type { FeaturedProduct } from "../home/HomeFeaturedProducts";
import type { NewArrivalProduct } from "#root/components/shop/NewArrivals";
import { normalizeMediaUrl } from "./MachMedia";
import { MachQuickAdd } from "./MachQuickAdd";

/**
 * Mach product card.
 *
 * The editorial card this replaces used a 3:4 portrait crop built for
 * garments; a supplement tub in that frame sits marooned in empty space. This
 * one is square, puts the container at ~88% of the frame, and stands it on a
 * flat ground so the product silhouette carries the card.
 *
 * The frame carries a hairline edge and lifts to a hard black rule on hover:
 * the card has to read as a discrete, clickable object on a white shelf where
 * there is no colour available to separate it from the page.
 *
 * `size="lg"` is used by the page's main shelf (Best Sellers). It is not a
 * bigger card — it is a *cleaner* one: the resting hairline comes off so the
 * product sits on an open stage with no container drawn around it, and the
 * name and price tighten up underneath. Container chrome is what makes a
 * shelf read as a row of boxes instead of a row of products.
 *
 * Destination, price, discount and stock all come from the product system —
 * nothing here is CMS copy.
 *
 * ── Quick add ─────────────────────────────────────────────────────────────
 *
 * The control itself is `MachQuickAdd` — it carries the option-state
 * decision, the cart mutation and the confirmation, so Stacks & Bundles
 * (which composes its own panels and does not render this card) gets exactly
 * the same behaviour from the same code. See that file for the rules.
 *
 * What this card owes it is the structure it needs: the media stage is the
 * positioned ancestor it anchors to, and the card is a *stretched link*
 * rather than an `<a>` wrapper — the whole tile stays clickable through an
 * absolutely-positioned anchor at `z-10`, and the quick-add is a sibling that
 * paints above it at `z-20`. Nesting a button (or, for the options case, a
 * second link) inside an `<a>` is invalid and does not survive hydration;
 * stacking them side by side is what keeps both targets honest.
 */

export type MachProduct = FeaturedProduct | NewArrivalProduct;

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

/** Second shot, revealed on hover where the product has one. */
function resolveSecondaryImage(product: MachProduct): string | null {
  if (!product.images || product.images.length < 2) return null;
  const primaryIdx = product.images.findIndex((i) => i.isPrimary);
  const secondIdx = primaryIdx >= 0 ? (primaryIdx === 0 ? 1 : 0) : 1;
  const url = product.images[secondIdx]?.url;
  return url ? normalizeMediaUrl(url) : null;
}

/**
 * Padding inside the media stage, identical at both card sizes.
 *
 * A product must not change scale between the Best Sellers shelf and the Gym
 * Gear shelf, and the pack shots already carry between 4% and 27% of their own
 * whitespace — the stage should not compound that further than it has to. One
 * small, predictable inset, applied to every card on every shelf.
 */
const STAGE_PAD = "p-[4%]";

export interface MachProductCardProps {
  product: MachProduct;
  /** Card sits on a dark section ground. */
  onDark?: boolean;
  /** Larger type and meta, for wide grids and the primary product shelf. */
  size?: "default" | "lg";
}

export const MachProductCard = memo(function MachProductCard({
  product,
  onDark = false,
  size = "default",
}: MachProductCardProps) {
  const isLarge = size === "lg";
  const img = resolveImage(product);
  const secondaryImg = resolveSecondaryImage(product);
  const href = getProductUrl(product);

  const price = safePrice(product.price) ?? 0;
  const discount = safePrice(product.discountPrice);
  const hasDiscount = discount != null && discount < price;
  const isSoldOut = !product.available || product.stock <= 0;
  const discountPct =
    hasDiscount && price > 0
      ? Math.round(((price - discount) / price) * 100)
      : 0;

  const nameCls = onDark ? "text-white" : "text-[var(--mach-ink)]";
  const metaCls = onDark ? "text-white/45" : "text-[var(--mach-mute)]";
  const priceCls = onDark ? "text-white" : "text-[var(--mach-ink)]";
  // White on light grounds, not paper-grey. Supplement pack shots are cut out
  // on white, so a grey frame draws a hard rectangle around the photo's own
  // background instead of around the product. The hairline does the separating,
  // and the card still reads as a tile because the section behind it is paper.
  // The dense shelves rest with no visible edge and draw one on hover; the
  // legacy rows keep their permanent hairline, which is what separates a card
  // from the page when four of them sit in a tight grid.
  //
  // On a dark ground the dense stage is *white*, not charcoal. Supplement pack
  // shots are photographed on white and are not cut out, so a charcoal stage
  // renders every product as a bright white rectangle floating inside a dark
  // card — the picture's own background becomes the visible shape. Standing
  // the shot on a white tile instead makes the ink section the frame and the
  // product the content, which is what the light shelves already do.
  const darkDenseStage = onDark && isLarge;
  const restingRing = isLarge
    ? "ring-transparent"
    : onDark
      ? "ring-white/10"
      : "ring-[var(--mach-ink)]/12";
  const frameCls = darkDenseStage
    ? `bg-white ring-1 ring-inset ${restingRing} group-hover:ring-[var(--mach-ink)]/25`
    : onDark
      ? `bg-[var(--mach-ink-raised)] ring-1 ring-inset ${restingRing} group-hover:ring-white/40`
      : `bg-white ring-1 ring-inset ${restingRing} group-hover:ring-[var(--mach-ink)]`;
  const ringCls = onDark
    ? "focus-visible:ring-white focus-visible:ring-offset-[var(--mach-ink)]"
    : "focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-white";

  // The quick-add is black-on-white everywhere the stage is white. The one
  // stage that isn't — a legacy non-dense card on an ink ground — inverts it,
  // or a black button on charcoal would disappear.
  const onCharcoalStage = onDark && !isLarge;

  return (
    <div className="group relative">
      {/* ── Image frame ── */}
      <div
        className={`relative aspect-square w-full overflow-hidden transition-[box-shadow] duration-300 ${frameCls}`}>
        {img ? (
          <>
            <img
              src={img}
              alt={product.name}
              loading="lazy"
              decoding="async"
              className={`absolute inset-0 h-full w-full object-contain ${STAGE_PAD} transition-[opacity,transform] duration-500 ease-out group-hover:scale-[1.05] ${
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
                className={`absolute inset-0 h-full w-full object-contain ${STAGE_PAD} opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100`}
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

        {/* Discount flag — hard-edged block, no colour */}
        {hasDiscount && !isSoldOut && (
          <span className="absolute left-0 top-0 z-20 bg-[var(--mach-ink)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
            -{discountPct}%
          </span>
        )}

        {/* Sold out — full veil so the state is unmissable */}
        {isSoldOut && (
          <div
            className={`absolute inset-0 z-20 flex items-center justify-center backdrop-blur-[1px] ${
              onDark && !darkDenseStage ? "bg-black/60" : "bg-white/70"
            }`}>
            <span className="bg-[var(--mach-ink)] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white">
              Sold out
            </span>
          </div>
        )}

        {/* ── Quick add ──
            Anchors to this stage and paints above the stretched product link
            (z-20 over z-10), so a press here adds to the bag instead of
            navigating. Renders nothing when sold out or when the product's
            option state is unknown. */}
        <MachQuickAdd
          product={product}
          href={href}
          imageUrl={img}
          onCharcoal={onCharcoalStage}
        />
      </div>

      {/* ── Meta ── */}
      <div className={isLarge ? "pt-4" : "pt-5"}>
        {product.categoryName && (
          <p
            className={`text-[10px] font-semibold uppercase tracking-[0.24em] ${metaCls}`}>
            {product.categoryName}
          </p>
        )}
        {/* Two lines maximum on the main shelf: product names here run long
            enough to push a four-up grid out of alignment, and a name that
            needs a third line is not going to be read on a shelf anyway. */}
        <h3
          className={`font-bold uppercase leading-[1.25] tracking-[0.03em] ${nameCls} ${
            isLarge
              ? "mt-1.5 line-clamp-2 text-[13px] sm:text-[14px]"
              : "mt-2 text-[13px] sm:text-[15px]"
          }`}>
          {product.name}
        </h3>
        <div
          className={`flex items-baseline gap-3 ${isLarge ? "mt-2" : "mt-3"}`}>
          {hasDiscount ? (
            <>
              <span
                className={`font-bold ${priceCls} ${
                  isLarge ? "text-[14px] sm:text-[15px]" : "text-[14px]"
                }`}>
                {formatPrice(discount)}
              </span>
              <span className={`text-[12px] line-through ${metaCls}`}>
                {formatPrice(price)}
              </span>
            </>
          ) : (
            <span
              className={`font-bold ${priceCls} ${
                isLarge ? "text-[14px] sm:text-[15px]" : "text-[14px]"
              }`}>
              {formatPrice(price)}
            </span>
          )}
        </div>
      </div>

      {/* ── Product link ──
          Covers the whole tile, media and meta alike, so the card is as
          clickable as it was when it *was* an anchor. Rendered last so it
          reads after the product's own content in the accessibility tree. */}
      <a
        href={href}
        className={`absolute inset-0 z-10 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${ringCls}`}>
        <span className="sr-only">{product.name}</span>
      </a>
    </div>
  );
});
