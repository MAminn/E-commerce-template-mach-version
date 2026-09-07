import { memo } from "react";
import { STORE_CURRENCY } from "#root/shared/config/branding";
import type { FeaturedProduct } from "../../home/HomeFeaturedProducts";

/**
 * Curated add-ons / frequently-bought-together strip.
 *
 * Receives already-resolved products — the backend resolves the stored ID list
 * into live name/price/image/stock, so nothing here is a duplicated copy of
 * another product's data. The heading comes from product-page CMS content;
 * when the client has not set one, no heading is drawn.
 */
function formatPrice(v: number): string {
  return `${STORE_CURRENCY} ${v.toLocaleString()}`;
}

function imageSrc(p: FeaturedProduct): string | undefined {
  const raw = p.imageUrl ?? p.images?.[0]?.url;
  if (!raw) return undefined;
  return raw.startsWith("http") || raw.startsWith("/")
    ? raw
    : `/uploads/${raw}`;
}

export const ProductCrossSellStrip = memo(function ProductCrossSellStrip({
  products,
  heading,
  className = "",
}: {
  products?: FeaturedProduct[];
  heading?: string;
  className?: string;
}) {
  const items = products ?? [];
  if (items.length === 0) return null;

  return (
    <section
      className={`border-t border-[var(--mach-ink)]/12 pt-12 ${className}`}>
      {heading && heading.trim().length > 0 && (
        <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-black uppercase leading-[0.95] tracking-[-0.02em] text-[var(--mach-ink)]">
          {heading}
        </h2>
      )}
      <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4">
        {items.map((p) => {
          const src = imageSrc(p);
          const discounted =
            p.discountPrice != null &&
            Number(p.discountPrice) < Number(p.price);
          return (
            <li key={p.id}>
              <a href={`/shop/${p.slug ?? p.id}`} className="group block">
                {/* Contained, not cropped — same treatment as the shelf
                    card, so an add-on reads as the same kind of object. */}
                <div className="aspect-square overflow-hidden bg-white ring-1 ring-inset ring-[var(--mach-ink)]/12 transition-[box-shadow] group-hover:ring-[var(--mach-ink)]">
                  {src && (
                    <img
                      src={src}
                      alt={p.name}
                      loading="lazy"
                      className="h-full w-full object-contain p-[7%] transition-transform duration-500 group-hover:scale-105"
                    />
                  )}
                </div>
                <p className="mt-4 line-clamp-2 text-[13px] font-bold uppercase leading-[1.25] tracking-[0.03em] text-[var(--mach-ink)]">
                  {p.name}
                </p>
                <p className="mt-2 text-[13px]">
                  {discounted ? (
                    <>
                      <span className="font-bold text-[var(--mach-ink)]">
                        {formatPrice(Number(p.discountPrice))}
                      </span>{" "}
                      <span className="text-[12px] text-[var(--mach-mute)] line-through">
                        {formatPrice(Number(p.price))}
                      </span>
                    </>
                  ) : (
                    <span className="font-bold text-[var(--mach-ink)]">
                      {formatPrice(Number(p.price))}
                    </span>
                  )}
                </p>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
});
