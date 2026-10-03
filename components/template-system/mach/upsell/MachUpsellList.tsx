import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useCart } from "#root/lib/context/CartContext";
import { STORE_CURRENCY } from "#root/shared/config/branding";
import type { FeaturedProduct } from "../../home/HomeFeaturedProducts";
import { useMachAddToCart } from "../useMachAddToCart";

/**
 * The compact upsell row list — image, name, price, and one action.
 *
 * Shared by the product-page block and the post-add sheet so the two look and
 * behave identically. The action follows the same rules as `MachQuickAdd`,
 * because a recommendation is no more entitled to guess than a shelf card:
 *
 *  - no option groups      → "+ Add" through the one Mach add-to-cart path
 *                            (CartContext stock checks, tracking, line merging)
 *  - option groups (> 0)   → "Choose options", a link to the product page,
 *                            never a guessed flavour or size
 *  - option state unknown  → treated as "Choose options" for the same reason
 *  - already in the bag    → "Added", and it cannot be pressed again, which is
 *                            also what stops a double-tap adding two units
 */

function formatPrice(v: number): string {
  return `${STORE_CURRENCY} ${v.toFixed(2)}`;
}

function toNumber(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

export function productHref(p: Pick<FeaturedProduct, "id" | "slug">): string {
  return `/shop/${p.slug ?? p.id}`;
}

function imageOf(p: FeaturedProduct): string | undefined {
  const raw = p.imageUrl ?? p.images?.[0]?.url;
  if (!raw) return undefined;
  return raw.startsWith("http") || raw.startsWith("/") ? raw : `/uploads/${raw}`;
}

const ACTION =
  "inline-flex min-h-[44px] min-w-[84px] shrink-0 items-center justify-center gap-1.5 px-3 text-[10px] font-bold uppercase leading-none tracking-[0.16em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--mach-ink)]";

export function MachUpsellAddButton({
  product,
  toast = true,
  onNavigate,
}: {
  product: FeaturedProduct;
  /** Off inside the post-add sheet, which is its own confirmation. */
  toast?: boolean;
  /** Called before following the options link (the sheet closes itself). */
  onNavigate?: () => void;
}) {
  const { items } = useCart();
  const { add } = useMachAddToCart();
  const inBag = items.some((i) => i.id === product.id);
  const [refused, setRefused] = useState(false);

  // Set synchronously on press, so a second tap landing before React has
  // re-rendered with the new cart cannot add a second unit.
  const busy = useRef(false);
  useEffect(() => {
    if (!inBag) busy.current = false;
  }, [inBag]);

  const price = toNumber(product.price) ?? 0;
  const discount = toNumber(product.discountPrice);
  const hasDiscount = discount != null && discount < price;
  const isSoldOut = !product.available || product.stock <= 0;

  if (isSoldOut) return null;

  if (product.variantCount === undefined || product.variantCount > 0) {
    return (
      <a
        href={productHref(product)}
        onClick={onNavigate}
        aria-label={`Choose options for ${product.name}`}
        className={`${ACTION} border border-white/30 text-white hover:border-white`}>
        Options
      </a>
    );
  }

  if (inBag) {
    return (
      <button
        type='button'
        disabled
        aria-label={`${product.name} added to bag`}
        className={`${ACTION} border border-white/30 bg-transparent text-white/70`}>
        <Check className='h-3.5 w-3.5' strokeWidth={3} aria-hidden='true' />
        Added
      </button>
    );
  }

  const handleAdd = () => {
    if (busy.current) return;
    busy.current = true;
    const ok = add({
      id: product.id,
      name: product.name,
      price: hasDiscount ? (discount as number) : price,
      originalPrice: hasDiscount ? price : undefined,
      stock: product.stock,
      available: product.available,
      imageUrl: imageOf(product),
      categoryName: product.categoryName,
      quantity: 1,
      // Only reached for a product the server reported as having no option
      // groups — see above.
      selectedOptions: {},
      toast,
    });
    if (!ok) {
      busy.current = false;
      setRefused(true);
    }
  };

  return (
    <button
      type='button'
      onClick={handleAdd}
      disabled={refused}
      aria-label={`Add ${product.name} to bag`}
      className={`${ACTION} bg-white text-[var(--mach-ink)] hover:bg-white/85 disabled:bg-white/20 disabled:text-white/60`}>
      {refused ? (
        "Unavailable"
      ) : (
        <>
          <Plus className='h-3.5 w-3.5' strokeWidth={3} aria-hidden='true' />
          Add
        </>
      )}
    </button>
  );
}

export function MachUpsellList({
  products,
  toast = true,
  onNavigate,
  className = "",
}: {
  products: FeaturedProduct[];
  toast?: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  if (products.length === 0) return null;
  return (
    <ul className={`border-t border-white/12 ${className}`}>
      {products.map((p) => {
        const src = imageOf(p);
        const price = toNumber(p.price) ?? 0;
        const discount = toNumber(p.discountPrice);
        const hasDiscount = discount != null && discount < price;
        const href = productHref(p);
        return (
          <li
            key={p.id}
            data-upsell-item={p.id}
            className='flex items-center gap-3 border-b border-white/12 py-3'>
            {/* Photo stages stay white — packaging is the subject. The name
                beside it is the row's one link. */}
            <div className='h-14 w-14 shrink-0 overflow-hidden bg-white ring-1 ring-inset ring-[var(--mach-ink)]/12'>
              {src && (
                <img
                  src={src}
                  alt=''
                  loading='lazy'
                  className='h-full w-full object-contain p-[8%]'
                />
              )}
            </div>
            <div className='min-w-0 flex-1'>
              <a
                href={href}
                onClick={onNavigate}
                className='line-clamp-2 text-[12px] font-bold uppercase leading-[1.3] tracking-[0.03em] text-white hover:underline'>
                {p.name}
              </a>
              <p className='mt-1 text-[13px]'>
                <span className='font-bold text-white'>
                  {formatPrice(hasDiscount ? (discount as number) : price)}
                </span>
                {hasDiscount && (
                  <>
                    {" "}
                    <span className='text-[12px] text-[var(--mach-mute-invert)] line-through'>
                      {formatPrice(price)}
                    </span>
                  </>
                )}
              </p>
            </div>
            <MachUpsellAddButton
              product={p}
              toast={toast}
              onNavigate={onNavigate}
            />
          </li>
        );
      })}
    </ul>
  );
}
