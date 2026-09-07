import { useCallback } from "react";
import { Check, Plus } from "lucide-react";
import type { MachProduct } from "./MachProductCard";
import { useMachAddToCart } from "./useMachAddToCart";

/**
 * The Mach quick-add control.
 *
 * Extracted from `MachProductCard` when Stacks & Bundles needed the same
 * purchase action. Stacks is not a shelf — `MachStackShowcase` composes its
 * own two-panel feature block and deliberately does not render the shelf card
 * — so the choice was either a second implementation of the add behaviour or
 * one control both surfaces mount. This is that control, and it is the only
 * place the behaviour exists.
 *
 * It carries the whole decision, not just the markup: what the product's
 * option state permits, the cart mutation, the in-place confirmation and the
 * click isolation. A host supplies the product, its destination and the tone
 * of the stage it is standing on, and gets identical behaviour for free.
 *
 * What it renders is decided by the product, never guessed:
 *
 *  - `variantCount === 0` → a button that adds straight to the cart.
 *  - `variantCount > 0`   → the product page requires every option group to be
 *    chosen before it will add anything, so this becomes "Choose options" and
 *    hands off rather than inventing a flavour.
 *  - `variantCount` undefined → the surface that built this product could not
 *    establish its option state, so nothing renders. Silence is correct here;
 *    a wrong cart line is not.
 *  - Sold out → nothing renders, and the host's sold-out veil already covers
 *    the stage.
 *
 * ── Host requirements ─────────────────────────────────────────────────────
 *
 * This positions itself at the lower right of its nearest positioned
 * ancestor, which must be the media stage, and paints at `z-20`. Hosts use a
 * *stretched link* — the product anchor absolutely covering the panel at
 * `z-10` — rather than wrapping their card in an `<a>`: a button (or, for the
 * options case, a second anchor) nested inside an anchor is invalid and does
 * not survive hydration. Stacking them side by side is what lets a press here
 * add to the bag while a press anywhere else opens the product.
 *
 * The host must also carry `group` on the element that should reveal this on
 * hover — the panel root in both current callers.
 */

function safePrice(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** 40px minimum height throughout — this is a touch target on the phone
 * shelves, where it is always visible. Type tightens below `sm` so the
 * control stays a corner action on a 218px card instead of spanning it. */
const BASE =
  "absolute bottom-2.5 right-2.5 z-20 inline-flex min-h-[40px] items-center justify-center gap-1.5 px-2.5 text-[9px] font-bold uppercase leading-none tracking-[0.1em] transition-[background-color,color,opacity,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:bottom-3 sm:right-3 sm:gap-2 sm:px-3 sm:text-[10px] sm:tracking-[0.16em]";

export interface MachQuickAddProps {
  product: MachProduct;
  /** The product page, for the options hand-off. */
  href: string;
  /** Resolved primary image, for the confirmation toast. */
  imageUrl?: string | null;
  /**
   * The control is standing on a charcoal stage and has to invert — a black
   * button on `--mach-ink-raised` would disappear. White stages, which is
   * every other case, keep the black block.
   */
  onCharcoal?: boolean;
}

export function MachQuickAdd({
  product,
  href,
  imageUrl,
  onCharcoal = false,
}: MachQuickAddProps) {
  const { add, confirmed } = useMachAddToCart();

  const price = safePrice(product.price) ?? 0;
  const discount = safePrice(product.discountPrice);
  const hasDiscount = discount != null && discount < price;
  const isSoldOut = !product.available || product.stock <= 0;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // The product link sits underneath this control; without both of these
      // the click would also navigate to the product page.
      e.preventDefault();
      e.stopPropagation();
      if (isSoldOut) return;
      add({
        id: product.id,
        name: product.name,
        price: hasDiscount ? (discount as number) : price,
        originalPrice: hasDiscount ? price : undefined,
        stock: product.stock,
        available: product.available,
        imageUrl,
        categoryName: product.categoryName,
        quantity: 1,
        // Only ever `{}` for a product the backend reported as having no
        // option groups — see the component doc above.
        selectedOptions: {},
      });
    },
    [add, product, price, discount, hasDiscount, imageUrl, isSoldOut],
  );

  // `variantCount` is the backend's count of mandatory option groups;
  // `undefined` means unknown, which withholds the control entirely.
  const variantCount = product.variantCount;
  const mode: "add" | "options" | "none" = isSoldOut
    ? "none"
    : variantCount === undefined
      ? "none"
      : variantCount > 0
        ? "options"
        : "add";

  if (mode === "none") return null;

  const skin = onCharcoal
    ? "bg-white text-[var(--mach-ink)] hover:bg-white/85 focus-visible:ring-white focus-visible:ring-offset-[var(--mach-ink-raised)]"
    : "bg-[var(--mach-ink)] text-white hover:bg-[var(--mach-ink-soft)] focus-visible:ring-[var(--mach-ink)] focus-visible:ring-offset-white";

  // Always on where there is no hover to reveal it; on pointer devices the
  // shelf stays clean until the panel is hovered or something inside it takes
  // focus. A just-confirmed button stays put so the shopper sees the result.
  const reveal = confirmed
    ? "opacity-100 translate-y-0"
    : [
        "opacity-100 translate-y-0",
        "lg:opacity-0 lg:translate-y-1 lg:pointer-events-none",
        "lg:group-hover:opacity-100 lg:group-hover:translate-y-0 lg:group-hover:pointer-events-auto",
        "lg:group-focus-within:opacity-100 lg:group-focus-within:translate-y-0 lg:group-focus-within:pointer-events-auto",
      ].join(" ");

  if (mode === "options") {
    return (
      <a
        href={href}
        aria-label={`Choose options for ${product.name}`}
        className={`${BASE} ${skin} ${reveal}`}>
        Choose options
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Add ${product.name} to bag`}
      className={`${BASE} ${skin} ${reveal}`}>
      {confirmed ? (
        <>
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
          Added
        </>
      ) : (
        <>
          <Plus className="h-3.5 w-3.5" strokeWidth={3} />
          Add to cart
        </>
      )}
    </button>
  );
}
