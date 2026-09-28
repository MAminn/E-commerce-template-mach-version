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
 * one is square and the photo runs edge to edge inside it.
 *
 * The media stage is full-bleed: no inset, no hairline, no hover rule. An
 * inset on a white stage drew a white frame around every photo that is not
 * itself pure white (the grey-ground wraps, lifestyle shots), and the hairline
 * drew a box around that. The pack shots already carry between 4% and 27% of
 * their own whitespace, which is all the breathing room they need. The stage
 * fill only shows where a non-square photo letterboxes.
 *
 * `variant="shop"` is the browsing-grid treatment, used only by the shop and
 * category grid. It is opt-in for exactly this reason: the hover scale, the
 * meta scale and the quick-add placement all differ there, and the homepage
 * shelves must not move when the shop does.
 *
 * `size="lg"` is used by the page's main shelf (Best Sellers). It is not a
 * bigger card — it is a *cleaner* one: the name and price tighten up
 * underneath.
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
 * Fit for the product photo inside the square stage.
 *
 * `contain`, not `cover`: the catalogue mixes square pack shots with tall
 * (0.56:1 tubs, 3:4 straps) and wide (1.41:1 wraps) files, and `cover` would
 * cut the lid and base off a tall tub or the loops off a strap. A square photo
 * — most of them — fills the stage edge to edge either way; the others
 * letterbox onto the stage fill rather than lose packaging. There is no
 * per-product sizing here and there must not be — one fit, every SKU, or the
 * grid stops being a grid.
 */
const MEDIA_FIT = "object-contain";

export interface MachProductCardProps {
  product: MachProduct;
  /** Card sits on a dark section ground. */
  onDark?: boolean;
  /** Larger type and meta, for wide grids and the primary product shelf. */
  size?: "default" | "lg";
  /**
   * Presentation treatment.
   *
   * `"shelf"` is the homepage/product-page card and the default — no existing
   * caller changes behaviour. `"shop"` is the browsing-grid card: quieter
   * hover, a full-width quick-add bar, and meta typography sized to be read in
   * a four-up grid rather than glanced at in a shelf.
   *
   * It is a variant rather than a change to `size="lg"` precisely because
   * `size="lg"` is what the homepage shelves run on.
   */
  variant?: "shelf" | "shop";
}

export const MachProductCard = memo(function MachProductCard({
  product,
  onDark = false,
  size = "default",
  variant = "shelf",
}: MachProductCardProps) {
  const isShop = variant === "shop";
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
  // Stage fill. With the photo full-bleed it is covered entirely by a square
  // shot and only shows where a non-square one letterboxes, so it is chosen to
  // continue the photo, not to frame it: white, because the pack shots are
  // photographed on white and are not cut out. It stays opaque so a section
  // background image never shows through inside the card.
  //
  // On a dark ground the stage is white too, not charcoal — a charcoal band
  // beside a white-ground photo would draw the photo's edge as a box. That now
  // holds at every size and in the shop grid: the storefront is dark by
  // default, so `onDark` only lights the type underneath and never re-tints
  // the photo's stage.
  const stageFill = "bg-white";

  // Restrained on the shop grid: at 1.05 a contained product visibly grows
  // past its own safe area on hover, which reads as a wobble across sixteen
  // tiles at once.
  const hoverZoom = isShop
    ? "group-hover:scale-[1.025]"
    : "group-hover:scale-[1.05]";
  const ringCls = onDark
    ? "focus-visible:ring-white focus-visible:ring-offset-[var(--mach-ink)]"
    : "focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-white";

  return (
    <div className="group relative">
      {/* ── Image frame ── */}
      <div
        className={`relative aspect-square w-full overflow-hidden ${stageFill}`}>
        {img ? (
          <>
            <img
              src={img}
              alt={product.name}
              loading="lazy"
              decoding="async"
              className={`absolute inset-0 h-full w-full ${MEDIA_FIT} transition-[opacity,transform] duration-500 ease-out ${hoverZoom} ${
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
                className={`absolute inset-0 h-full w-full ${MEDIA_FIT} opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100`}
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
          <span
            className={`absolute left-0 top-0 z-20 bg-[var(--mach-ink)] font-bold uppercase text-white ${
              isShop
                ? "px-2.5 py-1 text-[9px] tracking-[0.14em]"
                : "px-3 py-1.5 text-[10px] tracking-[0.18em]"
            }`}>
            -{discountPct}%
          </span>
        )}

        {/* Sold out — full veil so the state is unmissable */}
        {isSoldOut && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
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
          placement={isShop ? "bar" : "corner"}
        />
      </div>

      {/* ── Meta ──
          The shop grid runs its own scale. A shelf's meta is read in passing,
          under a card the shopper is swiping past; a browsing grid's is the
          thing being compared, sixteen at a time, and the shelf sizes are a
          step too small and a step too tight for that. Everything here is
          still the product's own data — only the type changes. */}
      <div className={isShop ? "pt-5 sm:pt-6" : isLarge ? "pt-4" : "pt-5"}>
        {product.categoryName && (
          <p
            className={`font-semibold uppercase ${metaCls} ${
              isShop
                ? "text-[10px] tracking-[0.2em] sm:text-[11px]"
                : "text-[10px] tracking-[0.24em]"
            }`}>
            {product.categoryName}
          </p>
        )}
        {/* Two lines maximum on the main shelf: product names here run long
            enough to push a four-up grid out of alignment, and a name that
            needs a third line is not going to be read on a shelf anyway. */}
        <h3
          className={`font-bold uppercase tracking-[0.03em] ${nameCls} ${
            isShop
              ? "mt-2.5 line-clamp-2 text-[13px] leading-[1.4] sm:text-[15px]"
              : isLarge
                ? "mt-1.5 line-clamp-2 text-[13px] leading-[1.25] sm:text-[14px]"
                : "mt-2 text-[13px] leading-[1.25] sm:text-[15px]"
          }`}>
          {product.name}
        </h3>
        <div
          className={`flex items-baseline ${
            isShop ? "mt-3 gap-2.5" : isLarge ? "mt-2 gap-3" : "mt-3 gap-3"
          }`}>
          {hasDiscount ? (
            <>
              <span
                className={`font-bold ${priceCls} ${
                  isShop
                    ? "text-[14px] sm:text-[16px]"
                    : isLarge
                      ? "text-[14px] sm:text-[15px]"
                      : "text-[14px]"
                }`}>
                {formatPrice(discount)}
              </span>
              <span
                className={`line-through ${metaCls} ${
                  isShop ? "text-[12px] sm:text-[13px]" : "text-[12px]"
                }`}>
                {formatPrice(price)}
              </span>
            </>
          ) : (
            <span
              className={`font-bold ${priceCls} ${
                isShop
                  ? "text-[14px] sm:text-[16px]"
                  : isLarge
                    ? "text-[14px] sm:text-[15px]"
                    : "text-[14px]"
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
