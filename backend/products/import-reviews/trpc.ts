import {
  runBackendEffect,
  serializeBackendEffectResult,
} from "#root/shared/backend/effect";
import { adminProcedure, provideDatabase } from "#root/shared/trpc/server";
import {
  importReviews,
  previewReviewImport,
  reviewImportInputSchema,
  reviewImportSchema,
} from "./service";

// Both are mutations even though preview is read-only: the CSV text travels
// in the request body, and tRPC queries put their input in the URL.

export const previewReviewImportProcedure = adminProcedure
  .input(reviewImportInputSchema)
  .mutation(async ({ ctx, input }) => {
    return await runBackendEffect(
      previewReviewImport(input).pipe(provideDatabase(ctx)),
    ).then(serializeBackendEffectResult);
  });

export const importReviewsProcedure = adminProcedure
  .input(reviewImportSchema)
  .mutation(async ({ ctx, input }) => {
    return await runBackendEffect(
      importReviews(input).pipe(provideDatabase(ctx)),
    ).then(serializeBackendEffectResult);
  });
