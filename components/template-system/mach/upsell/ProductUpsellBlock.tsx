import type { FeaturedProduct } from "../../home/HomeFeaturedProducts";
import { MachUpsellList } from "./MachUpsellList";

/**
 * Compact upsell block under the product page's purchase controls.
 *
 * A short list rather than cards: it sits inside the purchase column, so it
 * must read as part of the buying decision, not as another shelf. Renders
 * nothing when the resolver returned nothing.
 */
export function ProductUpsellBlock({
  products,
  heading,
  className = "",
}: {
  products: FeaturedProduct[];
  heading: string;
  className?: string;
}) {
  if (products.length === 0) return null;
  return (
    <section
      aria-label={heading}
      data-testid='product-upsell-block'
      className={className}>
      <h2 className='text-[11px] font-bold uppercase tracking-[0.2em] text-white'>
        {heading}
      </h2>
      <MachUpsellList products={products} className='mt-3' />
    </section>
  );
}
