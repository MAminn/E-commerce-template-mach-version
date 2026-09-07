import { useState, useEffect } from "react";
import { trpc } from "#root/shared/trpc/client";
import { Button } from "#root/components/ui/button";
import { Input } from "#root/components/ui/input";
import { Checkbox } from "#root/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#root/components/ui/dialog";
import { Plus, X, Search, ChevronUp, ChevronDown } from "lucide-react";

/**
 * Picks and orders the categories shown on the homepage.
 *
 * Mirrors HomepageProductPicker so the two controls behave the same way, with
 * one addition it genuinely needs: explicit ordering. Category tiles are large
 * and few, so which one leads the grid is a real merchandising decision — a
 * checkbox list alone would leave that to database insertion order.
 *
 * The category system stays authoritative for names, slugs and artwork; this
 * only stores ids.
 */

interface CategoryOption {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
}

export function HomepageCategoryPicker({
  selectedIds,
  onChange,
  disabled,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [all, setAll] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  useEffect(() => {
    setLoading(true);
    trpc.category.view
      .query()
      .then((res) => {
        if (res.success && Array.isArray(res.result)) {
          setAll(
            (res.result as any[])
              .filter((c) => !c.deleted)
              .map((c) => ({
                id: c.id,
                name: c.name,
                slug: c.slug,
                imageUrl: c.filename ?? null,
              })),
          );
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const byId = new Map(all.map((c) => [c.id, c]));
  const selected = selectedIds
    .map((id) => byId.get(id))
    .filter((c): c is CategoryOption => Boolean(c));

  const move = (index: number, delta: number) => {
    const next = [...selectedIds];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item as string);
    onChange(next);
  };

  const filtered = all.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between'>
        <span className='text-sm font-medium'>
          Featured Categories ({selectedIds.length})
        </span>
        <div className='flex gap-2'>
          {selectedIds.length > 0 && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              disabled={disabled}
              onClick={() => onChange([])}
              className='h-7 text-xs'>
              Clear All
            </Button>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={disabled}
                onClick={() => {
                  setPendingIds([...selectedIds]);
                  setSearch("");
                  setOpen(true);
                }}
                className='h-7 text-xs'>
                <Plus className='mr-1 h-3 w-3' />
                Pick Categories
              </Button>
            </DialogTrigger>
            <DialogContent className='flex max-h-[80vh] max-w-lg flex-col'>
              <DialogHeader>
                <DialogTitle>Select Categories</DialogTitle>
              </DialogHeader>
              <div className='relative'>
                <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground' />
                <Input
                  placeholder='Search categories...'
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className='pl-8'
                />
              </div>
              <div className='min-h-0 max-h-[50vh] flex-1 overflow-y-auto rounded-md border'>
                {loading ? (
                  <div className='p-4 text-center text-sm text-muted-foreground'>
                    Loading categories...
                  </div>
                ) : filtered.length === 0 ? (
                  <div className='p-4 text-center text-sm text-muted-foreground'>
                    No categories found
                  </div>
                ) : (
                  <div className='divide-y'>
                    {filtered.map((category) => (
                      <label
                        key={category.id}
                        className='flex cursor-pointer items-center gap-3 p-2.5 hover:bg-muted/50'>
                        <Checkbox
                          checked={pendingIds.includes(category.id)}
                          onCheckedChange={() =>
                            setPendingIds((prev) =>
                              prev.includes(category.id)
                                ? prev.filter((id) => id !== category.id)
                                : [...prev, category.id],
                            )
                          }
                        />
                        {category.imageUrl && (
                          <img
                            src={
                              category.imageUrl.startsWith("http")
                                ? category.imageUrl
                                : `/uploads/${category.imageUrl}`
                            }
                            alt=''
                            className='h-8 w-8 shrink-0 rounded object-cover'
                          />
                        )}
                        <span className='truncate text-sm font-medium'>
                          {category.name}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className='flex items-center justify-between border-t pt-2'>
                <span className='text-xs text-muted-foreground'>
                  {pendingIds.length} selected
                </span>
                <div className='flex gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    size='sm'
                    onClick={() => {
                      onChange(pendingIds);
                      setOpen(false);
                    }}>
                    Confirm
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {selected.length > 0 ? (
        <ul className='divide-y rounded-md border'>
          {selected.map((category, index) => (
            <li
              key={category.id}
              className='flex items-center gap-3 px-3 py-2'>
              <span className='w-5 shrink-0 text-xs tabular-nums text-muted-foreground'>
                {index + 1}
              </span>
              {category.imageUrl ? (
                <img
                  src={
                    category.imageUrl.startsWith("http")
                      ? category.imageUrl
                      : `/uploads/${category.imageUrl}`
                  }
                  alt=''
                  className='h-8 w-8 shrink-0 rounded object-cover'
                />
              ) : (
                <span className='h-8 w-8 shrink-0 rounded border border-dashed' />
              )}
              <span className='flex-1 truncate text-sm'>{category.name}</span>
              <div className='flex shrink-0 items-center gap-0.5'>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='h-7 w-7'
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move ${category.name} up`}>
                  <ChevronUp className='h-3.5 w-3.5' />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='h-7 w-7'
                  disabled={disabled || index === selected.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${category.name} down`}>
                  <ChevronDown className='h-3.5 w-3.5' />
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  className='h-7 w-7'
                  disabled={disabled}
                  onClick={() =>
                    onChange(selectedIds.filter((id) => id !== category.id))
                  }
                  aria-label={`Remove ${category.name}`}>
                  <X className='h-3.5 w-3.5' />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className='text-xs italic text-muted-foreground'>
          No categories selected — every category marked &ldquo;show on
          landing&rdquo; in Categories will be shown, in their own order.
        </p>
      )}
    </div>
  );
}
