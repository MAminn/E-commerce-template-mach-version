/**
 * Admin: Payment Attempts — read-only visibility into online payments that
 * are NOT (or not yet) orders, plus the two recovery actions. This is not a
 * fulfillment queue; attempts never appear in Orders.
 */
import { z } from "zod";
import { Effect } from "effect";
import { and, count, desc, eq, isNull, or } from "drizzle-orm";
import { adminProcedure, t } from "#root/shared/trpc/server";
import { runBackendEffect, serializeBackendEffectResult } from "#root/shared/backend/effect";
import { order, paymentAttempt, paymentAttemptStatus } from "#root/shared/database/drizzle/schema";
import { ServerError } from "#root/shared/error/server";
import { isFawaterakConfigured } from "#root/shared/config/payment";
import { resolveOrderReference } from "#root/shared/orders/order-reference";
import { finalizePaidAttempt, PAID_STATES, reconcileAttemptWithProvider } from "./service";

const wrap = <A>(fn: () => Promise<A>) =>
  runBackendEffect(
    Effect.tryPromise({
      try: fn,
      catch: (error) =>
        error instanceof ServerError
          ? error
          : new ServerError({
              tag: "PaymentAttemptAdminError",
              cause: error,
              message: error instanceof Error ? error.message : String(error),
              statusCode: 500,
              clientMessage: "Something went wrong — please try again.",
            }),
    }),
  ).then(serializeBackendEffectResult);

const listSchema = z.object({
  /** "exceptions" = paid without an order yet, or effects not yet run. */
  status: z.union([z.enum(paymentAttemptStatus.enumValues), z.literal("exceptions")]).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

const attemptIdSchema = z.object({ attemptId: z.string().uuid() });

export const paymentAttemptsRouter = t.router({
  list: adminProcedure.input(listSchema).query(({ ctx, input }) =>
    wrap(async () => {
      const where =
        input.status === "exceptions"
          ? or(
              eq(paymentAttempt.status, "paid_pending_materialization"),
              and(eq(paymentAttempt.status, "materialized"), isNull(paymentAttempt.effectsClaimedAt)),
            )
          : input.status
            ? eq(paymentAttempt.status, input.status)
            : undefined;

      const rows = await ctx.db
        .select({
          id: paymentAttempt.id,
          createdAt: paymentAttempt.createdAt,
          status: paymentAttempt.status,
          customerName: paymentAttempt.customerName,
          customerEmail: paymentAttempt.customerEmail,
          customerPhone: paymentAttempt.customerPhone,
          total: paymentAttempt.total,
          currency: paymentAttempt.currency,
          promoCode: paymentAttempt.promoCode,
          intentKey: paymentAttempt.intentKey,
          transactionId: paymentAttempt.transactionId,
          providerPaymentMethod: paymentAttempt.providerPaymentMethod,
          failureReason: paymentAttempt.failureReason,
          materializationError: paymentAttempt.materializationError,
          materializationAttempts: paymentAttempt.materializationAttempts,
          paidAt: paymentAttempt.paidAt,
          materializedAt: paymentAttempt.materializedAt,
          effectsClaimedAt: paymentAttempt.effectsClaimedAt,
          orderId: paymentAttempt.orderId,
          reference: paymentAttempt.reference,
          providerCheckedAt: paymentAttempt.providerCheckedAt,
          providerCheckCount: paymentAttempt.providerCheckCount,
          providerCheckResult: paymentAttempt.providerCheckResult,
          providerCheckError: paymentAttempt.providerCheckError,
          nextProviderCheckAt: paymentAttempt.nextProviderCheckAt,
          orderFulfillmentHold: order.fulfillmentHold,
        })
        .from(paymentAttempt)
        .leftJoin(order, eq(order.id, paymentAttempt.orderId))
        .where(where)
        .orderBy(desc(paymentAttempt.createdAt))
        .limit(input.limit)
        .offset(input.offset)
        .execute();

      const [{ value: total } = { value: 0 }] = await ctx.db
        .select({ value: count() })
        .from(paymentAttempt)
        .where(where)
        .execute();

      const byStatus = await ctx.db
        .select({ status: paymentAttempt.status, n: count() })
        .from(paymentAttempt)
        .groupBy(paymentAttempt.status)
        .execute();

      const [{ value: exceptions } = { value: 0 }] = await ctx.db
        .select({ value: count() })
        .from(paymentAttempt)
        .where(
          or(
            eq(paymentAttempt.status, "paid_pending_materialization"),
            and(eq(paymentAttempt.status, "materialized"), isNull(paymentAttempt.effectsClaimedAt)),
          ),
        )
        .execute();

      return {
        items: rows.map((r) => ({
          ...r,
          reference: resolveOrderReference(r),
          needsAttention:
            r.status === "paid_pending_materialization" ||
            (r.status === "materialized" && !r.effectsClaimedAt),
        })),
        total,
        counts: Object.fromEntries(byStatus.map((s) => [s.status, s.n])) as Record<string, number>,
        exceptions,
      };
    }),
  ),

  /** Number of verified payments still waiting for their order — for the Orders page banner. */
  exceptionCount: adminProcedure.query(({ ctx }) =>
    wrap(async () => {
      const [{ value } = { value: 0 }] = await ctx.db
        .select({ value: count() })
        .from(paymentAttempt)
        .where(eq(paymentAttempt.status, "paid_pending_materialization"))
        .execute();
      return { paidWithoutOrder: value };
    }),
  ),

  /** Retry creating the order for a verified payment (no provider call, no new charge). */
  retryMaterialization: adminProcedure.input(attemptIdSchema).mutation(({ ctx, input }) =>
    wrap(async () => {
      const [row] = await ctx.db
        .select({ status: paymentAttempt.status })
        .from(paymentAttempt)
        .where(eq(paymentAttempt.id, input.attemptId))
        .limit(1)
        .execute();
      if (!row) {
        throw new ServerError({ tag: "NotFound", statusCode: 404, clientMessage: "Payment attempt not found" });
      }
      if (!PAID_STATES.includes(row.status)) {
        throw new ServerError({
          tag: "BadRequest",
          statusCode: 400,
          clientMessage: "Only a verified paid attempt can be turned into an order. Use “Check with Fawaterak” first.",
        });
      }
      return finalizePaidAttempt(ctx.db, input.attemptId, null);
    }),
  ),

  /** Ask Fawaterak for the attempt's current state; finalizes it if verified paid. */
  recheckProvider: adminProcedure.input(attemptIdSchema).mutation(({ ctx, input }) =>
    wrap(async () => {
      if (!isFawaterakConfigured()) {
        throw new ServerError({ tag: "BadRequest", statusCode: 400, clientMessage: "Fawaterak is not configured" });
      }
      const [row] = await ctx.db
        .select({
          id: paymentAttempt.id,
          status: paymentAttempt.status,
          intentKey: paymentAttempt.intentKey,
          total: paymentAttempt.total,
          providerCheckCount: paymentAttempt.providerCheckCount,
        })
        .from(paymentAttempt)
        .where(eq(paymentAttempt.id, input.attemptId))
        .limit(1)
        .execute();
      if (!row) {
        throw new ServerError({ tag: "NotFound", statusCode: 404, clientMessage: "Payment attempt not found" });
      }
      const outcome = PAID_STATES.includes(row.status)
        ? await finalizePaidAttempt(ctx.db, row.id, null)
        : row.intentKey
          ? (await reconcileAttemptWithProvider(ctx.db, row)).outcome
          : null;
      const [after] = await ctx.db
        .select({ status: paymentAttempt.status, orderId: paymentAttempt.orderId })
        .from(paymentAttempt)
        .where(eq(paymentAttempt.id, row.id))
        .limit(1)
        .execute();
      return { outcome: outcome ?? { kind: "unchanged" as const }, status: after?.status, orderId: after?.orderId ?? null };
    }),
  ),
});

