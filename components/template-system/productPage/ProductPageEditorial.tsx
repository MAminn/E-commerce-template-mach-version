import React, { useState, useMemo, memo, useEffect, useRef } from "react";
import { Button } from "#root/components/ui/button";
import { VariantSelector } from "#root/components/shop/VariantSelector";
import { Skeleton } from "#root/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogClose,
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
import { getProductUrl } from "#root/lib/utils/route-helpers";
import {
  Heart,
  ChevronLeft,
  ChevronRight,
  Share2,
  Minus,
  Plus,
  X,
  Truck,
  Shield,
  RotateCcw,
} from "lucide-react";
import { MachChrome } from "../mach/MachChrome";
import { MachProductCard } from "../mach/MachProductCard";
import { showMachCartToast } from "../mach/MachCartFeedback";
import { GUTTER, HEADING_SM, SHELL } from "../mach/machTokens";
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
 * hard-coded here. Every field is optional: an unset heading hides its
 * section heading, and unset shipping/returns text hides that accordion.
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
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Default Product                                                   */
/* ------------------------------------------------------------------ */

const DEFAULT_PRODUCT: ProductPageProduct = {
  id: "editorial-1",
  name: "Wool-Blend Oversized Coat",
  price: 4500,
  discountPrice: 3600,
  stock: 12,
  available: true,
  imageUrl:
    "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800",
  images: [
    {
      url: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800",
      isPrimary: true,
    },
    {
      url: "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=800",
    },
    {
      url: "https://images.unsplash.com/photo-1539533113208-f6df8cc8b543?w=800",
    },
  ],
  description: "A timeless oversized coat crafted from premium wool blend.",
  longDescription:
    "Layer with intention. This oversized silhouette in a luxe wool-cashmere blend falls to mid-calf length. Dropped shoulders, notched lapels, and a single-button closure create an effortlessly elegant line. Fully lined in cupro for smooth layering over knitwear and tailoring alike.",
  rating: 4.8,
  reviewCount: 42,
  sku: "OC-WB-2024",
  brand: "House Edit",
  specifications: [
    { label: "Fabric", value: "70% Wool, 20% Polyamide, 10% Cashmere" },
    { label: "Lining", value: "100% Cupro" },
    { label: "Length", value: "120 cm" },
    { label: "Care", value: "Dry clean only" },
  ],
  features: [
    {
      icon: "package",
      title: "Complimentary Shipping",
      description: "Free express delivery on all orders",
    },
    {
      icon: "shield",
      title: "Secure Payment",
      description: "100% secure checkout",
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatPrice(v: number): string {
  return `${STORE_CURRENCY} ${v.toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */

export function ProductPageEditorial({
  product = DEFAULT_PRODUCT,
  relatedProducts,
  crossSellProducts,
  reviews,
  content,
  showWishlist = true,
  showSocialShare = false,
  onAddToCart,
  onBuyNow,
  onAddToWishlist,
  onImageClick,
  className = "",
}: ProductPageEditorialProps) {
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);

  const images: ProductImage[] = useMemo(() => {
    if (product.images && product.images.length > 0) return product.images;
    if (product.imageUrl) return [{ url: product.imageUrl, isPrimary: true }];
    return [];
  }, [product.images, product.imageUrl]);

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
   * Before this the page produced no confirmation of its own, so the only
   * answer a shopper got was the inherited amber `StickyCartBar` sliding up
   * from the bottom — which Mach no longer mounts. The button now confirms in
   * place and the monochrome Mach toast names what went in; the navbar bag
   * count was already live. Same handler, same cart, same stock rules.
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

  return (
    <MachChrome>
      <div
        className={`product-page-mach min-h-screen bg-white text-[var(--mach-ink)] ${className}`}>
        {/* ============================================================ */}
        {/*  12-COLUMN GRID LAYOUT                                       */}
        {/* ============================================================ */}
        <div className={`${SHELL} ${GUTTER} pt-8 pb-16 lg:pt-10`}>
          {/* Breadcrumb — real destinations, matching the shop's trail. */}
          <nav
            aria-label='Breadcrumb'
            className='mb-8 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--mach-mute)]'>
            <a
              href='/'
              className='transition-colors hover:text-[var(--mach-ink)]'>
              Home
            </a>
            <span aria-hidden='true'>/</span>
            <a
              href='/shop'
              className='transition-colors hover:text-[var(--mach-ink)]'>
              Shop
            </a>
            {product.categoryName && (
              <>
                <span aria-hidden='true'>/</span>
                <span className='text-[var(--mach-ink)]'>
                  {product.categoryName}
                </span>
              </>
            )}
          </nav>

          <div className='grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12'>
            {/* -------------------------------------------------------- */}
            {/*  Thumbnails — col-span-1 on desktop                      */}
            {/* -------------------------------------------------------- */}
            {images.length > 1 && (
              <StaggerContainer className='hidden lg:flex lg:col-span-1 lg:flex-col lg:gap-2 lg:pt-1'>
                {images.map((img, idx) => (
                  <StaggerItem key={idx}>
                    <button
                      type='button'
                      onClick={() => setSelectedImageIndex(idx)}
                      className={`relative aspect-square w-full overflow-hidden bg-[var(--mach-paper-soft)] transition-[box-shadow] ${
                        idx === selectedImageIndex
                          ? "ring-2 ring-inset ring-[var(--mach-ink)]"
                          : "ring-1 ring-inset ring-[var(--mach-ink)]/10 hover:ring-[var(--mach-ink)]/40"
                      }`}>
                      <img
                        src={img.url}
                        alt={`View ${idx + 1}`}
                        className='absolute inset-0 h-full w-full object-contain p-[8%]'
                      />
                    </button>
                  </StaggerItem>
                ))}
              </StaggerContainer>
            )}

            {/* -------------------------------------------------------- */}
            {/*  Main Image — col-span-7                                 */}
            {/* -------------------------------------------------------- */}
            <Reveal
              variant='fadeIn'
              className={`relative ${images.length > 1 ? "lg:col-span-7" : "lg:col-span-8"}`}>
              {/* Square and contained. Packaging is the subject here — a 4:5
                  fill crop cuts the top off a tub, and the label with it. */}
              <div className='group relative aspect-square w-full overflow-hidden bg-white ring-1 ring-inset ring-[var(--mach-ink)]/12'>
                {currentImage?.url ? (
                  <img
                    src={currentImage.url}
                    alt={product.name}
                    className='absolute inset-0 h-full w-full cursor-zoom-in object-contain p-[5%] transition-transform duration-500 ease-out group-hover:scale-[1.03]'
                    onClick={() => setLightboxOpen(true)}
                  />
                ) : (
                  <div className='absolute inset-0 flex items-center justify-center'>
                    <span className='text-[10px] uppercase tracking-[0.28em] text-[var(--mach-mute)]'>
                      No image
                    </span>
                  </div>
                )}

                {/* Image nav arrows */}
                {images.length > 1 && (
                  <>
                    <button
                      type='button'
                      onClick={() => handleImageNav(-1)}
                      className='absolute start-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center bg-white text-[var(--mach-ink)] ring-1 ring-inset ring-[var(--mach-ink)]/15 transition-colors hover:bg-[var(--mach-ink)] hover:text-white'
                      aria-label='Previous image'>
                      <ChevronLeft className='h-4 w-4' />
                    </button>
                    <button
                      type='button'
                      onClick={() => handleImageNav(1)}
                      className='absolute end-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center bg-white text-[var(--mach-ink)] ring-1 ring-inset ring-[var(--mach-ink)]/15 transition-colors hover:bg-[var(--mach-ink)] hover:text-white'
                      aria-label='Next image'>
                      <ChevronRight className='h-4 w-4' />
                    </button>
                  </>
                )}

                {/* Sale / Sold out badge */}
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

              {/* Mobile thumbnail strip */}
              {images.length > 1 && (
                <div className='mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden'>
                  {images.map((img, idx) => (
                    <button
                      key={idx}
                      type='button'
                      onClick={() => setSelectedImageIndex(idx)}
                      className={`relative h-16 w-16 shrink-0 overflow-hidden bg-[var(--mach-paper-soft)] ${
                        idx === selectedImageIndex
                          ? "ring-2 ring-inset ring-[var(--mach-ink)]"
                          : "ring-1 ring-inset ring-[var(--mach-ink)]/10"
                      }`}>
                      <img
                        src={img.url}
                        alt={`View ${idx + 1}`}
                        className='absolute inset-0 h-full w-full object-contain p-[8%]'
                      />
                    </button>
                  ))}
                </div>
              )}
            </Reveal>

            {/* -------------------------------------------------------- */}
            {/*  Buy Box — col-span-4, sticky                            */}
            {/* -------------------------------------------------------- */}
            <Reveal variant='fadeUp' delay={0.15} className='lg:col-span-4'>
              <div className='lg:sticky lg:top-24'>
                {/* Brand */}
                {product.brand && (
                  <p className='text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--mach-mute)]'>
                    {product.brand}
                  </p>
                )}

                {/* Name */}
                <h1 className='mt-3 text-[22px] font-black uppercase leading-[1.15] tracking-[-0.01em] text-[var(--mach-ink)] sm:text-[28px]'>
                  {product.name}
                </h1>

                {/* Price — the single largest number in the column */}
                <div className='mt-5 flex items-baseline gap-3'>
                  {hasDiscount ? (
                    <>
                      <span className='text-2xl font-black tracking-tight text-[var(--mach-ink)] sm:text-3xl'>
                        {formatPrice(Number(product.discountPrice))}
                      </span>
                      <span className='text-sm text-[var(--mach-mute)] line-through'>
                        {formatPrice(Number(product.price))}
                      </span>
                    </>
                  ) : (
                    <span className='text-2xl font-black tracking-tight text-[var(--mach-ink)] sm:text-3xl'>
                      {formatPrice(Number(product.price))}
                    </span>
                  )}
                </div>

                <ProductRatingSummary
                  rating={product.rating}
                  reviewCount={product.reviewCount}
                  className='mt-3'
                />

                {/* Short description */}
                {product.description && (
                  <p className='mt-5 text-sm leading-relaxed text-[var(--mach-mute)]'>
                    {product.description}
                  </p>
                )}

                {/* Divider */}
                <div className='mt-7 h-px w-full bg-[var(--mach-ink)]/12' />

                {/* Quantity selector */}
                <div className='mt-7'>
                  <p className='mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--mach-mute)]'>
                    Quantity
                  </p>
                  <div className='inline-flex items-center border border-[var(--mach-ink)]/20 bg-white'>
                    <button
                      type='button'
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      className='flex h-12 w-12 items-center justify-center text-[var(--mach-ink)] transition-colors hover:bg-[var(--mach-ink)] hover:text-white'
                      aria-label='Decrease quantity'>
                      <Minus className='h-3.5 w-3.5' />
                    </button>
                    <span className='w-12 text-center text-sm font-bold text-[var(--mach-ink)]'>
                      {quantity}
                    </span>
                    <button
                      type='button'
                      onClick={() =>
                        setQuantity((q) => Math.min(product.stock || 99, q + 1))
                      }
                      className='flex h-12 w-12 items-center justify-center text-[var(--mach-ink)] transition-colors hover:bg-[var(--mach-ink)] hover:text-white'
                      aria-label='Increase quantity'>
                      <Plus className='h-3.5 w-3.5' />
                    </button>
                  </div>
                </div>

                {/* Variant Selector */}
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
                    className='mt-6'
                  />
                )}

                {/* Add to bag + Wishlist */}
                {/* The purchase block is the loudest thing in the column:
                    hard-edged, full-width, black. Same handlers as before. */}
                <div className='mt-7 flex items-center gap-3'>
                  <Button
                    size='lg'
                    className='h-14 flex-1 rounded-none bg-[var(--mach-ink)] text-[12px] font-bold uppercase tracking-[0.2em] text-white hover:bg-[var(--mach-ink-soft)]'
                    disabled={isSoldOut || !allVariantsSelected}
                    onClick={handleAddToCart}>
                    {addToBagLabel}
                  </Button>
                  {showWishlist && (
                    <button
                      type='button'
                      onClick={() => onAddToWishlist?.(product)}
                      className='flex h-14 w-14 shrink-0 items-center justify-center border border-[var(--mach-ink)]/20 bg-white text-[var(--mach-ink)] transition-colors hover:border-[var(--mach-ink)]'
                      aria-label='Add to wishlist'>
                      <Heart className='h-4.5 w-4.5' />
                    </button>
                  )}
                </div>

                {/* Buy It Now — same cart mechanism, then the existing checkout */}
                {onBuyNow && (
                  <Button
                    size='lg'
                    variant='outline'
                    className='mt-3 h-14 w-full rounded-none border-[var(--mach-ink)] text-[12px] font-bold uppercase tracking-[0.2em] text-[var(--mach-ink)] hover:bg-[var(--mach-ink)] hover:text-white'
                    disabled={isSoldOut || !allVariantsSelected}
                    onClick={handleBuyNow}>
                    Buy It Now
                  </Button>
                )}

                {/* Value props row */}
                <div className='mt-7 grid grid-cols-3 gap-px bg-[var(--mach-ink)]/12'>
                  <div className='flex flex-col items-center gap-2 bg-[var(--mach-paper)] px-2 py-4 text-center'>
                    <Truck className='h-4 w-4 text-[var(--mach-ink)]' />
                    <span className='text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--mach-mute)]'>
                      Free Ship
                    </span>
                  </div>
                  <div className='flex flex-col items-center gap-2 bg-[var(--mach-paper)] px-2 py-4 text-center'>
                    <Shield className='h-4 w-4 text-[var(--mach-ink)]' />
                    <span className='text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--mach-mute)]'>
                      Secure Pay
                    </span>
                  </div>
                  <div className='flex flex-col items-center gap-2 bg-[var(--mach-paper)] px-2 py-4 text-center'>
                    <RotateCcw className='h-4 w-4 text-[var(--mach-ink)]' />
                    <span className='text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--mach-mute)]'>
                      Easy Return
                    </span>
                  </div>
                </div>

                {/* Accordion (Specs / Long Description) */}
                <div className='mt-6'>
                  <Accordion type='multiple' defaultValue={["description"]}>
                    {product.longDescription && (
                      <AccordionItem value='description'>
                        <AccordionTrigger className='text-[12px] font-bold uppercase tracking-[0.16em] text-[var(--mach-ink)] hover:no-underline'>
                          Description
                        </AccordionTrigger>
                        <AccordionContent className='text-sm leading-relaxed text-[var(--mach-mute)]'>
                          {product.longDescription}
                        </AccordionContent>
                      </AccordionItem>
                    )}
                    {product.specifications &&
                      product.specifications.length > 0 && (
                        <AccordionItem value='specifications'>
                          <AccordionTrigger className='text-[12px] font-bold uppercase tracking-[0.16em] text-[var(--mach-ink)] hover:no-underline'>
                            Specifications
                          </AccordionTrigger>
                          <AccordionContent>
                            <dl className='space-y-2'>
                              {product.specifications.map((spec, idx) => (
                                <div key={idx} className='flex justify-between'>
                                  <dt className='text-sm text-[var(--mach-mute)]'>
                                    {spec.label}
                                  </dt>
                                  <dd className='text-sm font-semibold text-[var(--mach-ink)]'>
                                    {spec.value}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </AccordionContent>
                        </AccordionItem>
                      )}
                    {/* Shipping & Returns is store-wide CMS content
                        (store_settings.product_page_content), never template
                        prose. With nothing configured the accordion is
                        omitted entirely rather than showing stale copy. */}
                    {shippingReturnsParts.length > 0 && (
                      <AccordionItem value='shipping'>
                        <AccordionTrigger className='text-[12px] font-bold uppercase tracking-[0.16em] text-[var(--mach-ink)] hover:no-underline'>
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
                    )}
                  </Accordion>
                </div>
              </div>
            </Reveal>
          </div>
        </div>

        {/* ============================================================ */}
        {/*  SUPPLEMENT DETAILS / ADD-ONS / REVIEWS                      */}
        {/*  All three self-hide when the product carries no such data,  */}
        {/*  so non-supplement catalogues are completely unaffected.     */}
        {/* ============================================================ */}
        <div className={`${SHELL} ${GUTTER} pb-20`}>
          <div className='space-y-16 lg:space-y-20'>
            <SupplementDetailsPanel
              info={product.supplementInfo}
              sku={product.sku}
              sectionHeading={content?.detailsSectionHeading}
            />
            <ProductCrossSellStrip
              products={crossSellProducts}
              heading={content?.crossSellHeading}
            />
            <ProductReviewsSection
              reviews={reviews}
              rating={product.rating}
              reviewCount={product.reviewCount}
            />
          </div>
        </div>

        {/* ============================================================ */}
        {/*  MOBILE STICKY ADD-TO-BAG BAR                                */}
        {/* ============================================================ */}
        <div className='fixed inset-x-0 bottom-0 z-50 border-t border-[var(--mach-ink)]/15 bg-white/95 p-3 backdrop-blur-sm lg:hidden'>
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
              onClick={handleAddToCart}>
              {addToBagLabel}
            </Button>
          </div>
        </div>

        {/* ============================================================ */}
        {/*  COMPLETE THE LOOK                                           */}
        {/* ============================================================ */}
        {relatedProducts && relatedProducts.length > 0 && (
          <section className='border-t border-[var(--mach-ink)]/10 bg-[var(--mach-paper)] pb-24 pt-16 lg:pb-28 lg:pt-20'>
            <div className={`${SHELL} ${GUTTER}`}>
              <Reveal variant='fadeUp'>
                {/* Heading is client-owned via product-page CMS content;
                    the inherited wording is only the unconfigured default. */}
                <h2 className={HEADING_SM}>
                  {content?.relatedProductsHeading?.trim() ||
                    "You May Also Like"}
                </h2>
              </Reveal>
              {/* The same card the homepage rows and the shop grid use — one
                  product card for the whole storefront. */}
              <StaggerContainer className='mt-10 grid grid-cols-2 gap-x-4 gap-y-12 sm:gap-x-6 lg:grid-cols-4'>
                {relatedProducts.slice(0, 4).map((rp) => (
                  <StaggerItem key={rp.id}>
                    <MachProductCard product={rp} />
                  </StaggerItem>
                ))}
              </StaggerContainer>
            </div>
          </section>
        )}

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

              {images.length > 1 && (
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
                </>
              )}

              <div className='absolute bottom-4 start-1/2 -translate-x-1/2 text-xs text-white/50 tracking-[0.2em]'>
                {selectedImageIndex + 1} / {images.length}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MachChrome>
  );
}

ProductPageEditorial.displayName = "ProductPageEditorial";
