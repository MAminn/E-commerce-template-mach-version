import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "#root/shared/trpc/client";
import { Button } from "#root/components/ui/button";
import { Input } from "#root/components/ui/input";
import { Label } from "#root/components/ui/label";
import { Switch } from "#root/components/ui/switch";
import { Badge } from "#root/components/ui/badge";
import { Separator } from "#root/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#root/components/ui/select";
import type { AdminCountdownState } from "#root/backend/sale-countdown/service";
import {
  DEFAULT_COUNTDOWN_MINUTES,
  MAX_COUNTDOWN_MINUTES,
  formatCountdown,
  saleItemProblems,
  toCents,
  type SaleCountdownStatus,
} from "#root/shared/sale-countdown/countdown";

/**
 * Sale countdown controls, inside Homepage → Promotional Banner.
 *
 * Every control calls the server, which holds the one deadline all visitors
 * see; nothing here is saved with the homepage content. Starting, stopping
 * and expiry never touch the banner text. Setting up sale products never
 * changes a product price — prices change only when a countdown with
 * "Automatically end sale" reaches zero.
 */

type ItemDraft = {
  productId: string;
  name: string;
  price: string;
  discountPrice: string | null;
  deleted: boolean;
  /** As typed; "" = not set. */
  postSalePrice: string;
};

type ProductOption = { id: string; name: string; price: string; discountPrice: string | null };

const STATUS_LABEL: Record<SaleCountdownStatus, string> = {
  inactive: "Inactive",
  running: "Running",
  expired: "Expired",
};

const STATUS_CLASS: Record<SaleCountdownStatus, string> = {
  inactive: "bg-gray-100 text-gray-700 border-gray-200",
  running: "bg-green-100 text-green-800 border-green-200",
  expired: "bg-amber-100 text-amber-800 border-amber-200",
};

const EVENT_LABEL: Record<string, string> = {
  settings_changed: "Settings changed",
  products_changed: "Sale products changed",
  started: "Countdown started",
  expiration_changed: "Expiration changed",
  stopped: "Countdown stopped",
  expired: "Countdown expired",
  sale_end_rolled_back: "Sale end rolled back",
};

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function money(value: string | null): string {
  if (value === null) return "—";
  const cents = toCents(value);
  return cents === null ? value : (cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function eventSummary(event: AdminCountdownState["events"][number]): string {
  const d = event.details as Record<string, unknown>;
  switch (event.type) {
    case "started":
      return `Ends ${formatDateTime(d.endsAt as string)}${d.autoEndSale ? " · ends the sale" : ""}`;
    case "expiration_changed":
      return `${formatDateTime(d.from as string)} → ${formatDateTime(d.to as string)}`;
    case "stopped":
      return String(d.reason ?? "");
    case "expired": {
      const saleEnd = d.saleEnd as { changes?: unknown[]; skipped?: unknown[] } | undefined;
      if (!saleEnd) return "Banner hidden · prices unchanged (automatic sale end was off)";
      return `Sale ended · ${saleEnd.changes?.length ?? 0} price(s) switched to post-sale${
        saleEnd.skipped?.length ? ` · ${saleEnd.skipped.length} skipped` : ""
      }`;
    }
    case "sale_end_rolled_back": {
      const restored = (d.restored as unknown[] | undefined)?.length ?? 0;
      const conflicts = (d.conflicts as unknown[] | undefined)?.length ?? 0;
      return `${restored} price(s) restored${conflicts ? ` · ${conflicts} left alone (edited since)` : ""}`;
    }
    case "settings_changed":
      return Object.keys((d.changes as Record<string, unknown>) ?? {}).join(", ");
    case "products_changed":
      return `${(d.after as unknown[] | undefined)?.length ?? 0} product(s)`;
    default:
      return "";
  }
}

export function SaleCountdownPanel({ bannerEnabled }: { bannerEnabled: boolean }) {
  const [state, setState] = useState<AdminCountdownState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offsetMs, setOffsetMs] = useState(0);
  const [, setTick] = useState(0);

  const [label, setLabel] = useState("");
  const [duration, setDuration] = useState(String(DEFAULT_COUNTDOWN_MINUTES));
  const [schedule, setSchedule] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [itemsDirty, setItemsDirty] = useState(false);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productToAdd, setProductToAdd] = useState<string>("");

  const applyState = useCallback((next: AdminCountdownState, resetDrafts: boolean) => {
    setState(next);
    setOffsetMs(Date.parse(next.serverNow) - Date.now());
    if (resetDrafts) {
      setLabel(next.settings.label);
      setDuration(String(next.settings.durationMinutes));
      setItems(
        next.items.map((i) => ({
          productId: i.productId,
          name: i.name,
          price: i.price,
          discountPrice: i.discountPrice,
          deleted: i.deleted,
          postSalePrice: i.postSalePrice === null ? "" : String(Number(i.postSalePrice)),
        })),
      );
      setItemsDirty(false);
    }
  }, []);

  const load = useCallback(
    async (resetDrafts = true) => {
      try {
        const res = await trpc.saleCountdown.get.query();
        if (!res.success) {
          setLoadError(res.error);
          return;
        }
        setLoadError(null);
        applyState(res.result as AdminCountdownState, resetDrafts);
      } catch {
        setLoadError("Could not load the countdown. Check your connection and reload.");
      }
    },
    [applyState],
  );

  useEffect(() => {
    void load();
    // Every product (hidden ones too) for the sale-product picker.
    void (async () => {
      const all: ProductOption[] = [];
      for (let offset = 0; offset < 1000; offset += 100) {
        const res = await trpc.product.view.query({ limit: 100, offset, includeHidden: true });
        if (!res.success) break;
        const page = res.result.products.map((row: { product: ProductOption }) => ({
          id: row.product.id,
          name: row.product.name.trim(),
          price: row.product.price,
          discountPrice: row.product.discountPrice,
        }));
        all.push(...page);
        if (page.length < 100) break;
      }
      setProducts(all.sort((a, b) => a.name.localeCompare(b.name)));
    })().catch(() => {});
  }, [load]);

  // Live clock while running; re-read the server once it should have expired.
  const status = state?.status ?? "inactive";
  const remainingMs = state?.endsAt ? Date.parse(state.endsAt) - (Date.now() + offsetMs) : 0;
  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);
  const overdue = status === "running" && remainingMs <= 0;
  useEffect(() => {
    if (!overdue) return;
    const id = window.setTimeout(() => void load(false), 1500);
    return () => window.clearTimeout(id);
  }, [overdue, load]);

  const run = async <T,>(
    action: () => Promise<{ success: true; result: T } | { success: false; error: string }>,
    success: string,
    reloadDrafts = false,
  ): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await action();
      if (!res.success) {
        toast.error(res.error);
        return false;
      }
      toast.success(success);
      await load(reloadDrafts);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const draftProblems = useMemo(
    () =>
      saleItemProblems(
        items.map((i) => ({
          productId: i.productId,
          name: i.name,
          postSalePrice: i.postSalePrice.trim() === "" ? null : i.postSalePrice.trim(),
          listPrice: i.price,
          deleted: i.deleted,
        })),
      ),
    [items],
  );

  if (loadError && !state) {
    return (
      <div className='rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700'>
        {loadError}
      </div>
    );
  }
  if (!state) {
    return <p className='text-sm text-muted-foreground'>Loading sale countdown…</p>;
  }

  const { settings } = state;
  const running = status === "running";
  const durationNumber = Number(duration);
  const durationValid =
    Number.isInteger(durationNumber) && durationNumber >= 1 && durationNumber <= MAX_COUNTDOWN_MINUTES;
  const settingsDirty =
    label.trim() !== settings.label || (durationValid && durationNumber !== settings.durationMinutes);
  const autoEndBlocked = state.autoEndProblems.length > 0;
  const inSale = new Set(items.map((i) => i.productId));
  const addable = products.filter((p) => !inSale.has(p.id));
  const discountedAddable = addable.filter((p) => p.discountPrice !== null);

  const saveSettings = (patch: Parameters<typeof trpc.saleCountdown.updateSettings.mutate>[0], message: string) =>
    run(() => trpc.saleCountdown.updateSettings.mutate(patch), message);

  const updateItem = (productId: string, patch: Partial<ItemDraft>) => {
    setItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, ...patch } : i)));
    setItemsDirty(true);
  };

  const addProducts = (options: ProductOption[]) => {
    if (options.length === 0) return;
    setItems((prev) => [
      ...prev,
      ...options.map((p) => ({
        productId: p.id,
        name: p.name,
        price: p.price,
        discountPrice: p.discountPrice,
        deleted: false,
        postSalePrice: "", // never pre-filled: the admin decides every post-sale price
      })),
    ]);
    setItemsDirty(true);
  };

  const saveItems = () => {
    for (const i of items) {
      const value = i.postSalePrice.trim();
      if (value !== "" && !(Number(value) > 0)) {
        toast.error(`${i.name}: enter a post-sale price above 0, or leave it empty.`);
        return;
      }
    }
    void run(
      () =>
        trpc.saleCountdown.setItems.mutate({
          items: items.map((i) => ({
            productId: i.productId,
            postSalePrice: i.postSalePrice.trim() === "" ? null : Number(i.postSalePrice),
          })),
        }),
      "Sale products saved. No product price was changed.",
      true,
    );
  };

  const start = () => {
    if (!durationValid) {
      toast.error("Enter a duration in whole minutes.");
      return;
    }
    const ends = new Date(Date.now() + offsetMs + durationNumber * 60_000);
    const message = settings.autoEndSale
      ? `Start a ${durationNumber}-minute countdown for every visitor now?\n\nAt ${ends.toLocaleString()} it ends the sale: ${state.items.length} product price(s) switch to their post-sale prices automatically.`
      : `Start a ${durationNumber}-minute countdown for every visitor now?\n\nIt ends at ${ends.toLocaleString()}. Automatic sale end is OFF, so no price will change.`;
    if (!window.confirm(message)) return;
    void run(
      () => trpc.saleCountdown.start.mutate({ mode: "duration", durationMinutes: durationNumber }),
      "Countdown started.",
    );
  };

  const startOrReschedule = () => {
    const endsAt = schedule ? new Date(schedule) : null;
    if (!endsAt || Number.isNaN(endsAt.getTime())) {
      toast.error("Pick an expiration date and time.");
      return;
    }
    if (running) {
      if (!window.confirm(`Change the expiration for every visitor to ${endsAt.toLocaleString()}?`)) return;
      void run(
        () => trpc.saleCountdown.updateExpiration.mutate({ endsAt }),
        "Expiration updated.",
      );
      return;
    }
    const message = settings.autoEndSale
      ? `Start a countdown to ${endsAt.toLocaleString()} for every visitor now?\n\nAt that time it ends the sale: ${state.items.length} product price(s) switch to their post-sale prices automatically.`
      : `Start a countdown to ${endsAt.toLocaleString()} for every visitor now?\n\nAutomatic sale end is OFF, so no price will change.`;
    if (!window.confirm(message)) return;
    void run(() => trpc.saleCountdown.start.mutate({ mode: "until", endsAt }), "Countdown started.");
  };

  const stop = () => {
    if (!window.confirm("Stop the countdown now? It disappears for every visitor. No price changes.")) return;
    void run(() => trpc.saleCountdown.stop.mutate(), "Countdown stopped.");
  };

  const rollback = (eventId: string) => {
    if (
      !window.confirm(
        "Roll back the last automatic sale end?\n\nEach product it changed gets its sale discount price back — unless that product's price was edited since, in which case it is left alone. The countdown stays off.",
      )
    )
      return;
    void run(() => trpc.saleCountdown.rollbackSaleEnd.mutate({ eventId }), "Sale end rolled back.");
  };

  return (
    <div className='space-y-5' data-sale-countdown-admin=''>
      <Separator />

      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h3 className='text-base font-semibold'>Sale Countdown</h3>
          <p className='mt-1 text-sm text-muted-foreground'>
            Adds &ldquo;{(label || settings.label).toUpperCase()} 00:59:59&rdquo; to this banner. Every
            visitor counts down to the same server deadline, so refreshing or switching devices never
            restarts it. It disappears by itself when it reaches zero.
          </p>
        </div>
        <Badge
          variant='outline'
          data-countdown-status={status}
          className={`shrink-0 text-sm ${STATUS_CLASS[status]}`}>
          {STATUS_LABEL[status]}
          {running && remainingMs > 0 && (
            <span className='ml-1 tabular-nums'>· {formatCountdown(remainingMs)}</span>
          )}
        </Badge>
      </div>

      {!bannerEnabled && (
        <div className='rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700'>
          ⚠️ The Promotional Banner above is switched off (or not saved), so the countdown cannot be seen
          even while it runs.
        </div>
      )}

      <div className='rounded-md border p-3 text-sm'>
        {running && (
          <p>
            Running — ends <strong>{formatDateTime(state.endsAt)}</strong>
            {settings.autoEndSale ? " and then ends the sale automatically." : ". Prices will not change."}
          </p>
        )}
        {status === "expired" && (
          <p>
            Expired at <strong>{formatDateTime(state.expiredAt ?? state.endsAt)}</strong>.
            {state.saleEndedAt ? " The sale was ended automatically." : " Prices were not changed."}
          </p>
        )}
        {status === "inactive" && <p>Not running.</p>}
      </div>

      <div className='flex items-center justify-between gap-3'>
        <div>
          <Label htmlFor='countdown-enabled'>Enable countdown</Label>
          <p className='text-xs text-muted-foreground'>Turning this off also stops a running countdown.</p>
        </div>
        <Switch
          id='countdown-enabled'
          checked={settings.enabled}
          disabled={busy}
          onCheckedChange={(checked) => {
            if (!checked && running && !window.confirm("Disable and stop the running countdown? No price changes.")) return;
            void saveSettings({ enabled: checked }, checked ? "Countdown enabled." : "Countdown disabled.");
          }}
        />
      </div>

      <div className='grid gap-4 sm:grid-cols-2'>
        <div>
          <Label htmlFor='countdown-label'>Countdown text</Label>
          <Input
            id='countdown-label'
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='Sale ends in'
          />
        </div>
        <div>
          <Label htmlFor='countdown-duration'>Countdown duration (minutes)</Label>
          <Input
            id='countdown-duration'
            type='number'
            min={1}
            max={MAX_COUNTDOWN_MINUTES}
            step={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
      </div>
      {settingsDirty && (
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={busy || !label.trim() || !durationValid}
          onClick={() =>
            void saveSettings(
              { label: label.trim(), durationMinutes: durationNumber },
              "Countdown settings saved.",
            )
          }>
          Save countdown text &amp; duration
        </Button>
      )}

      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          disabled={busy || !settings.enabled || running || !durationValid}
          onClick={start}>
          Start {durationValid ? `${durationNumber}-minute ` : ""}countdown
        </Button>
        <Button type='button' variant='outline' disabled={busy || !running} onClick={stop}>
          Stop countdown
        </Button>
      </div>
      {!settings.enabled && (
        <p className='text-xs text-muted-foreground'>Enable the countdown to start it.</p>
      )}

      <div>
        <Label htmlFor='countdown-schedule'>Scheduled expiration date &amp; time</Label>
        <div className='mt-1 flex flex-wrap gap-2'>
          <Input
            id='countdown-schedule'
            type='datetime-local'
            className='w-auto'
            value={schedule}
            min={toLocalInput(new Date(Date.now() + offsetMs + 60_000))}
            onChange={(e) => setSchedule(e.target.value)}
          />
          <Button
            type='button'
            variant='outline'
            disabled={busy || !settings.enabled || !schedule}
            onClick={startOrReschedule}>
            {running ? "Update expiration" : "Start countdown until this time"}
          </Button>
        </div>
        <p className='mt-1 text-xs text-muted-foreground'>
          In your computer&rsquo;s time zone. While running, this moves the deadline for everyone.
        </p>
      </div>

      <Separator />

      <div className='flex items-center justify-between gap-3'>
        <div>
          <Label htmlFor='countdown-auto-end'>Automatically end sale</Label>
          <p className='text-xs text-muted-foreground'>
            At zero, switch every sale product below to its post-sale price. Off = the countdown only
            hides; no price changes.
          </p>
        </div>
        <Switch
          id='countdown-auto-end'
          checked={settings.autoEndSale}
          disabled={busy || (!settings.autoEndSale && (autoEndBlocked || itemsDirty))}
          onCheckedChange={(checked) =>
            void saveSettings(
              { autoEndSale: checked },
              checked ? "Automatic sale end on." : "Automatic sale end off — no price will change at expiry.",
            )
          }
        />
      </div>
      {!settings.autoEndSale && (autoEndBlocked || itemsDirty) && (
        <div className='rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800'>
          <p className='font-medium'>
            {itemsDirty
              ? "Save the sale products first."
              : "Automatic sale end can't be turned on yet:"}
          </p>
          {!itemsDirty && (
            <ul className='mt-1 list-disc pl-5'>
              {state.autoEndProblems.slice(0, 8).map((p) => (
                <li key={p}>{p}</li>
              ))}
              {state.autoEndProblems.length > 8 && <li>…and {state.autoEndProblems.length - 8} more.</li>}
            </ul>
          )}
        </div>
      )}

      <div className='space-y-3'>
        <div>
          <h4 className='text-sm font-semibold'>Sale products</h4>
          <p className='text-xs text-muted-foreground'>
            The products whose price changes when the sale ends, and what each one costs afterwards.
            Saving this list changes no price. Products not listed are never touched.
          </p>
        </div>

        {items.length > 0 && (
          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full min-w-[560px] text-sm'>
              <thead className='bg-muted/50 text-left text-xs uppercase text-muted-foreground'>
                <tr>
                  <th className='px-3 py-2'>Product</th>
                  <th className='px-3 py-2'>List price</th>
                  <th className='px-3 py-2'>Price now</th>
                  <th className='px-3 py-2'>Post-sale price</th>
                  <th className='px-3 py-2' />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const missing = i.postSalePrice.trim() === "";
                  return (
                    <tr key={i.productId} className='border-t' data-sale-item={i.productId}>
                      <td className='px-3 py-2'>
                        {i.name}
                        {i.deleted && <span className='ml-1 text-xs text-red-600'>(deleted)</span>}
                      </td>
                      <td className='px-3 py-2 tabular-nums'>{money(i.price)}</td>
                      <td className='px-3 py-2 tabular-nums'>{money(i.discountPrice ?? i.price)}</td>
                      <td className='px-3 py-2'>
                        <div className='flex items-center gap-2'>
                          <Input
                            aria-label={`Post-sale price for ${i.name}`}
                            type='number'
                            min={0.01}
                            step='0.01'
                            className={`h-8 w-28 ${missing ? "border-amber-400" : ""}`}
                            placeholder='Not set'
                            value={i.postSalePrice}
                            onChange={(e) => updateItem(i.productId, { postSalePrice: e.target.value })}
                          />
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='h-8 px-2 text-xs'
                            onClick={() => updateItem(i.productId, { postSalePrice: String(Number(i.price)) })}>
                            Use list price
                          </Button>
                        </div>
                      </td>
                      <td className='px-3 py-2 text-right'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          className='h-8 px-2 text-xs text-red-600'
                          onClick={() => {
                            setItems((prev) => prev.filter((x) => x.productId !== i.productId));
                            setItemsDirty(true);
                          }}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className='flex flex-wrap items-center gap-2'>
          <Select value={productToAdd} onValueChange={setProductToAdd}>
            <SelectTrigger className='w-72 max-w-full'>
              <SelectValue placeholder='Add a product…' />
            </SelectTrigger>
            <SelectContent>
              {addable.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} — {money(p.discountPrice ?? p.price)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={!productToAdd}
            onClick={() => {
              addProducts(addable.filter((p) => p.id === productToAdd));
              setProductToAdd("");
            }}>
            Add
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={discountedAddable.length === 0}
            onClick={() => addProducts(discountedAddable)}>
            Add all discounted products ({discountedAddable.length})
          </Button>
        </div>

        {itemsDirty && (
          <div className='flex flex-wrap items-center gap-3'>
            <Button type='button' size='sm' disabled={busy} onClick={saveItems}>
              Save sale products
            </Button>
            <Button type='button' variant='ghost' size='sm' disabled={busy} onClick={() => void load(true)}>
              Discard changes
            </Button>
            {draftProblems.length > 0 && (
              <span className='text-xs text-amber-700'>
                {draftProblems.length} problem(s) — fine to save, but automatic sale end stays blocked.
              </span>
            )}
          </div>
        )}
      </div>

      {state.events.length > 0 && (
        <div className='space-y-2'>
          <h4 className='text-sm font-semibold'>Activity</h4>
          <ul className='divide-y rounded-md border text-sm'>
            {state.events.slice(0, 12).map((e) => (
              <li key={e.id} className='flex flex-wrap items-center justify-between gap-2 px-3 py-2'>
                <div className='min-w-0'>
                  <span className='font-medium'>{EVENT_LABEL[e.type] ?? e.type}</span>
                  <span className='text-muted-foreground'> · {eventSummary(e)}</span>
                  <div className='text-xs text-muted-foreground'>
                    {formatDateTime(e.createdAt)} · {e.actor}
                  </div>
                </div>
                {e.id === state.rollbackableEventId && !running && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={busy}
                    onClick={() => rollback(e.id)}>
                    Roll back price changes
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
