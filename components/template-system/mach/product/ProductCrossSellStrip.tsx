import { memo } from "react";
import { ArrowUpRight } from "lucide-react";
import { STORE_CURRENCY } from "#root/shared/config/branding";
import type { FeaturedProduct } from "../../home/HomeFeaturedProducts";

/**
 * Curated add-ons / frequently-bought-together strip.
 *
 * Receives already-resolved products — the backend resolves the stored ID list
 * into live name/price/image/stock, so nothing here is a duplicated copy of
 * another product's data.
 *
 * Presented as a compact list rather than as a second product grid. This sits
 * between the product's own details and the related-products shelf, and three
 * full-size cards there read as another shelf competing with the one below it.
 * A small stage, the name and the price is all an add-on needs to be
 * recognised and clicked; the shelf below is where browsing happens.
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
    <section className={className}>
      {/* Client-owned via product-page CMS content; the wording below is only
          the unconfigured default. */}
      <h2 className="text-[clamp(1.25rem,2.4vw,1.75rem)] font-black uppercase leading-[0.95] tracking-[-0.02em] text-[var(--mach-ink)]">
        {heading && heading.trim().length > 0
          ? heading
          : "Frequently Bought Together"}
      </h2>

      <ul className="mt-5 grid border-t border-[var(--mach-ink)]/12 sm:grid-cols-2 sm:gap-x-10 lg:grid-cols-3 lg:gap-x-12">
        {items.map((p) => {
          const src = imageSrc(p);
          const discounted =
            p.discountPrice != null &&
            Number(p.discountPrice) < Number(p.price);
          return (
            <li
              key={p.id}
              className="border-b border-[var(--mach-ink)]/12">
              <a
                href={`/shop/${p.slug ?? p.id}`}
                className="group flex items-center gap-4 py-3.5">
                {/* Contained, not cropped — an add-on reads as the same kind
                    of object as everything else on the page. */}
                <div className="h-16 w-16 shrink-0 overflow-hidden bg-white ring-1 ring-inset ring-[var(--mach-ink)]/12 transition-[box-shadow] group-hover:ring-[var(--mach-ink)]">
                  {src && (
                    <img
                      src={src}
                      alt={p.name}
                      loading="lazy"
                      className="h-full w-full object-contain p-[8%]"
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[12px] font-bold uppercase leading-[1.3] tracking-[0.03em] text-[var(--mach-ink)]">
                    {p.name}
                  </p>
                  <p className="mt-1.5 text-[13px]">
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
                </div>

                <ArrowUpRight
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-[var(--mach-ink)]/30 transition-colors group-hover:text-[var(--mach-ink)]"
                />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
});
