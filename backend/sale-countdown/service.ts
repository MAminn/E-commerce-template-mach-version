import type { DatabaseClient } from "#root/shared/database/drizzle/db";
import {
  product,
  saleCountdown,
  saleCountdownEvent,
  saleCountdownItem,
  type SaleCountdownEventRow,
  type SaleCountdownRow,
} from "#root/shared/database/drizzle/schema";
import { ServerError } from "#root/shared/error/server";
import {
  DEFAULT_COUNTDOWN_LABEL,
  DEFAULT_COUNTDOWN_MINUTES,
  MAX_COUNTDOWN_LABEL_LENGTH,
  MAX_COUNTDOWN_MINUTES,
  effectiveCountdownStatus,
  postSaleDiscountPrice,
  saleItemProblems,
  toCents,
  type PublicSaleCountdown,
  type SaleCountdownStatus,
} from "#root/shared/sale-countdown/countdown";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { z } from "zod";
import { noteSaleCountdownState } from "./deadline-cache";

/**
 * Sale countdown: one store-wide deadline shown in the top promotional banner
 * and, optionally, the automatic end of a sale when it reaches zero.
 *
 * Expiry is ONE transaction (finalizeDueSaleCountdown): it locks the countdown
 * row, re-checks that the run is still due, switches every configured sale
 * product to its explicit post-sale price, records the before/after prices in
 * the audit trail and marks the run expired — all or nothing, and a second
 * caller finds the run already expired and does nothing. It is triggered from
 * three places, so no single one has to be on time:
 *   - a 1-second in-process ticker (worker.ts);
 *   - every HTTP request once this process knows the deadline passed;
 *   - checkout and online-payment start, which read the database directly
 *     and refuse to price a cart while a due expiry is still pending
 *     (assertNoPendingSaleExpiry), so an expired discount can never be
 *     charged even if the other two lag or fail.
 *
 * Lock order is always countdown row → product rows. Checkout runs the expiry
 * BEFORE its own transaction locks product rows, never inside it, so the two
 * cannot deadlock.
 */

export const COUNTDOWN_ID = "default";
export const SYSTEM_ACTOR = "system";

type Tx = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type SelectClient = Pick<DatabaseClient, "select">;

function fail(clientMessage: string, statusCode = 400): never {
  throw new ServerError({ tag: "SaleCountdown", statusCode, clientMessage, message: clientMessage });
}

const DEFAULT_ROW: Omit<SaleCountdownRow, "updatedAt"> & { updatedAt: Date | null } = {
  id: COUNTDOWN_ID,
  enabled: false,
  durationMinutes: DEFAULT_COUNTDOWN_MINUTES,
  label: DEFAULT_COUNTDOWN_LABEL,
  status: "inactive",
  runId: null,
  startedAt: null,
  endsAt: null,
  autoEndSale: false,
  expiredAt: null,
  saleEndedAt: null,
  updatedAt: null,
  updatedBy: null,
};

// Deploy safety: the boot migration runner logs a failed migration and starts
// the server anyway. If 0065 had not applied, reading sale_countdown inside a
// checkout transaction would raise "relation does not exist" and abort that
// transaction — breaking every checkout. So the table's existence is checked
// with to_regclass (which never errors) until it is seen once; without the
// table no countdown can exist, so "none" is the correct answer.
let tableSeen = false;
let tableCheckedAt = 0;
const TABLE_RECHECK_MS = 30_000;

async function countdownTableExists(client: SelectClient): Promise<boolean> {
  if (tableSeen) return true;
  if (tableCheckedAt && Date.now() - tableCheckedAt < TABLE_RECHECK_MS) return false;
  const [probe] = await client
    .select({ exists: sql<boolean>`to_regclass('public.sale_countdown') is not null` })
    .from(sql`(select 1) as probe`);
  tableCheckedAt = Date.now();
  tableSeen = probe?.exists === true;
  return tableSeen;
}

/** Tests only. */
export function resetCountdownTableCheck(): void {
  tableSeen = false;
  tableCheckedAt = 0;
}

export async function readCountdown(client: SelectClient): Promise<SaleCountdownRow | null> {
  if (!(await countdownTableExists(client))) return null;
  const [row] = await client
    .select()
    .from(saleCountdown)
    .where(eq(saleCountdown.id, COUNTDOWN_ID))
    .limit(1);
  return row ?? null;
}

/** A stored "running" run whose deadline has passed and is not finalized yet. */
function isDue(row: SaleCountdownRow | null | undefined, now: Date): row is SaleCountdownRow {
  return (
    !!row && row.status === "running" && !!row.endsAt && row.endsAt.getTime() <= now.getTime()
  );
}

// ─── Expiry ──────────────────────────────────────────────────────────────────

export interface SalePriceChange {
  productId: string;
  name: string;
  before: { price: string; discountPrice: string | null };
  after: { discountPrice: string | null };
  postSalePrice: string;
  /** The post-sale price was above the (since lowered) list price, so the
   * list price applies instead — never more than the list price. */
  cappedAtListPrice?: boolean;
}

export interface SaleEndDetails {
  changes: SalePriceChange[];
  skipped: Array<{ productId: string; name: string; reason: string }>;
}

export type FinalizeResult =
  | { finalized: false }
  | { finalized: true; runId: string | null; saleEnded: boolean; changed: number; eventId: string };

/**
 * Finalize the countdown if its deadline has passed. Safe to call any number
 * of times from any number of processes: only the first caller after the
 * deadline changes anything. Throws if the database fails — callers that
 * price carts must treat that as "do not sell".
 */
export async function finalizeDueSaleCountdown(
  client: DatabaseClient,
  now: Date = new Date(),
): Promise<FinalizeResult> {
  // Cheap unlocked check first: the common case is "nothing due".
  if (!isDue(await readCountdown(client), now)) return { finalized: false };

  const result = await client.transaction(async (tx): Promise<FinalizeResult> => {
    const [locked] = await tx
      .select()
      .from(saleCountdown)
      .where(eq(saleCountdown.id, COUNTDOWN_ID))
      .for("update");
    // Another caller finalized it (or an admin stopped / extended it) while
    // this one waited for the lock.
    if (!isDue(locked, now)) return { finalized: false };

    let saleEnd: SaleEndDetails | null = null;
    if (locked.autoEndSale) saleEnd = await applyPostSalePrices(tx, now);

    const eventId = v7();
    await tx.insert(saleCountdownEvent).values({
      id: eventId,
      runId: locked.runId,
      type: "expired",
      actor: SYSTEM_ACTOR,
      details: {
        endsAt: locked.endsAt?.toISOString() ?? null,
        finalizedAt: now.toISOString(),
        autoEndSale: locked.autoEndSale,
        ...(saleEnd ? { saleEnd } : {}),
      },
    });

    await tx
      .update(saleCountdown)
      .set({
        status: "expired",
        expiredAt: now,
        saleEndedAt: saleEnd ? now : null,
        updatedAt: now,
        updatedBy: SYSTEM_ACTOR,
      })
      .where(eq(saleCountdown.id, COUNTDOWN_ID));

    return {
      finalized: true,
      runId: locked.runId,
      saleEnded: !!saleEnd,
      changed: saleEnd?.changes.length ?? 0,
      eventId,
    };
  });

  if (result.finalized) noteSaleCountdownState({ status: "expired", endsAt: null });
  return result;
}

/** Inside the expiry transaction (countdown row already locked). */
async function applyPostSalePrices(tx: Tx, now: Date): Promise<SaleEndDetails> {
  const items = await tx
    .select({ productId: saleCountdownItem.productId, postSalePrice: saleCountdownItem.postSalePrice })
    .from(saleCountdownItem);
  const details: SaleEndDetails = { changes: [], skipped: [] };
  if (items.length === 0) return details;

  // Lock in id order, the order checkout and payment materialization use.
  const products = await tx
    .select({
      id: product.id,
      name: product.name,
      price: product.price,
      discountPrice: product.discountPrice,
      deleted: product.deleted,
    })
    .from(product)
    .where(inArray(product.id, items.map((i) => i.productId)))
    .orderBy(asc(product.id))
    .for("update");

  for (const p of products) {
    const item = items.find((i) => i.productId === p.id);
    if (!item) continue;
    if (p.deleted) {
      details.skipped.push({ productId: p.id, name: p.name, reason: "product deleted" });
      continue;
    }
    // Unreachable through the dashboard (auto end refuses to switch on or
    // start without every price), but the row is data and is checked again.
    if (toCents(item.postSalePrice) === null || (toCents(item.postSalePrice) ?? 0) <= 0) {
      details.skipped.push({ productId: p.id, name: p.name, reason: "no post-sale price" });
      continue;
    }
    const next = postSaleDiscountPrice(p.price, item.postSalePrice as string);
    await tx
      .update(product)
      .set({ discountPrice: next.discountPrice, updatedAt: now })
      .where(eq(product.id, p.id));
    details.changes.push({
      productId: p.id,
      name: p.name,
      before: { price: p.price, discountPrice: p.discountPrice },
      after: { discountPrice: next.discountPrice },
      postSalePrice: item.postSalePrice as string,
      ...(next.cappedAtListPrice ? { cappedAtListPrice: true } : {}),
    });
  }
  return details;
}

/**
 * Called by checkout pricing, inside its transaction. If a countdown that
 * ends a sale is past its deadline but not finalized (the ticker is late, a
 * request raced the deadline by milliseconds, or the expiry failed), the cart
 * must not be priced from the old sale prices: refuse, and the shopper's
 * retry runs the expiry first.
 */
export async function assertNoPendingSaleExpiry(
  client: SelectClient,
  now: Date = new Date(),
): Promise<void> {
  const row = await readCountdown(client);
  if (isDue(row, now) && row.autoEndSale) {
    throw new ServerError({
      tag: "SalePricesChanging",
      statusCode: 409,
      message: "Sale countdown expired and its prices are being updated",
      clientMessage:
        "The sale just ended and prices are being updated. Please review your bag and place your order again.",
    });
  }
}

// ─── Storefront ──────────────────────────────────────────────────────────────

export async function getPublicCountdown(
  client: SelectClient,
  now: Date = new Date(),
): Promise<PublicSaleCountdown> {
  const row = await readCountdown(client);
  const active = !!row && row.enabled && effectiveCountdownStatus(row, now) === "running";
  return {
    active,
    endsAt: active && row?.endsAt ? row.endsAt.toISOString() : null,
    label: row?.label || DEFAULT_COUNTDOWN_LABEL,
    serverNow: now.toISOString(),
  };
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export const updateSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  durationMinutes: z.number().int().min(1).max(MAX_COUNTDOWN_MINUTES).optional(),
  label: z.string().trim().min(1).max(MAX_COUNTDOWN_LABEL_LENGTH).optional(),
  autoEndSale: z.boolean().optional(),
});

export const setItemsSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        /** Explicit post-sale price; null = not decided yet. */
        postSalePrice: z.number().positive().max(99_999_999).nullable(),
      }),
    )
    .max(500),
});

export const startSchema = z.union([
  z.object({ mode: z.literal("duration"), durationMinutes: z.number().int().min(1).max(MAX_COUNTDOWN_MINUTES).optional() }),
  z.object({ mode: z.literal("until"), endsAt: z.coerce.date() }),
]);

export const updateExpirationSchema = z.object({ endsAt: z.coerce.date() });

export const rollbackSchema = z.object({ eventId: z.string().uuid() });

/** Lock the countdown row (creating it with defaults on first use). */
async function withLockedCountdown<T>(
  client: DatabaseClient,
  fn: (tx: Tx, row: SaleCountdownRow) => Promise<T>,
): Promise<T> {
  const result = await client.transaction(async (tx) => {
    await tx.insert(saleCountdown).values({ id: COUNTDOWN_ID }).onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(saleCountdown)
      .where(eq(saleCountdown.id, COUNTDOWN_ID))
      .for("update");
    if (!row) fail("Could not load the countdown settings.", 500);
    return fn(tx, row);
  });
  noteSaleCountdownState(await readCountdown(client));
  return result;
}

async function logEvent(
  tx: Tx,
  runId: string | null,
  type: string,
  actor: string,
  details: Record<string, unknown>,
): Promise<void> {
  await tx.insert(saleCountdownEvent).values({ id: v7(), runId, type, actor, details });
}

async function loadSaleItems(client: SelectClient) {
  return client
    .select({
      productId: saleCountdownItem.productId,
      postSalePrice: saleCountdownItem.postSalePrice,
      name: product.name,
      slug: product.slug,
      price: product.price,
      discountPrice: product.discountPrice,
      deleted: product.deleted,
      hidden: product.hidden,
    })
    .from(saleCountdownItem)
    .innerJoin(product, eq(product.id, saleCountdownItem.productId))
    .orderBy(asc(product.name));
}

type LoadedItem = Awaited<ReturnType<typeof loadSaleItems>>[number];

function problemsFor(items: readonly LoadedItem[]): string[] {
  return saleItemProblems(
    items.map((i) => ({
      productId: i.productId,
      name: i.name.trim(),
      postSalePrice: i.postSalePrice,
      listPrice: i.price,
      deleted: i.deleted,
    })),
  );
}

function blockAutoEnd(problems: string[]): never {
  fail(
    `Automatic sale end needs an explicit post-sale price for every sale product. ${problems.join(" ")}`,
  );
}

export interface AdminCountdownState {
  settings: {
    enabled: boolean;
    durationMinutes: number;
    label: string;
    autoEndSale: boolean;
  };
  status: SaleCountdownStatus;
  runId: string | null;
  startedAt: string | null;
  endsAt: string | null;
  expiredAt: string | null;
  saleEndedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  serverNow: string;
  items: Array<{
    productId: string;
    name: string;
    slug: string | null;
    price: string;
    discountPrice: string | null;
    postSalePrice: string | null;
    deleted: boolean;
    hidden: boolean;
  }>;
  /** Empty = automatic sale end can be switched on / started. */
  autoEndProblems: string[];
  events: Array<Pick<SaleCountdownEventRow, "id" | "runId" | "type" | "actor" | "details"> & { createdAt: string }>;
  /** The most recent sale end that can still be rolled back, if any. */
  rollbackableEventId: string | null;
}

export async function getAdminCountdownState(
  client: DatabaseClient,
  now: Date = new Date(),
): Promise<AdminCountdownState> {
  // An admin looking at an overdue countdown sees it finalized, not "running".
  await finalizeDueSaleCountdown(client, now);
  const row = (await readCountdown(client)) ?? DEFAULT_ROW;
  noteSaleCountdownState(row);
  const items = await loadSaleItems(client);
  const events = await client
    .select()
    .from(saleCountdownEvent)
    .orderBy(desc(saleCountdownEvent.createdAt), desc(saleCountdownEvent.id))
    .limit(30);

  return {
    settings: {
      enabled: row.enabled,
      durationMinutes: row.durationMinutes,
      label: row.label,
      autoEndSale: row.autoEndSale,
    },
    status: effectiveCountdownStatus(row, now),
    runId: row.runId,
    startedAt: row.startedAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    expiredAt: row.expiredAt?.toISOString() ?? null,
    saleEndedAt: row.saleEndedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    updatedBy: row.updatedBy,
    serverNow: now.toISOString(),
    items: items.map((i) => ({ ...i, name: i.name.trim() })),
    autoEndProblems: problemsFor(items),
    events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    rollbackableEventId: await findRollbackableEventId(client),
  };
}

export async function updateCountdownSettings(
  client: DatabaseClient,
  input: z.infer<typeof updateSettingsSchema>,
  actor: string,
  now: Date = new Date(),
) {
  await finalizeDueSaleCountdown(client, now);
  return withLockedCountdown(client, async (tx, row) => {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const next = { ...row };
    for (const key of ["enabled", "durationMinutes", "label", "autoEndSale"] as const) {
      const value = input[key];
      if (value !== undefined && value !== row[key]) {
        changes[key] = { from: row[key], to: value };
        (next as Record<string, unknown>)[key] = value;
      }
    }
    if (Object.keys(changes).length === 0) return { changed: false };

    if (next.autoEndSale) {
      const problems = problemsFor(await loadSaleItems(tx));
      if (problems.length > 0) blockAutoEnd(problems);
    }

    // Disabling the countdown also stops a running one (prices untouched).
    const stopsRun = next.enabled === false && row.status === "running";
    await tx
      .update(saleCountdown)
      .set({
        enabled: next.enabled,
        durationMinutes: next.durationMinutes,
        label: next.label,
        autoEndSale: next.autoEndSale,
        ...(stopsRun ? { status: "inactive" as const } : {}),
        updatedAt: now,
        updatedBy: actor,
      })
      .where(eq(saleCountdown.id, COUNTDOWN_ID));
    await logEvent(tx, row.runId, "settings_changed", actor, { changes });
    if (stopsRun) {
      await logEvent(tx, row.runId, "stopped", actor, {
        reason: "countdown disabled",
        endsAt: row.endsAt?.toISOString() ?? null,
      });
    }
    return { changed: true };
  });
}

export async function setSaleItems(
  client: DatabaseClient,
  input: z.infer<typeof setItemsSchema>,
  actor: string,
  now: Date = new Date(),
) {
  const ids = input.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) fail("A product is listed twice.");

  await finalizeDueSaleCountdown(client, now);
  return withLockedCountdown(client, async (tx, row) => {
    const found = ids.length
      ? await tx
          .select({ id: product.id, name: product.name, price: product.price, deleted: product.deleted })
          .from(product)
          .where(inArray(product.id, ids))
      : [];
    if (found.length !== ids.length) fail("One of the selected products no longer exists.");

    if (row.autoEndSale) {
      const problems = saleItemProblems(
        input.items.map((i) => {
          // Every id was found above (length check), so `p` is always set.
          const p = found.find((f) => f.id === i.productId);
          return {
            productId: i.productId,
            name: p?.name.trim() ?? i.productId,
            postSalePrice: i.postSalePrice,
            listPrice: p?.price ?? "0",
            deleted: p?.deleted ?? true,
          };
        }),
      );
      if (problems.length > 0) blockAutoEnd(problems);
    }

    const before = await tx
      .select({ productId: saleCountdownItem.productId, postSalePrice: saleCountdownItem.postSalePrice })
      .from(saleCountdownItem);

    // Only sale_countdown_item rows change here — never a product price.
    if (ids.length === 0) {
      await tx.delete(saleCountdownItem);
    } else {
      await tx.delete(saleCountdownItem).where(notInArray(saleCountdownItem.productId, ids));
      for (const item of input.items) {
        const price = item.postSalePrice === null ? null : item.postSalePrice.toFixed(2);
        await tx
          .insert(saleCountdownItem)
          .values({ id: v7(), productId: item.productId, postSalePrice: price })
          .onConflictDoUpdate({
            target: saleCountdownItem.productId,
            set: { postSalePrice: price, updatedAt: now },
          });
      }
    }

    await logEvent(tx, row.runId, "products_changed", actor, {
      before,
      after: input.items.map((i) => ({
        productId: i.productId,
        postSalePrice: i.postSalePrice === null ? null : i.postSalePrice.toFixed(2),
      })),
    });
    return { count: ids.length };
  });
}

function validateDeadline(endsAt: Date, now: Date): void {
  if (Number.isNaN(endsAt.getTime())) fail("Pick a valid expiration date and time.");
  if (endsAt.getTime() < now.getTime() + 60_000) {
    fail("The expiration must be at least one minute in the future.");
  }
  if (endsAt.getTime() > now.getTime() + MAX_COUNTDOWN_MINUTES * 60_000) {
    fail("The expiration must be within one year.");
  }
}

export async function startCountdown(
  client: DatabaseClient,
  input: z.infer<typeof startSchema>,
  actor: string,
  now: Date = new Date(),
) {
  // Finalize an overdue previous run first, so starting a new one can never
  // skip the previous run's sale end.
  await finalizeDueSaleCountdown(client, now);
  return withLockedCountdown(client, async (tx, row) => {
    if (!row.enabled) fail("Turn on the countdown before starting it.");
    if (row.status === "running") {
      fail("A countdown is already running. Stop it, or change its expiration instead.");
    }

    const durationMinutes =
      input.mode === "duration" ? (input.durationMinutes ?? row.durationMinutes) : null;
    const endsAt =
      input.mode === "duration"
        ? new Date(now.getTime() + (durationMinutes as number) * 60_000)
        : input.endsAt;
    validateDeadline(endsAt, now);

    const items = await loadSaleItems(tx);
    if (row.autoEndSale) {
      const problems = problemsFor(items);
      if (problems.length > 0) blockAutoEnd(problems);
    }

    const runId = v7();
    await tx
      .update(saleCountdown)
      .set({
        status: "running",
        runId,
        startedAt: now,
        endsAt,
        expiredAt: null,
        saleEndedAt: null,
        updatedAt: now,
        updatedBy: actor,
      })
      .where(eq(saleCountdown.id, COUNTDOWN_ID));
    await logEvent(tx, runId, "started", actor, {
      mode: input.mode,
      durationMinutes,
      endsAt: endsAt.toISOString(),
      autoEndSale: row.autoEndSale,
      products: row.autoEndSale
        ? items.map((i) => ({
            productId: i.productId,
            name: i.name.trim(),
            currentPrice: i.price,
            currentDiscountPrice: i.discountPrice,
            postSalePrice: i.postSalePrice,
          }))
        : [],
    });
    return { runId, endsAt: endsAt.toISOString() };
  });
}

export async function updateCountdownExpiration(
  client: DatabaseClient,
  input: z.infer<typeof updateExpirationSchema>,
  actor: string,
  now: Date = new Date(),
) {
  await finalizeDueSaleCountdown(client, now);
  return withLockedCountdown(client, async (tx, row) => {
    if (row.status !== "running") fail("No countdown is running. Start one instead.");
    validateDeadline(input.endsAt, now);
    await tx
      .update(saleCountdown)
      .set({ endsAt: input.endsAt, updatedAt: now, updatedBy: actor })
      .where(eq(saleCountdown.id, COUNTDOWN_ID));
    await logEvent(tx, row.runId, "expiration_changed", actor, {
      from: row.endsAt?.toISOString() ?? null,
      to: input.endsAt.toISOString(),
    });
    return { endsAt: input.endsAt.toISOString() };
  });
}

/** Stop a running countdown early. Hides it; changes no price. */
export async function stopCountdown(client: DatabaseClient, actor: string, now: Date = new Date()) {
  await finalizeDueSaleCountdown(client, now);
  return withLockedCountdown(client, async (tx, row) => {
    if (row.status !== "running") fail("No countdown is running.");
    await tx
      .update(saleCountdown)
      .set({ status: "inactive", updatedAt: now, updatedBy: actor })
      .where(eq(saleCountdown.id, COUNTDOWN_ID));
    await logEvent(tx, row.runId, "stopped", actor, {
      reason: "stopped by admin",
      endsAt: row.endsAt?.toISOString() ?? null,
      remainingSeconds: row.endsAt ? Math.max(0, Math.round((row.endsAt.getTime() - now.getTime()) / 1000)) : null,
    });
    return { stopped: true };
  });
}

// ─── Rollback ────────────────────────────────────────────────────────────────

function saleEndOf(event: Pick<SaleCountdownEventRow, "type" | "details">): SaleEndDetails | null {
  if (event.type !== "expired") return null;
  const saleEnd = (event.details as { saleEnd?: SaleEndDetails }).saleEnd;
  return saleEnd && Array.isArray(saleEnd.changes) && saleEnd.changes.length > 0 ? saleEnd : null;
}

/** The newest expiry that changed prices, if it has not been rolled back. */
async function findRollbackableEventId(client: SelectClient): Promise<string | null> {
  const [latestSaleEnd] = await client
    .select()
    .from(saleCountdownEvent)
    .where(
      and(
        eq(saleCountdownEvent.type, "expired"),
        sql`jsonb_array_length(coalesce(${saleCountdownEvent.details} -> 'saleEnd' -> 'changes', '[]'::jsonb)) > 0`,
      ),
    )
    .orderBy(desc(saleCountdownEvent.createdAt), desc(saleCountdownEvent.id))
    .limit(1);
  if (!latestSaleEnd) return null;
  const [rolledBack] = await client
    .select({ id: saleCountdownEvent.id })
    .from(saleCountdownEvent)
    .where(
      and(
        eq(saleCountdownEvent.type, "sale_end_rolled_back"),
        sql`${saleCountdownEvent.details} ->> 'expiredEventId' = ${latestSaleEnd.id}`,
      ),
    )
    .limit(1);
  return rolledBack ? null : latestSaleEnd.id;
}

/**
 * Put back the discount prices an automatic sale end replaced. Per product,
 * only if its discount price is still exactly what the sale end set — a
 * product edited since is left alone and reported, never overwritten.
 */
export async function rollbackSaleEnd(
  client: DatabaseClient,
  input: z.infer<typeof rollbackSchema>,
  actor: string,
  now: Date = new Date(),
) {
  await finalizeDueSaleCountdown(client, now);
  return withLockedCountdown(client, async (tx, row) => {
    if (row.status === "running") {
      fail("Stop the running countdown before rolling back an earlier sale end.");
    }
    if ((await findRollbackableEventId(tx)) !== input.eventId) {
      fail("Only the most recent sale end that has not been rolled back can be rolled back.");
    }
    const [event] = await tx
      .select()
      .from(saleCountdownEvent)
      .where(eq(saleCountdownEvent.id, input.eventId));
    const saleEnd = event ? saleEndOf(event) : null;
    if (!event || !saleEnd) fail("That event did not change any prices.");

    const current = await tx
      .select({ id: product.id, discountPrice: product.discountPrice })
      .from(product)
      .where(inArray(product.id, saleEnd.changes.map((c) => c.productId)))
      .orderBy(asc(product.id))
      .for("update");

    const restored: Array<{ productId: string; name: string; from: string | null; to: string | null }> = [];
    const conflicts: Array<{ productId: string; name: string; reason: string }> = [];
    for (const change of saleEnd.changes) {
      const p = current.find((c) => c.id === change.productId);
      if (!p) {
        conflicts.push({ productId: change.productId, name: change.name, reason: "product no longer exists" });
        continue;
      }
      if (toCents(p.discountPrice) !== toCents(change.after.discountPrice)) {
        conflicts.push({
          productId: change.productId,
          name: change.name,
          reason: `discount price changed since the sale ended (now ${p.discountPrice ?? "none"})`,
        });
        continue;
      }
      await tx
        .update(product)
        .set({ discountPrice: change.before.discountPrice, updatedAt: now })
        .where(eq(product.id, change.productId));
      restored.push({
        productId: change.productId,
        name: change.name,
        from: p.discountPrice,
        to: change.before.discountPrice,
      });
    }

    await logEvent(tx, event.runId, "sale_end_rolled_back", actor, {
      expiredEventId: event.id,
      restored,
      conflicts,
    });
    return { restored: restored.length, conflicts };
  });
}
