import { normalizeMediaUrl } from "#root/components/template-system/mach/MachMedia";

/**
 * Shared mapping boundary for `product.search` results.
 *
 * `product.search` deliberately returns bare disk filenames
 * (`backend/products/search-products/service.ts` selects `file.diskname`
 * directly for both `imageUrl` and every `images[].url`). Every consumer is
 * therefore responsible for turning those into requestable URLs.
 *
 * Skipping that step does not fail loudly: a bare filename on `/shop` resolves
 * relative to the current path, and `/shop/<filename>` is swallowed by the
 * `/shop/@productId` catch-all route, which answers 200 with `text/html`. The
 * browser then fails to decode an HTML document as an image and shows the alt
 * text — no console 404, no broken-link signal.
 *
 * Both `/shop` and `/categories/@slug` map identical result shapes, so the
 * normalisation lives here once rather than being re-implemented per route.
 * `normalizeMediaUrl` is the canonical resolver: it passes through absolute
 * URLs, root-relative paths and `data:`/`blob:` URIs untouched, so running an
 * already-resolved value through it again is a no-op.
 */

/** The subset of a search result this mapper reads. */
export interface SearchProductLike {
  id: string;
  slug?: string | null;
  name: string;
  price: number | string;
  discountPrice?: number | string | null;
  stock: number;
  imageUrl?: string | null;
  images?: { url: string; isPrimary?: boolean }[] | null;
  categoryName?: string | null;
  variantCount?: number;
}

export interface MappedProductMedia {
  id: string;
  slug?: string | null;
  name: string;
  price: number;
  discountPrice: number | null;
  stock: number;
  imageUrl?: string;
  images: { url: string; isPrimary?: boolean }[];
  categoryName: string | null;
  available: boolean;
  variantCount?: number;
}

/** Normalises one search result into a browser-requestable product shape. */
export function mapSearchProduct(p: SearchProductLike): MappedProductMedia {
  const imageUrl = normalizeMediaUrl(p.imageUrl) || undefined;
  const images = (p.images ?? [])
    .map((img) => ({
      url: normalizeMediaUrl(img.url),
      isPrimary: img.isPrimary,
    }))
    .filter((img) => img.url.length > 0);

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    price: Number(p.price),
    discountPrice: p.discountPrice != null ? Number(p.discountPrice) : null,
    stock: p.stock,
    imageUrl,
    // Keep a single-entry gallery when only the primary image exists, so cards
    // that read `images` behave the same as ones that read `imageUrl`.
    images:
      images.length > 0
        ? images
        : imageUrl
          ? [{ url: imageUrl, isPrimary: true }]
          : [],
    categoryName: p.categoryName || null,
    available: p.stock > 0,
    // Option state travels with the product so cards can decide between a
    // direct quick-add and a hand-off to the product page. Undefined when the
    // source row doesn't carry it — cards then show no quick-add at all.
    variantCount:
      typeof p.variantCount === "number" ? p.variantCount : undefined,
  };
}

/** Convenience wrapper for a whole result page. */
export function mapSearchProducts(
  items: SearchProductLike[],
): MappedProductMedia[] {
  return items.map(mapSearchProduct);
}
