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
 * This positions itself against its nearest positioned ancestor, which must
 * be the media stage, and paints at `z-20` — at the lower right by default, or
 * across the stage foot when the host asks for `placement="bar"`. Hosts use a
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

const BASE =
  "absolute z-20 inline-flex items-center justify-center font-bold uppercase leading-none transition-[background-color,color,opacity,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Corner block — the shelf treatment, and the default everywhere.
 *
 * 40px minimum height throughout: this is a touch target on the phone
 * shelves, where it is always visible. Type tightens below `sm` so the
 * control stays a corner action on a 218px card instead of spanning it.
 */
const PLACE_CORNER =
  "bottom-2.5 right-2.5 min-h-[40px] gap-1.5 px-2.5 text-[9px] tracking-[0.1em] sm:bottom-3 sm:right-3 sm:gap-2 sm:px-3 sm:text-[10px] sm:tracking-[0.16em]";

/**
 * Stage-foot bar — the shop-grid treatment.
 *
 * A full-width bar seated on the foot of the media stage from `lg` up, where
 * it rests hidden below the stage edge and slides into view on hover or focus.
 * Below `lg` there is no hover to reveal it with, so it is a permanently
 * visible corner block — but a *lighter* one than the shelves use, and this is
 * why it no longer derives from `PLACE_CORNER`.
 *
 * ── Why the phone block is smaller than the shelf block ───────────────────
 *
 * A shelf shows four products in a horizontal scroller: the eye meets one
 * quick-add at a time, so it can afford to be emphatic. A browsing grid stacks
 * two per row for as far as the shopper scrolls, and at the shelf's weight
 * that becomes a checkerboard of identical black blocks marching down the
 * page — the control stops reading as an action and starts reading as part of
 * the card template. Trimming the height, the padding, the icon and (via the
 * host) the label takes roughly half the area out of each block, which is what
 * breaks up the rhythm.
 *
 * ── Why the painted block and the touch target are different sizes ────────
 *
 * The block paints at 36px but is pressed at 44px: an `::after` overlay with
 * no fill stretches the hit area 4px above and below it. That is the whole
 * point of doing it this way — the visual weight is what had to come down, and
 * the touch target is what must not, so they are decoupled rather than traded
 * off against each other. The overlay is a child of the button, so a press
 * anywhere in it is a press on the button; it sits at `z-20` with its host, so
 * it still wins over the card's stretched product link underneath; and it
 * stays inside the stage, because the block is inset 8px from an edge it only
 * overhangs by 4px.
 *
 * From `lg` the bar is a 44px band already, so the overlay is switched off
 * rather than left to duplicate it.
 *
 * The bar lives *inside* the stage, so it costs the card no height and needs
 * no reserved space under the photo — the reason a browsing grid can afford a
 * larger, more obvious control on the desktop it does have hover on. Its host
 * clips it: the stage already carries `overflow-hidden`, which is what hides
 * the resting position.
 */
const PLACE_BAR =
  "bottom-2 right-2 min-h-[36px] gap-1 px-2.5 text-[9px] tracking-[0.08em] " +
  // Invisible 44px hit area over the 36px block. See the note above.
  "after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[''] " +
  "sm:bottom-2.5 sm:right-2.5 sm:min-h-[38px] sm:gap-1.5 sm:px-3 sm:text-[10px] sm:tracking-[0.14em] " +
  "lg:inset-x-0 lg:bottom-0 lg:right-auto lg:h-11 lg:min-h-0 lg:w-full lg:gap-2 lg:px-4 lg:text-[10px] lg:tracking-[0.18em] lg:after:content-none lg:focus-visible:ring-offset-0";

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
  /**
   * Where the control sits on the stage. `"corner"` is the shelf treatment
   * and the default — every existing caller keeps it unchanged. `"bar"` is
   * the shop grid's: same behaviour, seated across the foot of the stage on
   * pointer-sized screens.
   */
  placement?: "corner" | "bar";
}

export function MachQuickAdd({
  product,
  href,
  imageUrl,
  onCharcoal = false,
  placement = "corner",
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

  const isBar = placement === "bar";
  const place = isBar ? PLACE_BAR : PLACE_CORNER;

  // Always on where there is no hover to reveal it; on pointer devices the
  // shelf stays clean until the panel is hovered or something inside it takes
  // focus. A just-confirmed button stays put so the shopper sees the result.
  //
  // The corner block lifts a pixel into place; the bar travels its own height,
  // which is what seats it on the stage foot rather than floating it there.
  const restShift = isBar ? "lg:translate-y-full" : "lg:translate-y-1";
  const reveal = confirmed
    ? "opacity-100 translate-y-0"
    : [
        "opacity-100 translate-y-0",
        `lg:opacity-0 ${restShift} lg:pointer-events-none`,
        "lg:group-hover:opacity-100 lg:group-hover:translate-y-0 lg:group-hover:pointer-events-auto",
        "lg:group-focus-within:opacity-100 lg:group-focus-within:translate-y-0 lg:group-focus-within:pointer-events-auto",
      ].join(" ");

  if (mode === "options") {
    return (
      <a
        href={href}
        aria-label={`Choose options for ${product.name}`}
        className={`${BASE} ${place} ${skin} ${reveal}`}>
        Choose options
      </a>
    );
  }

  // 12px on the phone bar, 14px everywhere else — the glyph is half the
  // block's ink at this size, so it has to come down with the rest of it.
  const iconCls = isBar ? "h-3 w-3 lg:h-3.5 lg:w-3.5" : "h-3.5 w-3.5";

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Add ${product.name} to bag`}
      className={`${BASE} ${place} ${skin} ${reveal}`}>
      {confirmed ? (
        <>
          <Check className={iconCls} strokeWidth={3} />
          Added
        </>
      ) : (
        <>
          <Plus className={iconCls} strokeWidth={3} />
          {/* The shop's phone block says ADD; its desktop bar, which has the
              width for it, still says ADD TO CART. Same action, same handler,
              same accessible name — `aria-label` above carries the full
              "Add <product> to bag" at every width, so the short label is
              never the only thing describing the control. Shelves and the
              product page keep the full label at every width. */}
          {isBar ? (
            <>
              <span className="lg:hidden">Add</span>
              <span className="hidden lg:inline">Add to cart</span>
            </>
          ) : (
            "Add to cart"
          )}
        </>
      )}
    </button>
  );
}
