import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Plus,
  Replace,
  Search,
  Trash2,
} from "lucide-react";
import { trpc } from "#root/shared/trpc/client";
import { STORE_CURRENCY } from "#root/shared/config/branding";
import { LANDING_MAX_PRODUCTS } from "#root/shared/landing-page/config";
import { Button } from "#root/components/ui/button";
import { Checkbox } from "#root/components/ui/checkbox";
import { Input } from "#root/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#root/components/ui/dialog";
import {
  addProducts,
  moveProduct,
  removeProduct,
  replaceProduct,
} from "./product-list";

/** One catalogue row as the editor shows it. */
export interface EditorProduct {
  id: string;
  name: string;
  price: string;
  discountPrice: string | null;
  stock: number;
  imageUrl: string | null;
  hidden: boolean;
}

function imageSrc(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith("http") || url.startsWith("/") ? url : `/uploads/${url}`;
}

function PriceLine({ product }: { product: EditorProduct }) {
  const price = Number(product.price);
  const discount =
    product.discountPrice != null ? Number(product.discountPrice) : null;
  const onSale = discount != null && discount < price;
  return (
    <span className='text-xs text-muted-foreground'>
      {onSale ? (
        <>
          <span className='line-through'>
            {STORE_CURRENCY} {price.toFixed(2)}
          </span>{" "}
          <span className='font-medium text-foreground'>
            {STORE_CURRENCY} {discount.toFixed(2)}
          </span>
        </>
      ) : (
        `${STORE_CURRENCY} ${price.toFixed(2)}`
      )}
    </span>
  );
}

/** Why a selected product will not look normal on the page, if it won't. */
function statusOf(product: EditorProduct | undefined): string | null {
  if (!product) return "Deleted from the catalogue — remove it";
  if (product.hidden) return "Hidden in the store — not shown on the page";
  if (product.stock <= 0) return "Out of stock — shown as sold out";
  return null;
}

type PickerMode = { kind: "add" } | { kind: "replace"; id: string };

export function LandingProductsEditor({
  productIds,
  known,
  onChange,
  onLearn,
  disabled = false,
}: {
  productIds: string[];
  /** Catalogue rows for every id the editor has seen, keyed by id. */
  known: Record<string, EditorProduct>;
  onChange: (ids: string[]) => void;
  /** Hands back rows picked from the catalogue so they can be displayed. */
  onLearn: (products: EditorProduct[]) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<PickerMode | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<EditorProduct[]>([]);
  const [loading, setLoading] = useState(false);
  // Rows, not ids: a product ticked before the search changes is no longer
  // in `results`, and still has to be displayed once added.
  const [picked, setPicked] = useState<EditorProduct[]>([]);

  // Server-side search, so a catalogue past the 50-row page is still
  // reachable. Hidden and deleted products are never offered.
  useEffect(() => {
    if (!mode) return;
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      trpc.product.search
        .query({
          limit: 50,
          includeOutOfStock: true,
          search: search.trim() || undefined,
        })
        .then((res) => {
          if (cancelled || !res.success || !res.result) return;
          setResults(
            res.result.items.map((item) => ({
              id: item.id,
              name: item.name,
              price: String(item.price),
              discountPrice:
                item.discountPrice != null ? String(item.discountPrice) : null,
              stock: item.stock,
              imageUrl: item.imageUrl,
              hidden: false,
            })),
          );
        })
        .catch((err) => console.error("Product search failed:", err))
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, search]);

  const open = (next: PickerMode) => {
    setSearch("");
    setPicked([]);
    setMode(next);
  };

  const room = LANDING_MAX_PRODUCTS - productIds.length;

  const confirmAdd = () => {
    onLearn(picked);
    onChange(
      addProducts(
        productIds,
        picked.map((p) => p.id),
      ),
    );
    setMode(null);
  };

  const replaceWith = (product: EditorProduct) => {
    if (mode?.kind !== "replace") return;
    onLearn([product]);
    onChange(replaceProduct(productIds, mode.id, product.id));
    setMode(null);
  };

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-sm font-medium'>
          Products on the page ({productIds.length}/{LANDING_MAX_PRODUCTS})
        </span>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled || room <= 0}
          onClick={() => open({ kind: "add" })}>
          <Plus className='mr-1 h-3.5 w-3.5' /> Add products
        </Button>
      </div>

      {productIds.length === 0 ? (
        <p className='rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground'>
          No products selected — the page shows only the hero until you add
          some.
        </p>
      ) : (
        <ol className='divide-y rounded-md border'>
          {productIds.map((id, index) => {
            const product = known[id];
            const status = statusOf(product);
            const src = imageSrc(product?.imageUrl ?? null);
            return (
              <li
                key={id}
                data-testid='landing-product-row'
                className='flex items-center gap-3 p-2.5'>
                <span className='w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground'>
                  {index + 1}
                </span>
                {src ? (
                  <img
                    src={src}
                    alt=''
                    className='h-10 w-10 shrink-0 rounded bg-white object-contain'
                  />
                ) : (
                  <div className='h-10 w-10 shrink-0 rounded bg-muted' />
                )}
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-sm font-medium'>
                    {product?.name ?? "Unknown product"}
                  </p>
                  {product && <PriceLine product={product} />}
                  {status && (
                    <p className='text-xs text-amber-600 dark:text-amber-400'>
                      {status}
                    </p>
                  )}
                </div>
                <div className='flex shrink-0 items-center gap-0.5'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8'
                    aria-label={`Move ${product?.name ?? "product"} up`}
                    disabled={disabled || index === 0}
                    onClick={() =>
                      onChange(moveProduct(productIds, index, index - 1))
                    }>
                    <ArrowUp className='h-3.5 w-3.5' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8'
                    aria-label={`Move ${product?.name ?? "product"} down`}
                    disabled={disabled || index === productIds.length - 1}
                    onClick={() =>
                      onChange(moveProduct(productIds, index, index + 1))
                    }>
                    <ArrowDown className='h-3.5 w-3.5' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8'
                    aria-label={`Replace ${product?.name ?? "product"}`}
                    disabled={disabled}
                    onClick={() => open({ kind: "replace", id })}>
                    <Replace className='h-3.5 w-3.5' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-8 w-8 text-destructive'
                    aria-label={`Remove ${product?.name ?? "product"}`}
                    disabled={disabled}
                    onClick={() => onChange(removeProduct(productIds, id))}>
                    <Trash2 className='h-3.5 w-3.5' />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className='flex max-h-[85vh] max-w-lg flex-col'>
          <DialogHeader>
            <DialogTitle>
              {mode?.kind === "replace" ? "Replace product" : "Add products"}
            </DialogTitle>
            <DialogDescription>
              {mode?.kind === "replace"
                ? "Pick the product that takes this position."
                : `Products are added at the end of the list. Room for ${room} more.`}
            </DialogDescription>
          </DialogHeader>
          <div className='relative'>
            <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground' />
            <Input
              placeholder='Search the catalogue…'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='pl-8'
              autoFocus
            />
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto rounded-md border'>
            {loading && results.length === 0 ? (
              <div className='flex justify-center p-6'>
                <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
              </div>
            ) : results.length === 0 ? (
              <p className='p-4 text-center text-sm text-muted-foreground'>
                No products found
              </p>
            ) : (
              <ul className='divide-y'>
                {results.map((product) => {
                  const already = productIds.includes(product.id);
                  const src = imageSrc(product.imageUrl);
                  const body = (
                    <>
                      {src ? (
                        <img
                          src={src}
                          alt=''
                          className='h-9 w-9 shrink-0 rounded bg-white object-contain'
                        />
                      ) : (
                        <div className='h-9 w-9 shrink-0 rounded bg-muted' />
                      )}
                      <div className='min-w-0 flex-1 text-left'>
                        <p className='truncate text-sm font-medium'>
                          {product.name}
                        </p>
                        <PriceLine product={product} />
                        {product.stock <= 0 && (
                          <span className='ml-2 text-xs text-amber-600'>
                            Out of stock
                          </span>
                        )}
                      </div>
                    </>
                  );

                  if (mode?.kind === "replace") {
                    return (
                      <li key={product.id}>
                        <button
                          type='button'
                          onClick={() => replaceWith(product)}
                          className='flex w-full items-center gap-3 p-2.5 hover:bg-muted/50'>
                          {body}
                          {already && (
                            <span className='text-xs text-muted-foreground'>
                              On page
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  }

                  const isPicked = picked.some((p) => p.id === product.id);
                  const checked = already || isPicked;
                  const full =
                    !checked && productIds.length + picked.length >= LANDING_MAX_PRODUCTS;
                  return (
                    <li key={product.id}>
                      <label
                        className={`flex items-center gap-3 p-2.5 ${
                          already || full
                            ? "cursor-not-allowed opacity-60"
                            : "cursor-pointer hover:bg-muted/50"
                        }`}>
                        <Checkbox
                          checked={checked}
                          disabled={already || full}
                          onCheckedChange={() =>
                            setPicked((prev) =>
                              isPicked
                                ? prev.filter((p) => p.id !== product.id)
                                : [...prev, product],
                            )
                          }
                        />
                        {body}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {mode?.kind === "add" && (
            <DialogFooter className='items-center gap-2 sm:justify-between'>
              <span className='text-xs text-muted-foreground'>
                {picked.length} selected
              </span>
              <div className='flex gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setMode(null)}>
                  Cancel
                </Button>
                <Button
                  type='button'
                  size='sm'
                  disabled={picked.length === 0}
                  onClick={confirmAdd}>
                  Add {picked.length || ""}
                </Button>
              </div>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
