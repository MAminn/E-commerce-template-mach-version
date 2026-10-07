import { Effect } from "effect";
import { adminProcedure } from "#root/shared/trpc/server";
import { runBackendEffect, serializeBackendEffectResult } from "#root/shared/backend/effect";
import { ServerError } from "#root/shared/error/server";
import { resolveCheckoutUserId } from "#root/backend/orders/create-order/service";
import { releaseFulfillmentHold, releaseFulfillmentHoldSchema } from "./service";

export const releaseFulfillmentHoldProcedure = adminProcedure
  .input(releaseFulfillmentHoldSchema)
  .mutation(async ({ ctx, input }) => {
    return await runBackendEffect(
      Effect.tryPromise({
        try: async () => {
          const actorId = await resolveCheckoutUserId(ctx.db, ctx.clientSession);
          return releaseFulfillmentHold(ctx.db, input.orderId, {
            id: actorId,
            email: ctx.clientSession.email,
          });
        },
        catch: (error) =>
          error instanceof ServerError
            ? error
            : new ServerError({
                tag: "FulfillmentHoldReleaseFailed",
                cause: error,
                message: error instanceof Error ? error.message : String(error),
                statusCode: 500,
                clientMessage: "Couldn't release the hold — please try again.",
              }),
      }),
    ).then(serializeBackendEffectResult);
  });
