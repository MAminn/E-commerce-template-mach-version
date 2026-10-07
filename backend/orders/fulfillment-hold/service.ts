/**
 * Resolving a fulfillment hold.
 *
 * A held order (e.g. "stock_conflict": paid online, but stock ran out while
 * the customer was paying) was created WITHOUT taking stock and is refused
 * by Bosta dispatch, status changes toward fulfillment, and item edits.
 *
 * An admin resolves it one of two ways:
 *   - cancel it (existing status update; stock_restored is already true, so
 *     nothing is "given back"), refunding the customer outside the system; or
 *   - release it here once stock exists: commits the stock atomically, clears
 *     the hold and moves the order into normal processing / Bosta.
 */
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "#root/shared/database/drizzle/db";
import { order, orderItem, orderLog, product } from "#root/shared/database/drizzle/schema";
import { ServerError } from "#root/shared/error/server";
import { isBostaEnabled } from "#root/backend/orders/bosta/service";
import { dispatchOrderToBosta, type BostaDispatchResult } from "#root/backend/orders/bosta/dispatch";

export const releaseFulfillmentHoldSchema = z.object({ orderId: z.string().uuid() });

export const FULFILLMENT_HOLD_BLOCK_MESSAGE =
  "This paid order is on a fulfillment hold (stock issue — manual review required). Release the hold once stock is available, or cancel the order. Only internal notes can be edited while it is held.";

export async function releaseFulfillmentHold(
  db: DatabaseClient,
  orderId: string,
  actor: { id: string | null; email: string | null },
): Promise<{ released: true; bosta: BostaDispatchResult | null }> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: order.id, status: order.status, fulfillmentHold: order.fulfillmentHold })
      .from(order)
      .where(eq(order.id, orderId))
      .for("update")
      .execute();

    if (!row) {
      throw new ServerError({ tag: "NotFound", statusCode: 404, clientMessage: "Order not found" });
    }
    if (!row.fulfillmentHold) {
      throw new ServerError({
        tag: "BadRequest",
        statusCode: 400,
        clientMessage: "This order is not on a fulfillment hold.",
      });
    }
    if (row.status === "cancelled") {
      throw new ServerError({
        tag: "BadRequest",
        statusCode: 400,
        clientMessage: "This order is cancelled — there is nothing to release.",
      });
    }

    const items = await tx
      .select({ productId: orderItem.productId, quantity: orderItem.quantity })
      .from(orderItem)
      .where(eq(orderItem.orderId, orderId))
      .execute();

    const need = new Map<string, number>();
    for (const item of items) {
      need.set(item.productId, (need.get(item.productId) ?? 0) + item.quantity);
    }
    const productIds = [...need.keys()].sort();
    const locked = productIds.length
      ? await tx
          .select({ id: product.id, stock: product.stock, name: product.name })
          .from(product)
          .where(inArray(product.id, productIds))
          .orderBy(asc(product.id))
          .for("update")
          .execute()
      : [];

    const shortfalls = locked.filter((p) => p.stock < (need.get(p.id) ?? 0));
    if (shortfalls.length > 0) {
      throw new ServerError({
        tag: "InsufficientStock",
        statusCode: 409,
        clientMessage: `Still not enough stock: ${shortfalls
          .map((p) => `${p.name} (need ${need.get(p.id)}, have ${p.stock})`)
          .join("; ")}. Restock first, or cancel the order.`,
      });
    }

    for (const id of productIds) {
      const qty = need.get(id) ?? 0;
      const updated = await tx
        .update(product)
        .set({ stock: sql`${product.stock} - ${qty}` })
        .where(and(eq(product.id, id), gte(product.stock, qty)))
        .returning({ id: product.id })
        .execute();
      if (updated.length === 0) {
        throw new ServerError({
          tag: "InsufficientStock",
          statusCode: 409,
          clientMessage: "Stock changed while releasing the hold — please try again.",
        });
      }
    }

    await tx
      .update(order)
      .set({
        fulfillmentHold: null,
        fulfillmentHoldNote: null,
        // Stock is now taken, so a later cancel must give it back.
        stockRestored: false,
        status: "processing",
        updatedAt: new Date(),
      })
      .where(eq(order.id, orderId))
      .execute();

    await tx
      .insert(orderLog)
      .values({
        orderId,
        userId: actor.id,
        action: "status_changed",
        oldStatus: row.status,
        newStatus: "processing",
        note: `Fulfillment hold (${row.fulfillmentHold}) released${actor.email ? ` by ${actor.email}` : ""} — stock committed`,
      })
      .execute();
  });

  let bosta: BostaDispatchResult | null = null;
  if (isBostaEnabled()) {
    try {
      bosta = await dispatchOrderToBosta(db, orderId, { trigger: "manual", actor: actor.email });
    } catch (error) {
      console.error(`[FulfillmentHold] Bosta dispatch after release failed for ${orderId}:`, error);
    }
  }
  return { released: true, bosta };
}
