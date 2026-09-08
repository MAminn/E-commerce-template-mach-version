import React, { useState, useMemo, useEffect, useRef } from "react";
import { Button } from "#root/components/ui/button";
import { VariantSelector } from "#root/components/shop/VariantSelector";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "#root/components/ui/dialog";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "#root/components/ui/accordion";
import type {
  ProductPageProduct,
  ProductImage,
} from "./ProductPageModernSplit";
import type { FeaturedProduct } from "../home/HomeFeaturedProducts";
import {
  Heart,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Truck,
  Shield,
  RotateCcw,
  ArrowRight,
} from "lucide-react";
import { MachChrome } from "../mach/MachChrome";
import { MachProductCard } from "../mach/MachProductCard";
import { showMachCartToast } from "../mach/MachCartFeedback";
import { GUTTER, HEADING_SHELF, LINK_ACTION, SHELL } from "../mach/machTokens";
import { STORE_CURRENCY } from "#root/shared/config/branding";
import { Reveal } from "../motion/Reveal";
import { SupplementDetailsPanel } from "../mach/product/SupplementFactsPanel";
import { ProductCrossSellStrip } from "../mach/product/ProductCrossSellStrip";
import {
  ProductRatingSummary,
  ProductReviewsSection,
  type ProductReviewItem,
} from "../mach/product/ProductReviews";
import { StaggerContainer, StaggerItem } from "../motion/Stagger";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

/**
 * Store-wide, client-editable product-page copy. Supplied by the route from
 * `store_settings.product_page_content` so no visible string on this page is
 * hard-coded here. Every field is optional: an unset heading falls back to the
 * section's structural label, and unset shipping/returns text hides that
 * accordion entirely rather than inventing prose for it.
 */
export interface ProductPageEditorialContent {
  shippingText?: string;
  returnsText?: string;
  crossSellHeading?: string;
  relatedProductsHeading?: string;
  detailsSectionHeading?: string;
  shippingSectionHeading?: string;
}

export interface ProductPageEditorialProps {
  product?: ProductPageProduct;
  relatedProducts?: FeaturedProduct[];
  /** Curated add-ons, already resolved to live products by the backend. */
  crossSellProducts?: FeaturedProduct[];
  /** Approved reviews from the existing reviews service. */
  reviews?: ProductReviewItem[];
  /** CMS-controlled page copy. */
  content?: ProductPageEditorialContent;
  showWishlist?: boolean;
  showSocialShare?: boolean;
  /**
   * Adds to the existing cart. Returns false when the cart refused the
   * request (stock), so this page can confirm only a real add — anything
   * returning void is treated as accepted, which is the legacy behaviour.
   */
  onAddToCart?: (
    product: ProductPageProduct,
    selectedOptions?: Record<string, string>,
    quantity?: number,
  ) => boolean | void;
  /** Adds to the cart then continues to the existing checkout flow. */
  onBuyNow?: (
    product: ProductPageProduct,
    selectedOptions?: Record<string, string>,
    quantity?: number,
  ) => void;
  onAddToWishlist?: (product: ProductPageProduct) => void;
  onImageClick?: (imageUrl: string, index: number) => void;
  /**
   * The owner is still resolving the product.
   *
   * The route has always computed this; the template simply never declared it,
   * so a page whose product arrives from a client-side fetch had no way to say
   * "nothing yet" and fell through to a hard-coded demo product instead. See
   * the note on the skeleton below.
   */
  isLoading?: boolean;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatPrice(v: number): string {
  return `${STORE_CURRENCY} ${v.toFixed(2)}`;
}

/**
 * Opening rule for a below-hero section.
 *
 * Carried by each section rather than by the container around them, because
 * every one of those sections can render nothing at all — putting the rule on
 * the container draws a line above whatever is left, including above nothing.
 */
const SECTION_RULE = "border-t border-[var(--mach-ink)]/12 pt-12 lg:pt-14";

/**
 * Column count for the related-products shelf, chosen from what the catalogue
 * actually returned.
 *
 * A fixed four-column grid is only right when there are four products in it.
 * With one — which is the normal state for a small category such as Stacks &
 * Bundles — it leaves three empty columns and a card stranded in the corner of
 * a full-bleed section. Constraining the track instead keeps a short shelf
 * reading as a deliberately short shelf.
 */
function relatedGridClasses(count: number): string {
  // The single card keeps a shelf card's real width instead of stretching to
  // whatever the track gives it — a related product must not read as a bigger
  // class of object than the four it would sit beside on a full shelf. On a
  // phone it is held under the full width for the same reason.
  if (count <= 1) return "grid-cols-1 max-w-[280px] sm:max-w-[340px]";
  if (count === 2) return "grid-cols-2 sm:max-w-[720px]";
  if (count === 3) return "grid-cols-2 md:grid-cols-3 md:max-w-[1120px]";
  return "grid-cols-2 lg:grid-cols-4";
}

/**
 * Desktop measure for the whole related block — heading, Shop All and cards.
 *
 * Constraining only the grid is what produced the stranded-card composition:
 * a full-bleed heading with Shop All pinned 1400px away, and one card in the
 * corner underneath. The heading is not a page header, it is the title of this
 * shelf, so it takes the shelf's width. With one product that is a narrow
 * editorial column; with four it is the full container and nothing changes.
 *
 * Desktop only. A phone is already narrower than every measure here.
 */
function relatedBlockClasses(count: number): string {
  if (count <= 1) return "lg:max-w-[560px]";
  if (count === 2) return "lg:max-w-[760px]";
  if (count === 3) return "lg:max-w-[1160px]";
  return "";
}

/* ------------------------------------------------------------------ */
/*  Loading state                                                     */
/* ------------------------------------------------------------------ */

/** Neutral placeholder bar. Hard-edged and monochrome, like everything else. */
function Bar({ className = "" }: { className?: string }) {
  return <div className={`bg-[var(--mach-ink)]/[0.07] ${className}`} />;
}

/**
 * The PDP before the product exists.
 *
 * This page's product arrives from a client-side fetch, so the first paint —
 * server-rendered and again on hydration — happens with nothing to show. The
 * template used to fill that gap with a hard-coded demo garment, which meant
 * every visitor was served a real-looking product that was not the one they
 * asked for, complete with title, price, photography and a working Add to Bag.
 *
 * A skeleton is the honest answer: it holds the approved hero's geometry so
 * the page does not jump when the product lands, and it states nothing. There
 * is no title, price, image, description, rating or stock here, because none
 * of those are known yet.
 *
 * Only the hero is drawn. Everything below it — details, add-ons, reviews,
 * related products — is conditional on data the page does not have, and
 * reserving space for sections that may never render would produce a jump of
 * its own. The sticky purchase bar is deliberately absent: a fixed Add to Bag
 * for an unknown product is exactly the failure this replaces.
 */
function ProductPageSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      role='status'
      aria-busy='true'
      aria-live='polite'
      className={`product-page-mach min-h-screen animate-pulse bg-white ${className}`}>
      <span className='sr-only'>Loading product</span>

      <div className={`${SHELL} ${GUTTER} pb-14 pt-5 lg:pb-20 lg:pt-6`}>
        {/* Breadcrumb */}
        <Bar className='mb-6 h-2.5 w-40 lg:mb-8' />

        {/* Same 7/5 split, same gaps, same square stage as the real hero. */}
        <div className='grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10 xl:gap-14'>
          <div className='lg:col-span-7'>
            <div className='aspect-square w-full bg-[var(--mach-paper-soft)] ring-1 ring-inset ring-[var(--mach-ink)]/12' />
          </div>

          <div className='lg:col-span-5'>
            {/* Eyebrow */}
            <Bar className='h-2.5 w-24' />
            {/* Title — two lines, matching the h1's block */}
            <Bar className='mt-4 h-7 w-full max-w-[22rem]' />
            <Bar className='mt-2.5 h-7 w-3/5 max-w-[16rem]' />
            {/* Price */}
            <Bar className='mt-6 h-8 w-36' />
            {/* Short description */}
            <div className='mt-6 space-y-2.5'>
              <Bar className='h-3 w-full' />
              <Bar className='h-3 w-11/12' />
              <Bar className='h-3 w-3/4' />
            </div>

            <div className='mt-7 h-px w-full bg-[var(--mach-ink)]/12' />

            {/* Quantity row */}
            <div className='mt-7 flex items-center gap-4'>
              <Bar className='h-2.5 w-16' />
              <Bar className='h-11 w-[132px]' />
            </div>

            {/* Add to Bag + wishlist, then Buy It Now */}
            <div className='mt-4 flex items-stretch gap-3'>
              <Bar className='h-[52px] flex-1' />
              <Bar className='h-[52px] w-[52px] shrink-0' />
            </div>
            <Bar className='mt-3 h-[52px] w-full' />

            {/* Trust strip */}
            <div className='mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--mach-ink)]/12 pt-5'>
              <Bar className='h-2.5 w-20' />
              <Bar className='h-2.5 w-24' />
              <Bar className='h-2.5 w-20' />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */

/**
 * Mach product page.
 *
 * Split in two so the loading state can exist at all. Everything below holds
 * hooks keyed to a real product — image index, quantity, the add-to-bag
 * confirmation timer, the sticky-bar observer — and hooks cannot sit behind an
 * early return. Gating here instead means the resolved page mounts only once
 * there is a product, which also gives each product a clean slate on a
 * client-side navigation between two PDPs.
 */
export function ProductPageEditorial(props: ProductPageEditorialProps) {
  const { product, isLoading = false, className = "" } = props;

  // No product is not a state this page can render. It is either still coming
  // (the route's own `isLoading`) or the caller supplied none — and in both
  // cases the honest output is the skeleton, never invented merchandise.
  if (isLoading || !product) {
    return (
      <MachChrome>
        <ProductPageSkeleton className={className} />
      </MachChrome>
    );
  }

  return <ProductPageEditorialResolved {...props} product={product} />;
}

function ProductPageEditorialResolved({
  product,
  relatedProducts,
  crossSellProducts,
  reviews,
  content,
  showWishlist = true,
  onAddToCart,
  onBuyNow,
  onAddToWishlist,
  className = "",
}: ProductPageEditorialProps & { product: ProductPageProduct }) {
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);

  const images: ProductImage[] = useMemo(() => {
    if (product.images && product.images.length > 0) return product.images;
    if (product.imageUrl) return [{ url: product.imageUrl, isPrimary: true }];
    return [];
  }, [product.images, product.imageUrl]);

  // Most of this catalogue ships one pack shot per product. Gallery chrome —
  // the thumbnail rail, the arrows, the lightbox counter — is drawn only when
  // there is genuinely something to move between, so a single-image product
  // gets a clean stage instead of controls that do nothing.
  const hasGallery = images.length > 1;

  const currentImage = images[selectedImageIndex] ?? images[0];

  const hasDiscount =
    product.discountPrice != null &&
    typeof product.discountPrice === "number" &&
    product.discountPrice < product.price;

  const isSoldOut = !product.available || product.stock <= 0;

  // Shipping and returns copy is owned by the client in store settings. Both
  // parts are optional; whatever is set is shown, and if neither is set the
  // section disappears rather than falling back to inherited template prose.
  const shippingReturnsParts = [content?.shippingText, content?.returnsText]
    .map((t) => t?.trim())
    .filter((t): t is string => Boolean(t));

  const [selectedVariants, setSelectedVariants] = useState<
    Record<string, string>
  >({});

  const allVariantsSelected =
    !product.variants?.length ||
    product.variants.every((v) => selectedVariants[v.name]);

  /**
   * Add-to-bag feedback on the Mach product page.
   *
   * The button confirms in place and the monochrome Mach toast names what went
   * in; the navbar bag count was already live. Same handler, same cart, same
   * stock rules as every other add-to-cart surface in the storefront.
   */
  const [justAdded, setJustAdded] = useState(false);
  const addedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (addedTimer.current) window.clearTimeout(addedTimer.current);
    },
    [],
  );

  const handleAddToCart = () => {
    if (!onAddToCart || isSoldOut || !allVariantsSelected) return;

    const accepted = onAddToCart(product, selectedVariants, quantity);
    if (accepted === false) return;

    const unitPrice = hasDiscount
      ? Number(product.discountPrice)
      : Number(product.price);

    showMachCartToast({
      name: product.name,
      price: unitPrice,
      quantity,
      imageUrl: currentImage?.url ?? product.imageUrl,
    });

    setJustAdded(true);
    if (addedTimer.current) window.clearTimeout(addedTimer.current);
    addedTimer.current = window.setTimeout(() => setJustAdded(false), 1800);
  };

  const addToBagLabel = isSoldOut
    ? "Sold Out"
    : justAdded
      ? "Added to bag"
      : "Add to Bag";

  const handleBuyNow = () => {
    if (onBuyNow && !isSoldOut && allVariantsSelected) {
      onBuyNow(product, selectedVariants, quantity);
    }
  };

  const handleImageNav = (dir: -1 | 1) => {
    setSelectedImageIndex((prev) => {
      const next = prev + dir;
      if (next < 0) return images.length - 1;
      if (next >= images.length) return 0;
      return next;
    });
  };

  /**
   * Mobile sticky purchase bar — shown only once the real one is gone.
   *
   * It used to be mounted for the whole page, which meant a phone opened the
   * product with two Add to Bag buttons a thumb apart: the panel's own, and a
   * fixed copy of it covering the media. Watching the purchase block and
   * revealing the bar only after it has scrolled *above* the viewport keeps
   * one visible control at a time. `boundingClientRect.top < 0` is what
   * distinguishes "scrolled past" from "not reached yet" — without it the bar
   * is on at the top of the page, which is the behaviour being fixed.
   */
  const purchaseRef = useRef<HTMLDivElement>(null);
  const [showStickyBuy, setShowStickyBuy] = useState(false);

  useEffect(() => {
    const el = purchaseRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setShowStickyBuy(
          !entry.isIntersecting && entry.boundingClientRect.top < 0,
        );
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const shelf = (relatedProducts ?? []).slice(0, 4);

  const priceBlock = hasDiscount ? (
    <>
      <span className="text-[28px] font-black leading-none tracking-tight text-[var(--mach-ink)] sm:text-[32px]">
        {formatPrice(Number(product.discountPrice))}
      </span>
      <span className="text-[15px] text-[var(--mach-mute)] line-through">
        {formatPrice(Number(product.price))}
      </span>
    </>
  ) : (
    <span className="text-[28px] font-black leading-none tracking-tight text-[var(--mach-ink)] sm:text-[32px]">
      {formatPrice(Number(product.price))}
    </span>
  );

  // Category is the product's own data and the same trail the breadcrumb
  // shows; `brand` is only ever set by the template previews.
  const eyebrow = product.brand || product.categoryName || null;

  return (
    <MachChrome>
      <div
        className={`product-page-mach min-h-screen bg-white text-[var(--mach-ink)] ${className}`}>
        {/* ============================================================ */}
        {/*  HERO — media left, purchase right                           */}
        {/* ============================================================ */}
        <div className={`${SHELL} ${GUTTER} pb-14 pt-5 lg:pb-20 lg:pt-6`}>
          {/* Breadcrumb — real destinations, matching the shop's trail.
              Compact and quiet: it orients, it is not a page header. */}
          <nav
            aria-label='Breadcrumb'
            className='mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--mach-mute)] lg:mb-8'>
            <a
              href='/'
              className='transition-colors hover:text-[var(--mach-ink)]'>
              Home
            </a>
            <span aria-hidden='true' className='text-[var(--mach-ink)]/25'>
              /
            </span>
            <a
              href='/shop'
              className='transition-colors hover:text-[var(--mach-ink)]'>
              Shop
            </a>
            {product.categoryName && (
              <>
                <span aria-hidden='true' className='text-[var(--mach-ink)]/25'>
                  /
                </span>
                <span className='text-[var(--mach-ink)]'>
                  {product.categoryName}
                </span>
              </>
            )}
          </nav>

          {/* 7/5 of twelve — media takes ~58% of the measure and the purchase
              column ~42%, which is enough width for the title, the price and
              a full-width primary action to sit on one comfortable rhythm
              instead of wrapping inside a narrow rail. */}
          <div className='grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10 xl:gap-14'>
            {/* -------------------------------------------------------- */}
            {/*  Media                                                    */}
            {/* -------------------------------------------------------- */}
            <Reveal variant='fadeIn' className='lg:col-span-7'>
              <div className='lg:flex lg:items-start lg:gap-4'>
                {/* Thumbnail rail — desktop, multi-image products only */}
                {hasGallery && (
                  <div className='hidden lg:flex lg:w-[76px] lg:shrink-0 lg:flex-col lg:gap-3'>
                    {images.map((img, idx) => (
                      <button
                        // biome-ignore lint/suspicious/noArrayIndexKey: gallery order is positional
                        key={idx}
                        type='button'
                        onClick={() => setSelectedImageIndex(idx)}
                        aria-label={`Show image ${idx + 1}`}
                        aria-current={idx === selectedImageIndex}
                        className={`relative aspect-square w-full overflow-hidden bg-white transition-[box-shadow] ${
                          idx === selectedImageIndex
                            ? "ring-2 ring-inset ring-[var(--mach-ink)]"
                            : "ring-1 ring-inset ring-[var(--mach-ink)]/12 hover:ring-[var(--mach-ink)]/40"
                        }`}>
                        <img
                          src={img.url}
                          alt=''
                          className='absolute inset-0 h-full w-full object-contain p-[8%]'
                        />
                      </button>
                    ))}
                  </div>
                )}

                {/* Stage — square, white, contained. Packaging is the subject:
                    a fill crop cuts the top off a tub and the label with it,
                    and the pack shots carry their own baked whitespace, so one
                    small predictable inset is all that is applied. No
                    per-product scaling. */}
                <div className='min-w-0 flex-1'>
                  <div className='group relative aspect-square w-full overflow-hidden bg-white ring-1 ring-inset ring-[var(--mach-ink)]/12'>
                    {currentImage?.url ? (
                      <button
                        type='button'
                        onClick={() => setLightboxOpen(true)}
                        aria-label='View larger image'
                        className='absolute inset-0 block h-full w-full cursor-zoom-in'>
                        <img
                          src={currentImage.url}
                          alt={product.name}
                          className='absolute inset-0 h-full w-full object-contain p-[5%] transition-transform duration-500 ease-out group-hover:scale-[1.03]'
                        />
                      </button>
                    ) : (
                      <div className='absolute inset-0 flex items-center justify-center'>
                        <span className='text-[10px] uppercase tracking-[0.28em] text-[var(--mach-mute)]'>
                          No image
                        </span>
                      </div>
                    )}

                    {hasGallery && (
                      <>
                        <button
                          type='button'
                          onClick={() => handleImageNav(-1)}
                          className='absolute start-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center bg-white text-[var(--mach-ink)] ring-1 ring-inset ring-[var(--mach-ink)]/15 transition-colors hover:bg-[var(--mach-ink)] hover:text-white'
                          aria-label='Previous image'>
                          <ChevronLeft className='h-4 w-4' />
                        </button>
                        <button
                          type='button'
                          onClick={() => handleImageNav(1)}
                          className='absolute end-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center bg-white text-[var(--mach-ink)] ring-1 ring-inset ring-[var(--mach-ink)]/15 transition-colors hover:bg-[var(--mach-ink)] hover:text-white'
                          aria-label='Next image'>
                          <ChevronRight className='h-4 w-4' />
                        </button>
                      </>
                    )}

                    {/* State flags — product data, not decoration */}
                    {isSoldOut ? (
                      <span className='absolute start-0 top-0 bg-[var(--mach-ink)] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white'>
                        Sold Out
                      </span>
                    ) : hasDiscount ? (
                      <span className='absolute start-0 top-0 bg-[var(--mach-ink)] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white'>
                        Sale
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Mobile thumbnail strip */}
              {hasGallery && (
                <div className='mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden'>
                  {images.map((img, idx) => (
                    <button
                      // biome-ignore lint/suspicious/noArrayIndexKey: gallery order is positional
                      key={idx}
                      type='button'
                      onClick={() => setSelectedImageIndex(idx)}
                      aria-label={`Show image ${idx + 1}`}
                      aria-current={idx === selectedImageIndex}
                      className={`relative h-16 w-16 shrink-0 overflow-hidden bg-white ${
                        idx === selectedImageIndex
                          ? "ring-2 ring-inset ring-[var(--mach-ink)]"
                          : "ring-1 ring-inset ring-[var(--mach-ink)]/12"
                      }`}>
                      <img
                        src={img.url}
                        alt=''
                        className='absolute inset-0 h-full w-full object-contain p-[8%]'
                      />
                    </button>
                  ))}
                </div>
              )}
            </Reveal>

            {/* -------------------------------------------------------- */}
            {/*  Purchase column                                          */}
            {/* -------------------------------------------------------- */}
            <Reveal variant='fadeUp' delay={0.1} className='lg:col-span-5'>
              {/* Sticky within the hero only. `top-28` clears the fixed
                  navbar chrome with a little air above the title. */}
              <div className='lg:sticky lg:top-28'>
                {eyebrow && (
                  <p className='text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--mach-mute)]'>
                    {eyebrow}
                  </p>
                )}

                <h1 className='mt-3 text-[26px] font-black uppercase leading-[1.08] tracking-[-0.015em] text-[var(--mach-ink)] sm:text-[32px] lg:text-[34px]'>
                  {product.name}
                </h1>

                {/* Only drawn when the reviews service returned something. */}
                <ProductRatingSummary
                  rating={product.rating}
                  reviewCount={product.reviewCount}
                  className='mt-3.5'
                />

                <div className='mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1'>
                  {priceBlock}
                </div>

                {product.description && (
                  <p className='mt-5 max-w-prose text-[15px] leading-relaxed text-[var(--mach-mute)]'>
                    {product.description}
                  </p>
                )}

                <div className='mt-7 h-px w-full bg-[var(--mach-ink)]/12' />

                {/* Selection comes before quantity: how many of *what* is the
                    order the shopper actually decides in. */}
                {product.variants && product.variants.length > 0 && (
                  <VariantSelector
                    variants={product.variants}
                    selectedVariants={selectedVariants}
                    onVariantChange={(name, value) =>
                      setSelectedVariants((prev) => ({
                        ...prev,
                        [name]: value,
                      }))
                    }
                    className='mt-7'
                  />
                )}

                {/* ── Purchase controls ──
                    Watched by the sticky-bar observer, so the bar appears
                    exactly when these leave the screen. */}
                <div ref={purchaseRef} className='mt-7'>
                  <div className='flex items-center gap-4'>
                    <span className='text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--mach-mute)]'>
                      Quantity
                    </span>
                    <div className='inline-flex items-center border border-[var(--mach-ink)]/20 bg-white'>
                      <button
                        type='button'
                        onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                        className='flex h-11 w-11 items-center justify-center text-[var(--mach-ink)] transition-colors hover:bg-[var(--mach-ink)] hover:text-white'
                        aria-label='Decrease quantity'>
                        <Minus className='h-3.5 w-3.5' />
                      </button>
                      <span className='w-10 text-center text-sm font-bold text-[var(--mach-ink)]'>
                        {quantity}
                      </span>
                      <button
                        type='button'
                        onClick={() =>
                          setQuantity((q) =>
                            Math.min(product.stock || 99, q + 1),
                          )
                        }
                        className='flex h-11 w-11 items-center justify-center text-[var(--mach-ink)] transition-colors hover:bg-[var(--mach-ink)] hover:text-white'
                        aria-label='Increase quantity'>
                        <Plus className='h-3.5 w-3.5' />
                      </button>
                    </div>
                  </div>

                  {/* Primary action: hard-edged, full-width, black. The
                      wishlist is a square beside it rather than a second
                      full-width button — it is not a purchase. */}
                  <div className='mt-4 flex items-stretch gap-3'>
                    <Button
                      size='lg'
                      className='h-[52px] flex-1 rounded-none bg-[var(--mach-ink)] text-[12px] font-bold uppercase tracking-[0.2em] text-white hover:bg-[var(--mach-ink-soft)]'
                      disabled={isSoldOut || !allVariantsSelected}
                      onClick={handleAddToCart}>
                      {addToBagLabel}
                    </Button>
                    {showWishlist && (
                      <button
                        type='button'
                        onClick={() => onAddToWishlist?.(product)}
                        className='flex h-[52px] w-[52px] shrink-0 items-center justify-center border border-[var(--mach-ink)]/20 bg-white text-[var(--mach-ink)] transition-colors hover:border-[var(--mach-ink)]'
                        aria-label='Add to wishlist'>
                        <Heart className='h-4 w-4' />
                      </button>
                    )}
                  </div>

                  {/* Buy It Now — same cart mechanism, then the existing
                      checkout. Outlined, so the hierarchy is unambiguous. */}
                  {onBuyNow && (
                    <Button
                      size='lg'
                      variant='outline'
                      className='mt-3 h-[52px] w-full rounded-none border-[var(--mach-ink)] text-[12px] font-bold uppercase tracking-[0.2em] text-[var(--mach-ink)] hover:bg-[var(--mach-ink)] hover:text-white'
                      disabled={isSoldOut || !allVariantsSelected}
                      onClick={handleBuyNow}>
                      Buy It Now
                    </Button>
                  )}
                </div>

                {/* Trust strip — one quiet line. It reassures; it does not
                    merchandise, so it gets no boxes and no fill. Wording is
                    unchanged. */}
                <div className='mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--mach-ink)]/12 pt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--mach-mute)]'>
                  <span className='inline-flex items-center gap-2'>
                    <Truck className='h-3.5 w-3.5' aria-hidden='true' />
                    Free Ship
                  </span>
                  <span
                    aria-hidden='true'
                    className='h-3 w-px bg-[var(--mach-ink)]/15'
                  />
                  <span className='inline-flex items-center gap-2'>
                    <Shield className='h-3.5 w-3.5' aria-hidden='true' />
                    Secure Pay
                  </span>
                  <span
                    aria-hidden='true'
                    className='h-3 w-px bg-[var(--mach-ink)]/15'
                  />
                  <span className='inline-flex items-center gap-2'>
                    <RotateCcw className='h-3.5 w-3.5' aria-hidden='true' />
                    Easy Return
                  </span>
                </div>

                {/* Shipping & Returns stays in the purchase column — it is
                    part of the buying decision, not product information. It is
                    store-wide CMS content; with nothing configured the
                    accordion is omitted rather than showing stale copy.
                    Everything else about the product lives in the details
                    section below the hero, so nothing is stated twice. */}
                {shippingReturnsParts.length > 0 && (
                  <Accordion type='multiple' className='mt-2'>
                    <AccordionItem value='shipping' className='border-b-0'>
                      <AccordionTrigger className='text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--mach-ink)] hover:no-underline'>
                        {content?.shippingSectionHeading?.trim() ||
                          "Shipping & Returns"}
                      </AccordionTrigger>
                      <AccordionContent className='space-y-2 text-sm leading-relaxed text-[var(--mach-mute)]'>
                        {shippingReturnsParts.map((part) => (
                          <p key={part} className='whitespace-pre-line'>
                            {part}
                          </p>
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
              </div>
            </Reveal>
          </div>
        </div>

        {/* ============================================================ */}
        {/*  DETAILS / ADD-ONS / REVIEWS                                 */}
        {/*  All three self-hide when the product carries no such data,  */}
        {/*  so a bundle with nothing but a name and a price drops       */}
        {/*  straight from the hero to the related shelf.                */}
        {/* ============================================================ */}
        {/* Every child self-hides, and `empty:hidden` collapses the frame
            itself when all three do — a product with nothing but a name, a
            price and a picture must not pay for a bordered, padded band that
            has nothing in it. Rule and padding live on the inner element for
            exactly that reason. */}
        <div className={`${SHELL} ${GUTTER}`}>
          <div className='space-y-4 pb-16 empty:hidden lg:space-y-8 lg:pb-24'>
            {/* Each section carries its own opening rule rather than
                inheriting one from this wrapper, so whichever of them survives
                the product's data is the one that draws the line. */}
            {/* "Product Details" is the name of the pack-identifier block
                inside this section, so the section itself cannot also be
                called that. The CMS heading still wins whenever one is set. */}
            <SupplementDetailsPanel
              info={product.supplementInfo}
              sku={product.sku}
              shortDescription={product.description}
              sectionHeading={
                content?.detailsSectionHeading?.trim() || "Product Information"
              }
              className={SECTION_RULE}
            />
            <ProductCrossSellStrip
              products={crossSellProducts}
              heading={content?.crossSellHeading}
              className={SECTION_RULE}
            />
            <ProductReviewsSection
              reviews={reviews}
              rating={product.rating}
              reviewCount={product.reviewCount}
            />
          </div>
        </div>

        {/* ============================================================ */}
        {/*  YOU MAY ALSO LIKE                                           */}
        {/* ============================================================ */}
        {shelf.length > 0 && (
          <section className='border-t border-[var(--mach-ink)]/10 bg-[var(--mach-paper)] pb-20 pt-14 lg:pb-24 lg:pt-16'>
            <div className={`${SHELL} ${GUTTER}`}>
              {/* Heading, action and cards share one measure, set by how many
                  products there actually are. The block stays flush with the
                  PDP container's left edge, so a short shelf reads as a narrow
                  editorial column rather than as a wide one that failed to
                  fill. */}
              <div className={relatedBlockClasses(shelf.length)}>
                <Reveal variant='fadeUp'>
                  <div className='flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3'>
                    {/* Heading is client-owned via product-page CMS content;
                        the inherited wording is only the unconfigured
                        default. */}
                    <h2 className={HEADING_SHELF}>
                      {content?.relatedProductsHeading?.trim() ||
                        "You May Also Like"}
                    </h2>
                    <a href='/shop' className={LINK_ACTION}>
                      Shop All
                      <ArrowRight
                        aria-hidden='true'
                        className='h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1'
                      />
                    </a>
                  </div>
                </Reveal>

                {/* The same card the homepage rows use — one product card for
                    the whole storefront, untouched, at its own size. Only the
                    track it sits in responds to the count. */}
                <StaggerContainer
                  className={`mt-9 grid gap-x-4 gap-y-12 sm:gap-x-6 lg:mt-10 ${relatedGridClasses(
                    shelf.length,
                  )}`}>
                  {shelf.map((rp) => (
                    <StaggerItem key={rp.id}>
                      <MachProductCard product={rp} />
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              </div>
            </div>
          </section>
        )}

        {/* Clearance for the fixed mobile purchase bar, so it can never rest
            on top of the last row of content or the footer. */}
        <div aria-hidden='true' className='h-[76px] lg:hidden' />

        {/* ============================================================ */}
        {/*  MOBILE STICKY PURCHASE BAR                                  */}
        {/* ============================================================ */}
        <div
          className={`fixed inset-x-0 bottom-0 z-50 border-t border-[var(--mach-ink)]/15 bg-white/95 p-3 backdrop-blur-sm transition-transform duration-300 lg:hidden ${
            showStickyBuy ? "translate-y-0" : "translate-y-full"
          }`}>
          <div className='flex items-center gap-3'>
            <div className='min-w-0 flex-1'>
              <p className='truncate text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--mach-ink)]'>
                {product.name}
              </p>
              <p className='text-sm font-black text-[var(--mach-ink)]'>
                {hasDiscount
                  ? formatPrice(Number(product.discountPrice))
                  : formatPrice(Number(product.price))}
              </p>
            </div>
            <Button
              className='h-12 rounded-none bg-[var(--mach-ink)] px-6 text-[11px] font-bold uppercase tracking-[0.18em] text-white hover:bg-[var(--mach-ink-soft)]'
              disabled={isSoldOut || !allVariantsSelected}
              tabIndex={showStickyBuy ? 0 : -1}
              onClick={handleAddToCart}>
              {addToBagLabel}
            </Button>
          </div>
        </div>

        {/* ============================================================ */}
        {/*  LIGHTBOX                                                    */}
        {/* ============================================================ */}
        <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
          <DialogContent className='max-w-4xl border-none bg-[var(--mach-ink)] p-0'>
            <DialogTitle className='sr-only'>Product Image</DialogTitle>
            <div className='relative flex h-[80vh] items-center justify-center'>
              {currentImage?.url && (
                <img
                  src={currentImage.url}
                  alt={product.name}
                  className='max-h-full max-w-full object-contain'
                />
              )}

              {hasGallery && (
                <>
                  <button
                    type='button'
                    onClick={() => handleImageNav(-1)}
                    className='absolute start-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center bg-white/10 text-white transition-colors hover:bg-white hover:text-[var(--mach-ink)]'
                    aria-label='Previous image'>
                    <ChevronLeft className='h-5 w-5' />
                  </button>
                  <button
                    type='button'
                    onClick={() => handleImageNav(1)}
                    className='absolute end-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center bg-white/10 text-white transition-colors hover:bg-white hover:text-[var(--mach-ink)]'
                    aria-label='Next image'>
                    <ChevronRight className='h-5 w-5' />
                  </button>

                  <div className='absolute bottom-4 start-1/2 -translate-x-1/2 text-xs tracking-[0.2em] text-white/50'>
                    {selectedImageIndex + 1} / {images.length}
                  </div>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MachChrome>
  );
}

ProductPageEditorial.displayName = "ProductPageEditorial";
