/**
 * Bosta status webhook — payload contract and processing.
 *
 * Source: https://docs.bosta.co/docs/how-to/get-delivery-status-via-webhook/
 * Bosta POSTs on every state change (not on creation):
 *
 *   { _id, trackingNumber, state: <number>, type: "SEND" | ...,
 *     cod?, timeStamp?, isConfirmedDelivery?, deliveryPromiseDate?,
 *     exceptionReason?, exceptionCode?, businessReference?, numberOfAttempts? }
 *
 * `state` is a NUMBER. `trackingNumber` is documented as a string but the
 * documented example sends a bare number, so both are accepted.
 */
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { query, type DatabaseClient } from "#root/shared/database/drizzle/db";
import { order } from "#root/shared/database/drizzle/schema";
import { ServerError } from "#root/shared/error/server";
import { logOrderEvent, recordWebhookLog } from "#root/backend/orders/order-log";
import { enqueueReviewCheckForOrder } from "#root/backend/email-automations/triggers/order-delivered";
import { verifyBostaWebhookSecret } from "./webhook-auth";
import {
  getBostaStateName,
  mapBostaStateToOrderStatus,
  resolveNextOrderStatus,
  type LocalOrderStatus,
} from "./states";

// ─── Payload schema ───────────────────────────────────────────────────────────

const numberish = z.union([z.number(), z.string()]);

export const bostaWebhookSchema = z
  .object({
    _id: z.string().optional(),
    /** Documented as String; example payload sends a number. Normalised to string. */
    trackingNumber: numberish.transform((v) => String(v).trim()),
    /** Numeric Bosta state code (see states.ts). */
    state: z.coerce.number().int(),
    /** "SEND" | "EXCHANGE" | "CUSTOMER_RETURN_PICKUP" | "RTO" | "SIGN_AND_RETURN" | "FXF_SEND" */
    type: z.string().optional(),
    cod: z.coerce.number().optional().nullable(),
    /** Epoch milliseconds of the state change. */
    timeStamp: z.coerce.number().optional().nullable(),
    isConfirmedDelivery: z.boolean().optional().nullable(),
    /** "DD-MM-YYYY" */
    deliveryPromiseDate: z.string().optional().nullable(),
    exceptionReason: z.string().optional().nullable(),
    exceptionCode: z.coerce.number().optional().nullable(),
    /** The businessReference we sent on creation = our order id. */
    businessReference: z.string().optional().nullable(),
    numberOfAttempts: z.coerce.number().optional().nullable(),
  })
  .passthrough();

export type BostaWebhookPayload = z.infer<typeof bostaWebhookSchema>;

// ─── Processing ───────────────────────────────────────────────────────────────

export type BostaWebhookOutcome =
  | { success: true; skipped: true; reason: string }
  | {
      success: true;
      skipped: false;
      orderId: string;
      previousStatus: LocalOrderStatus;
      nextStatus: LocalOrderStatus | null;
      stateCode: number;
      stateName: string;
    };

/** Bosta's `timeStamp` (epoch ms) when it is a plausible date, else now. */
export function webhookTimestampToDate(timeStamp: number | null | undefined): Date {
  if (typeof timeStamp === "number" && Number.isFinite(timeStamp) && timeStamp > 0) {
    const d = new Date(timeStamp);
    const year = d.getUTCFullYear();
    if (!Number.isNaN(d.getTime()) && year >= 2015 && year <= 2100) return d;
  }
  return new Date();
}

/**
 * Apply an authenticated, schema-valid webhook to the database. Pure with
 * respect to auth — callers verify the secret first (see
 * {@link processBostaWebhook}). Never throws for provider quirks: unknown
 * orders are skipped safely.
 */
export async function applyBostaWebhook(
  db: DatabaseClient,
  payload: BostaWebhookPayload,
): Promise<BostaWebhookOutcome> {
  const orderId = payload.businessReference?.trim() || null;

  // Append-only audit copy, independent of the order row's single slot.
  await recordWebhookLog({
    webhookType: "delivery_status",
    provider: "bosta",
    payload: payload as unknown as Record<string, unknown>,
    orderId,
  });

  if (!orderId) {
    // Deliveries created outside this store have no businessReference.
    return { success: true, skipped: true, reason: "no businessReference" };
  }

  const [existing] = await db
    .select({
      id: order.id,
      status: order.status,
      customerEmail: order.customerEmail,
      customerName: order.customerName,
      bostaTrackingNumber: order.bostaTrackingNumber,
    })
    .from(order)
    .where(eq(order.id, orderId))
    .limit(1)
    .execute();

  if (!existing) {
    return { success: true, skipped: true, reason: `unknown order ${orderId}` };
  }

  // A terminated-then-resent order still receives events for its old
  // delivery; those must not touch the current one.
  if (
    existing.bostaTrackingNumber &&
    payload.trackingNumber &&
    existing.bostaTrackingNumber !== payload.trackingNumber
  ) {
    return {
      success: true,
      skipped: true,
      reason: `tracking ${payload.trackingNumber} is not the order's current delivery (${existing.bostaTrackingNumber})`,
    };
  }

  const stateCode = payload.state;
  const stateName = getBostaStateName(stateCode);
  const previousStatus = existing.status as LocalOrderStatus;
  const action = mapBostaStateToOrderStatus(stateCode);
  const nextStatus = resolveNextOrderStatus(previousStatus, action);
  const statusUpdatedAt = webhookTimestampToDate(payload.timeStamp);

  const update: Record<string, unknown> = {
    bostaStatus: stateName,
    bostaStatusCode: String(stateCode),
    bostaStatusUpdatedAt: statusUpdatedAt,
    // Raw payload keeps exceptionReason / exceptionCode / numberOfAttempts /
    // isConfirmedDelivery / deliveryPromiseDate without dedicated columns.
    bostaWebhookData: {
      ...(payload as unknown as Record<string, unknown>),
      trackingNumber: payload.trackingNumber,
      stateName,
      receivedAt: new Date().toISOString(),
    },
    updatedAt: new Date(),
  };
  if (nextStatus) update.status = nextStatus;

  await db.update(order).set(update).where(eq(order.id, orderId)).execute();

  if (nextStatus) {
    const detail = [
      `Bosta reported "${stateName}" (code ${stateCode})`,
      payload.exceptionReason ? `— ${payload.exceptionReason}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    await logOrderEvent({
      orderId,
      action: "bosta_status_updated",
      oldStatus: previousStatus,
      newStatus: nextStatus,
      note: detail,
    });

    if (nextStatus === "delivered") {
      await enqueueReviewCheckForOrder({
        orderId,
        customerEmail: existing.customerEmail,
        customerName: existing.customerName,
      });
    }
  }

  console.log(
    `[Bosta Webhook] Order ${orderId}: "${stateName}" (${stateCode}) → status ${nextStatus ?? `unchanged (${previousStatus})`}`,
  );

  return {
    success: true,
    skipped: false,
    orderId,
    previousStatus,
    nextStatus,
    stateCode,
    stateName,
  };
}

/**
 * Effect wrapper used by the Fastify route: verifies the shared secret with
 * a timing-safe comparison, then applies the payload.
 */
export const processBostaWebhook = (
  payload: BostaWebhookPayload,
  authorizationHeader: string | undefined,
  expectedSecret: string,
) =>
  Effect.gen(function* ($) {
    if (!verifyBostaWebhookSecret(authorizationHeader, expectedSecret)) {
      return yield* $(
        Effect.fail(
          new ServerError({
            tag: "Unauthorized",
            message: "Invalid Bosta webhook token",
            statusCode: 401,
            clientMessage: "Unauthorized",
          }),
        ),
      );
    }

    return yield* $(query((db) => applyBostaWebhook(db, payload)));
  });
