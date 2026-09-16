import { t, adminProcedure, provideDatabase } from "#root/shared/trpc/server";
import {
  runBackendEffect,
  serializeBackendEffectResult,
} from "#root/shared/backend/effect";
import { testServerPixel, testServerPixelSchema } from "./service";

export const pixelTestRouter = t.router({
  /**
   * Send one synthetic event to a single saved pixel configuration through the
   * real server adapter and report exactly what the platform API answered.
   *
   * Admin-only: it uses the stored access token, so it must never be reachable
   * by a storefront visitor.
   */
  server: adminProcedure
    .input(testServerPixelSchema)
    .mutation(async ({ ctx, input }) => {
      return await runBackendEffect(
        testServerPixel(input).pipe(provideDatabase(ctx)),
      ).then(serializeBackendEffectResult);
    }),
});
