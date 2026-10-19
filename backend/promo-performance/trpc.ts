/**
 * Admin: Promo Performance — read-only revenue report per promo code, with
 * each code's orders for commission review. Admins and superadmins only.
 */
import { Effect } from "effect";
import { z } from "zod";
import { runBackendEffect, serializeBackendEffectResult } from "#root/shared/backend/effect";
import { ServerError } from "#root/shared/error/server";
import { boundedReportRangeSchema } from "#root/shared/promo-performance/report";
import { adminProcedure, t } from "#root/shared/trpc/server";
import { getPromoOrders, getPromoPerformanceSummary, promoOrdersInputSchema } from "./service";

const wrap = <A>(fn: () => Promise<A>) =>
  runBackendEffect(
    Effect.tryPromise({
      try: fn,
      catch: (error) =>
        error instanceof ServerError
          ? error
          : new ServerError({
              tag: "PromoPerformanceError",
              cause: error,
              message: error instanceof Error ? error.message : String(error),
              statusCode: 500,
              clientMessage: "Couldn't load the promo performance report — please try again.",
            }),
    }),
  ).then(serializeBackendEffectResult);

export const promoPerformanceRouter = t.router({
  summary: adminProcedure
    .input(z.object({ range: boundedReportRangeSchema }))
    .query(({ ctx, input }) => wrap(() => getPromoPerformanceSummary(ctx.db, input.range))),

  orders: adminProcedure
    .input(promoOrdersInputSchema)
    .query(({ ctx, input }) => wrap(() => getPromoOrders(ctx.db, input))),
});
