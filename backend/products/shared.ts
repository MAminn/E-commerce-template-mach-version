import { z } from "zod";
import type { createProductSchema } from "./create-product/service";
import { Effect } from "effect";
import { ServerError } from "#root/shared/error/server";

/** Fragrance details shown on the product page (character, longevity, when to wear, notes) */
export const fragranceInfoSchema = z
  .object({
    tagline: z.string().max(200).optional(),
    taglineAr: z.string().max(200).optional(),
    about: z.string().max(1000).optional(),
    aboutAr: z.string().max(1000).optional(),
    longevity: z.string().max(200).optional(),
    longevityAr: z.string().max(200).optional(),
    whenToUse: z.string().max(200).optional(),
    whenToUseAr: z.string().max(200).optional(),
    concentration: z.string().max(50).optional(),
    scentIntensity: z.string().max(50).optional(),
    scentIntensityAr: z.string().max(50).optional(),
    gender: z.string().max(50).optional(),
    genderAr: z.string().max(50).optional(),
    topNotes: z.string().max(300).optional(),
    topNotesAr: z.string().max(300).optional(),
    middleNotes: z.string().max(300).optional(),
    middleNotesAr: z.string().max(300).optional(),
    baseNotes: z.string().max(300).optional(),
    baseNotesAr: z.string().max(300).optional(),
    ingredients: z.string().max(1500).optional(),
    ingredientsAr: z.string().max(1500).optional(),
    badges: z.array(z.string().max(50)).max(10).optional(),
  })
  .optional();

/** One row of the Supplement Facts panel. `amount` and `dailyValue` are both
 * optional — "Calories — 120" has no unit-suffixed amount pattern and many
 * rows (protein, sugars) legitimately carry no %DV. `indent` marks a
 * sub-nutrient nested under the row above it. */
export const supplementFactRowSchema = z.object({
  label: z.string().min(1).max(120),
  amount: z.string().max(60).optional(),
  dailyValue: z.string().max(20).optional(),
  indent: z.boolean().optional(),
});

/** Supplement label data shown on the product page. Entirely optional: legacy
 * (perfume-era) products carry none and require no backfill. Array order is
 * the admin's chosen row order and is preserved verbatim. */
export const supplementInfoSchema = z
  .object({
    detailsHeading: z.string().max(120).optional(),
    netWeight: z.string().max(60).optional(),
    servingSize: z.string().max(60).optional(),
    servingsPerContainer: z.string().max(60).optional(),
    ingredients: z.string().max(4000).optional(),
    directions: z.string().max(2000).optional(),
    warnings: z.string().max(2000).optional(),
    longDescription: z.string().max(6000).optional(),
    badges: z.array(z.string().max(50)).max(10).optional(),
    supplementFacts: z.array(supplementFactRowSchema).max(60).optional(),
    /** Product IDs only — never denormalised product data. */
    relatedProductIds: z.array(z.string().uuid()).max(24).optional(),
  })
  .nullish();

/** Stock-keeping unit. Optional and not unique-constrained yet. */
export const skuSchema = z.string().max(64).nullish();

export const validateProductRules = (
  data: z.infer<typeof createProductSchema>
) =>
  Effect.gen(function* ($) {
    const { variants } = data;

    // Early return if variants is undefined or empty array
    if (!variants || variants.length === 0) return;

    // Check for duplicated variant names
    const variantNames = variants.map((variant) => variant.name);
    const variantNamesSet = new Set();

    for (const name of variantNames) {
      if (variantNamesSet.has(name)) {
        return yield* $(
          Effect.fail(
            new ServerError({
              tag: "DuplicatedVariantName",
              statusCode: 400,
              clientMessage: `Duplicated variant name: ${name}`,
            })
          )
        );
      }
      variantNamesSet.add(name);
    }

    // Check for duplicated variant values
    for (const variant of variants) {
      const variantValues = variant.values;

      if (variantValues.length === 0) {
        return yield* $(
          Effect.fail(
            new ServerError({
              tag: "MissingVariantValues",
              statusCode: 400,
              clientMessage: `Missing variant values for variant: ${variant.name}`,
            })
          )
        );
      }

      const variantValuesSet = new Set();

      for (const value of variantValues) {
        if (variantValuesSet.has(value)) {
          return yield* $(
            Effect.fail(
              new ServerError({
                tag: "DuplicatedVariantValue",
                statusCode: 400,
                clientMessage: `Duplicated variant value: ${value}, in variant ${variant.name}`,
              })
            )
          );
        }
        variantValuesSet.add(value);
      }
    }
  });
