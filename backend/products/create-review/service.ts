import type { ClientSession } from "#root/backend/auth/shared/entities";
import { query } from "#root/shared/database/drizzle/db";
import { productReview, product } from "#root/shared/database/drizzle/schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

/** Length limits shared by the storefront form and the CSV importer so an
 * imported review can never exceed what a customer could submit. */
export const REVIEW_LIMITS = {
  userName: { min: 2, max: 50 },
  comment: { min: 3, max: 500 },
  rating: { min: 1, max: 5 },
} as const;

export const createReviewSchema = z.object({
  productId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  userName: z.string().min(REVIEW_LIMITS.userName.min).max(REVIEW_LIMITS.userName.max),
  rating: z.number().int().min(REVIEW_LIMITS.rating.min).max(REVIEW_LIMITS.rating.max),
  comment: z.string().min(REVIEW_LIMITS.comment.min).max(REVIEW_LIMITS.comment.max),
  imageId: z.string().uuid().optional(),
});

export const createReview = (
  input: z.infer<typeof createReviewSchema>,
  clientSession?: ClientSession
) =>
  Effect.gen(function* ($) {
    return yield* $(
      query(async (db) => {
        // Check if product exists
        const productExists = await db
          .select({ id: product.id })
          .from(product)
          .where(eq(product.id, input.productId))
          .execute();

        if (productExists.length === 0) {
          return {
            success: false,
            error: "Product not found",
          };
        }

        const newReview = await db
          .insert(productReview)
          .values({
            productId: input.productId,
            userId: input.userId,
            userName: input.userName,
            rating: input.rating,
            comment: input.comment,
            imageId: input.imageId,
            // New reviews always start pending — admin approves/rejects
            // before they become publicly visible.
            status: "pending",
          })
          .returning()
          .execute();

        return {
          success: true,
          review: newReview[0],
        };
      })
    );
  });
