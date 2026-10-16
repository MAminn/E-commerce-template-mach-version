import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Writable } from "node:stream";
import { z } from "zod";
import type { DatabaseClient } from "#root/shared/database/drizzle/db";
import {
  order,
  orderItem,
  paymentAttempt,
  product,
  promoCode,
  user,
} from "#root/shared/database/drizzle/schema";
import { STORE_CURRENCY } from "#root/shared/config/branding";
import { buildOrderFilterConditions } from "../view-orders/service";
import {
  CSV_BOM,
  csvHeaderRow,
  csvOrderRow,
  type ExportOrderItemRow,
  type ExportOrderRow,
} from "./csv";

/** Orders read per query; items for a batch come in one more query. */
export const EXPORT_BATCH_SIZE = 500;

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

/** The Orders dashboard's filters, as query-string values. */
export const exportOrdersQuerySchema = z.object({
  status: z.enum(["pending", "processing", "shipped", "delivered", "cancelled"]).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  paymentIssueOnly: z
    .enum(["true", "1", "false", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1"),
  search: z.string().trim().max(200).optional(),
});

export type ExportOrdersQuery = z.infer<typeof exportOrdersQuerySchema>;

/** ILIKE pattern for a literal substring. */
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The dashboard's search box, applied to the whole history: order id, order
 * number/reference, customer name, email or any item name contains the text.
 */
function searchCondition(search: string): SQL | undefined {
  const pattern = containsPattern(search);
  const ref = search.toUpperCase().replace(/^#/, "").replace(/^ORD-/, "");
  return or(
    sql`${order.id}::text ilike ${pattern}`,
    ilike(order.customerName, pattern),
    ilike(order.customerEmail, pattern),
    sql`exists (select 1 from ${orderItem} where ${orderItem.orderId} = ${order.id} and ${orderItem.name} ilike ${pattern})`,
    // Legacy orders (no stored reference) show the first 8 hex chars of the id.
    ref
      ? sql`substr(coalesce(${order.reference}, 'ORD-' || upper(substr(replace(${order.id}::text, '-', ''), 1, 8))), 5) like ${containsPattern(ref)}`
      : undefined,
  );
}

export function buildExportWhere(query: ExportOrdersQuery): SQL | undefined {
  const conditions = buildOrderFilterConditions(query);
  if (query.search) {
    const condition = searchCondition(query.search);
    if (condition) conditions.push(condition);
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

type Tx = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

async function selectOrderBatch(
  tx: Tx,
  where: SQL | undefined,
  offset: number,
): Promise<ExportOrderRow[]> {
  const rows = await tx
    .select({
      id: order.id,
      reference: order.reference,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      paymentTransactionId: order.paymentTransactionId,
      providerPaymentMethod: paymentAttempt.providerPaymentMethod,
      attemptCurrency: paymentAttempt.currency,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      accountPhone: user.phone,
      customerEmail: order.customerEmail,
      shippingState: order.shippingState,
      shippingCity: order.shippingCity,
      shippingDistrict: order.shippingDistrict,
      shippingAddress: order.shippingAddress,
      shippingPostalCode: order.shippingPostalCode,
      shippingCountry: order.shippingCountry,
      subtotal: order.subtotal,
      discount: order.discount,
      promoCode: promoCode.code,
      // Kept on the attempt even if the promo code is later deleted.
      attemptPromoCode: paymentAttempt.promoCode,
      shipping: order.shipping,
      tax: order.tax,
      total: order.total,
      notes: order.notes,
      bostaSyncStatus: order.bostaSyncStatus,
      bostaTrackingNumber: order.bostaTrackingNumber,
      bostaDeliveryId: order.bostaDeliveryId,
      bostaStatus: order.bostaStatus,
      bostaStatusCode: order.bostaStatusCode,
      bostaStatusUpdatedAt: order.bostaStatusUpdatedAt,
      bostaSyncError: order.bostaSyncError,
      bostaWebhookData: order.bostaWebhookData,
      fulfillmentHold: order.fulfillmentHold,
      fulfillmentHoldNote: order.fulfillmentHoldNote,
      archivedAt: order.archivedAt,
    })
    .from(order)
    .leftJoin(promoCode, eq(order.promoCodeId, promoCode.id))
    // payment_attempt.order_id is unique — at most one match per order.
    .leftJoin(paymentAttempt, eq(paymentAttempt.orderId, order.id))
    .leftJoin(user, eq(order.userId, user.id))
    .where(where)
    // Same order as the dashboard; id breaks ties so offsets are stable.
    .orderBy(desc(order.createdAt), desc(order.id))
    .limit(EXPORT_BATCH_SIZE)
    .offset(offset)
    .execute();

  return rows.map(({ attemptCurrency, attemptPromoCode, ...row }) => ({
    ...row,
    currency: attemptCurrency || STORE_CURRENCY,
    promoCode: row.promoCode ?? attemptPromoCode,
  }));
}

async function selectItems(tx: Tx, orderIds: string[]): Promise<Map<string, ExportOrderItemRow[]>> {
  const byOrder = new Map<string, ExportOrderItemRow[]>();
  if (orderIds.length === 0) return byOrder;
  const items = await tx
    .select({
      orderId: orderItem.orderId,
      name: orderItem.name,
      productName: product.name,
      sku: product.sku,
      quantity: orderItem.quantity,
      price: orderItem.price,
      discountPrice: orderItem.discountPrice,
    })
    .from(orderItem)
    .leftJoin(product, eq(orderItem.productId, product.id))
    .where(inArray(orderItem.orderId, orderIds))
    .orderBy(asc(orderItem.createdAt), asc(orderItem.id))
    .execute();
  for (const item of items) {
    const list = byOrder.get(item.orderId);
    if (list) list.push(item);
    else byOrder.set(item.orderId, [item]);
  }
  return byOrder;
}

export class ExportAbortedError extends Error {
  constructor() {
    super("Export aborted by the client");
  }
}

/** Writes, waiting out backpressure; throws once the client has gone. */
async function write(out: Writable, chunk: string): Promise<void> {
  if (out.destroyed) throw new ExportAbortedError();
  if (out.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      out.off("drain", onDrain);
      out.off("close", onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new ExportAbortedError());
    };
    out.on("drain", onDrain);
    out.on("close", onClose);
  });
}

/**
 * Streams every matching order as CSV into `out` (which it does not end).
 *
 * Runs in one READ ONLY, REPEATABLE READ transaction: the export cannot write
 * anything, and the count plus every batch see the same snapshot — an order
 * placed mid-export is neither half-included nor able to shift the offsets.
 *
 * `onCount` fires with the row count before the first byte is written, so
 * the caller can still answer with an error status up to that point.
 */
export async function streamOrdersCsv(
  db: DatabaseClient,
  query: ExportOrdersQuery,
  out: Writable,
  onCount: (count: number) => void,
): Promise<number> {
  const where = buildExportWhere(query);

  return db.transaction(
    async (tx) => {
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(order)
        .where(where)
        .execute();
      const expected = countRow?.count ?? 0;
      onCount(expected);

      await write(out, CSV_BOM + csvHeaderRow());

      let written = 0;
      for (;;) {
        const batch = await selectOrderBatch(tx, where, written);
        if (batch.length === 0) break;
        const items = await selectItems(
          tx,
          batch.map((o) => o.id),
        );
        let chunk = "";
        for (const row of batch) {
          chunk += csvOrderRow(row, items.get(row.id) ?? []);
        }
        await write(out, chunk);
        written += batch.length;
        if (batch.length < EXPORT_BATCH_SIZE) break;
      }

      if (written !== expected) {
        // Impossible inside one snapshot — fail loudly rather than hand over
        // a file whose row count disagrees with the dashboard.
        throw new Error(`Order export wrote ${written} rows, expected ${expected}`);
      }
      return written;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
