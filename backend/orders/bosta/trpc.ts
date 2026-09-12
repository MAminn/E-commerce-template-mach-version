/**
 * Admin tRPC procedures for Bosta delivery management.
 *
 * All procedures are feature-flagged — they return a clear error if Bosta
 * is not configured, so nothing breaks for stores without the env key.
 */
import {
  adminProcedure,
  publicProcedure,
  provideDatabase,
  t,
} from "#root/shared/trpc/server";
import { runBackendEffect, serializeBackendEffectResult } from "#root/shared/backend/effect";
import { Effect } from "effect";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { query } from "#root/shared/database/drizzle/db";
import { order } from "#root/shared/database/drizzle/schema";
import { ServerError } from "#root/shared/error/server";
import { cancelBostaDelivery, isBostaEnabled } from "./service";
import { persistBostaSyncStatus } from "./sync-status";
import { getBostaCheckoutLocations } from "./districts";
import { dispatchOrderToBosta, type BostaDispatchResult } from "./dispatch";
import { logOrderEvent } from "#root/backend/orders/order-log";

function requireBosta() {
  if (!isBostaEnabled()) {
    throw new ServerError({
      tag: "NotConfigured",
      message: "Bosta is not configured (SYN_BOSTA_KEY missing)",
      statusCode: 503,
      clientMessage: "Bosta integration is not enabled for this store",
    });
  }
}

/** Translate a non-"sent" dispatch result into the error the admin UI shows. */
function dispatchResultToError(
  result: Exclude<BostaDispatchResult, { status: "sent" }>,
): ServerError<string> {
  switch (result.status) {
    case "skipped":
      return new ServerError({
        tag: "NotConfigured",
        statusCode: 503,
        clientMessage: "Bosta is not configured",
      });
    case "blocked":
      return new ServerError({
        tag:
          result.code === "not_found"
            ? "NotFound"
            : result.code === "payment_not_confirmed"
              ? "PaymentNotConfirmed"
              : "AlreadyExists",
        statusCode: result.code === "not_found" ? 404 : 409,
        clientMessage: result.reason,
      });
    case "failed":
      return new ServerError({
        tag: result.code === "validation" ? "BadRequest" : "ExternalServiceError",
        statusCode: result.code === "validation" ? 422 : 502,
        clientMessage: result.reason,
      });
  }
}

export const bostaRouter = t.router({
  /** Checkout: whether Bosta shipping location pickers should be shown */
  checkoutIsEnabled: publicProcedure.query(() => ({
    enabled: isBostaEnabled(),
  })),

  /** Checkout: city / zone / district tree from Bosta API (drop-off-capable only) */
  listShippingLocations: publicProcedure.query(async () => {
    if (!isBostaEnabled()) {
      return { cities: [] };
    }
    const cities = await getBostaCheckoutLocations();
    return { cities };
  }),

  /** Admin: whether Bosta integration is active (for dashboard UI) */
  isEnabled: adminProcedure.query(() => ({
    enabled: isBostaEnabled(),
  })),

  /**
   * Admin: manually push an existing order to Bosta (e.g. if auto-send failed,
   * or for orders placed before the integration was enabled).
   *
   * Same rules as every automatic path (see dispatch.ts): online orders must
   * be paid, an order with a live delivery is never re-sent, concurrent
   * sends are serialised by the atomic claim, and the exact checkout
   * district is required — historical orders without one fail with a clear
   * message instead of a guessed district.
   *
   * `resend: true` is the only way to create a new delivery for an order
   * whose previous delivery was terminated.
   */
  sendOrder: adminProcedure
    .input(z.object({ orderId: z.string().uuid(), resend: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      return await runBackendEffect(
        Effect.gen(function* ($) {
          requireBosta();

          const result = yield* $(
            query((db) =>
              dispatchOrderToBosta(db, input.orderId, {
                trigger: "manual",
                actor: ctx.clientSession.email,
                resendAfterCancel: input.resend === true,
              }),
            ),
          );

          if (result.status !== "sent") {
            return yield* $(Effect.fail(dispatchResultToError(result)));
          }

          return {
            deliveryId: result.deliveryId,
            trackingNumber: result.trackingNumber,
          };
        }).pipe(provideDatabase(ctx)),
      ).then(serializeBackendEffectResult);
    }),

  /**
   * Admin: terminate the order's Bosta delivery (by tracking number).
   * Needs a Full Access API key; with Read/Write the call fails gracefully
   * and the admin is told to cancel from the Bosta dashboard.
   */
  cancelDelivery: adminProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return await runBackendEffect(
        Effect.gen(function* ($) {
          requireBosta();

          const orderRow = yield* $(
            query(async (db) => {
              const rows = await db
                .select({
                  id: order.id,
                  bostaDeliveryId: order.bostaDeliveryId,
                  bostaTrackingNumber: order.bostaTrackingNumber,
                  bostaSyncStatus: order.bostaSyncStatus,
                })
                .from(order)
                .where(eq(order.id, input.orderId))
                .execute();
              return rows[0] ?? null;
            }),
          );

          if (!orderRow) {
            return yield* $(
              Effect.fail(
                new ServerError({ tag: "NotFound", statusCode: 404, clientMessage: "Order not found" }),
              ),
            );
          }

          if (orderRow.bostaSyncStatus === "cancelled") {
            return yield* $(
              Effect.fail(
                new ServerError({
                  tag: "AlreadyExists",
                  statusCode: 409,
                  clientMessage: "This order's Bosta delivery is already terminated",
                }),
              ),
            );
          }

          const trackingNumber = orderRow.bostaTrackingNumber?.trim();
          if (!trackingNumber) {
            return yield* $(
              Effect.fail(
                new ServerError({
                  tag: "NotFound",
                  statusCode: 404,
                  clientMessage: "No Bosta tracking number on this order — nothing to cancel",
                }),
              ),
            );
          }

          const outcome = yield* $(Effect.promise(() => cancelBostaDelivery(trackingNumber)));

          if (!outcome.success) {
            yield* $(
              Effect.promise(() =>
                logOrderEvent({
                  orderId: input.orderId,
                  action: "bosta_send_failed",
                  note: `Cancel of Bosta delivery ${trackingNumber} by ${ctx.clientSession.email} failed: ${outcome.error}`,
                }),
              ),
            );
            return yield* $(
              Effect.fail(
                new ServerError({
                  tag: outcome.permissionDenied ? "Forbidden" : "ExternalServiceError",
                  statusCode: outcome.permissionDenied ? 403 : 502,
                  clientMessage: outcome.error,
                }),
              ),
            );
          }

          yield* $(Effect.promise(() => persistBostaSyncStatus(input.orderId, "cancelled")));

          yield* $(
            Effect.promise(() =>
              logOrderEvent({
                orderId: input.orderId,
                action: "bosta_cancelled",
                note: `Bosta delivery ${trackingNumber} (id ${orderRow.bostaDeliveryId ?? "?"}) terminated by ${ctx.clientSession.email}`,
              }),
            ),
          );

          return { success: true, trackingNumber };
        }).pipe(provideDatabase(ctx)),
      ).then(serializeBackendEffectResult);
    }),
});
