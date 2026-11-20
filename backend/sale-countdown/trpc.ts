import { ServerError } from "#root/shared/error/server";
import { adminProcedure, t } from "#root/shared/trpc/server";
import {
  getAdminCountdownState,
  rollbackSaleEnd,
  rollbackSchema,
  setItemsSchema,
  setSaleItems,
  startCountdown,
  startSchema,
  stopCountdown,
  updateCountdownExpiration,
  updateCountdownSettings,
  updateExpirationSchema,
  updateSettingsSchema,
} from "./service";

/** { success, result } | { success: false, error } — the dashboard's usual shape. */
async function wrap<T>(fn: () => Promise<T>) {
  try {
    return { success: true as const, result: await fn() };
  } catch (error) {
    if (error instanceof ServerError) {
      return { success: false as const, error: error.clientMessage };
    }
    console.error("[SaleCountdown] Admin action failed:", error);
    return { success: false as const, error: "Something went wrong. Nothing was changed." };
  }
}

/** Admin and superadmin only (adminProcedure). */
export const saleCountdownRouter = t.router({
  get: adminProcedure.query(({ ctx }) => wrap(() => getAdminCountdownState(ctx.db))),

  updateSettings: adminProcedure
    .input(updateSettingsSchema)
    .mutation(({ ctx, input }) =>
      wrap(() => updateCountdownSettings(ctx.db, input, ctx.clientSession.email)),
    ),

  setItems: adminProcedure
    .input(setItemsSchema)
    .mutation(({ ctx, input }) => wrap(() => setSaleItems(ctx.db, input, ctx.clientSession.email))),

  start: adminProcedure
    .input(startSchema)
    .mutation(({ ctx, input }) => wrap(() => startCountdown(ctx.db, input, ctx.clientSession.email))),

  updateExpiration: adminProcedure
    .input(updateExpirationSchema)
    .mutation(({ ctx, input }) =>
      wrap(() => updateCountdownExpiration(ctx.db, input, ctx.clientSession.email)),
    ),

  stop: adminProcedure.mutation(({ ctx }) =>
    wrap(() => stopCountdown(ctx.db, ctx.clientSession.email)),
  ),

  rollbackSaleEnd: adminProcedure
    .input(rollbackSchema)
    .mutation(({ ctx, input }) => wrap(() => rollbackSaleEnd(ctx.db, input, ctx.clientSession.email))),
});
