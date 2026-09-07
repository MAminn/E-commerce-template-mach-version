import { formatCategoryName } from "#root/shared/utils/format";
import { query } from "#root/shared/database/drizzle/db";
import {
  category,
  file,
  product,
  productCategory,
  productImage,
  productVariant,
} from "#root/shared/database/drizzle/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { ServerError } from "#root/shared/error/server";
import type { SupplementInfo } from "#root/shared/types/supplement-info";

// Accepts either the product's slug (new URLs) or its raw UUID (old
// bookmarked/shared links) — the single query below matches either.
export const getProductByIdSchema = z.object({
  productId: z.string().min(1, "Invalid product ID format"),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getProductById = (input: z.infer<typeof getProductByIdSchema>) =>
  Effect.gen(function* ($) {
    const result = yield* $(
      query(async (db) => {
        // product.id is a uuid column — comparing it to a non-UUID slug
        // string throws at the Postgres driver level, so only include that
        // branch when the identifier actually looks like a UUID.
        const identifierMatch = UUID_RE.test(input.productId)
          ? or(
              eq(product.slug, input.productId),
              eq(product.id, input.productId),
            )
          : eq(product.slug, input.productId);

        // Fetch the main product details
        const productResult = await db
          .select({
            product: product,
            primaryCategory: category,
            primaryImageFile: file,
          })
          .from(product)
          .innerJoin(category, eq(product.categoryId, category.id))
          .leftJoin(file, eq(product.imageId, file.id))
          .where(
            and(
              identifierMatch,
              eq(product.deleted, false), // Exclude soft-deleted products
              eq(product.hidden, false), // Exclude hidden products
              eq(category.deleted, false), // Ensure primary category is not deleted
            ),
          )
          .limit(1);

        if (productResult.length === 0) {
          // No product found, or category criteria not met
          return null;
        }

        // Correctly access the nested properties
        const productData = productResult[0];
        if (!productData) return null;

        const {
          product: foundProduct,
          primaryCategory,
          primaryImageFile,
        } = productData;

        // Fetch all associated images for this product
        const images = await db
          .select({
            id: productImage.fileId,
            url: file.diskname,
            diskname: file.diskname,
            isPrimary: productImage.isPrimary,
          })
          .from(productImage)
          .innerJoin(file, eq(productImage.fileId, file.id))
          .where(eq(productImage.productId, foundProduct.id))
          .orderBy(productImage.sortOrder, productImage.isPrimary); // Order by sort then primary

        // Fetch all associated categories for this product
        const categories = await db
          .select({
            id: productCategory.categoryId,
            name: category.name,
            isPrimary: productCategory.isPrimary, // Include this if needed later
          })
          .from(productCategory)
          .innerJoin(category, eq(productCategory.categoryId, category.id))
          .where(
            and(
              eq(productCategory.productId, foundProduct.id),
              eq(category.deleted, false), // Ensure associated categories are not deleted
            ),
          );
        // No need to order here unless required

        // Fetch all variants for this product
        const variants = await db
          .select()
          .from(productVariant)
          .where(eq(productVariant.productId, foundProduct.id));

        // ── Curated product relationships ────────────────────────────────
        // Both lists store product IDs only; name/price/image/stock are always
        // resolved live here so the relationship can never hold stale copies of
        // another product's data. Deleted and hidden products are dropped, and
        // the admin's manual ordering is restored after the query (SQL IN does
        // not preserve the order of the id list).
        const resolveProductRefs = async (ids: string[]) => {
          const wanted = ids.filter((id) => id !== foundProduct.id);
          if (wanted.length === 0) return [];
          const rows = await db
            .select({
              id: product.id,
              slug: product.slug,
              name: product.name,
              price: product.price,
              discountPrice: product.discountPrice,
              stock: product.stock,
              imageUrl: file.diskname,
              categoryName: category.name,
            })
            .from(product)
            .leftJoin(file, eq(product.imageId, file.id))
            .innerJoin(category, eq(product.categoryId, category.id))
            .where(
              and(
                inArray(product.id, wanted),
                eq(product.deleted, false),
                eq(product.hidden, false),
              ),
            );
          const byId = new Map(rows.map((r) => [r.id, r]));
          return wanted
            .map((id) => byId.get(id))
            .filter((r): r is (typeof rows)[number] => Boolean(r));
        };

        // Add-ons / Frequently Bought Together. Column name is the legacy
        // "best_layered_with_ids" — kept for data compatibility; the concept is
        // a neutral curated cross-sell list.
        const bestLayeredWith = await resolveProductRefs(
          (foundProduct.bestLayeredWithIds ?? []) as string[],
        );

        // Manually curated related products. Empty/unset lets the caller fall
        // back to same-category suggestions.
        const curatedRelated = await resolveProductRefs(
          foundProduct.supplementInfo?.relatedProductIds ?? [],
        );

        // Format the final product object
        const formattedProduct = {
          ...foundProduct,
          price: Number(foundProduct.price),
          discountPrice: foundProduct.discountPrice
            ? Number(foundProduct.discountPrice)
            : null,
          imageUrl: primaryImageFile?.diskname || null,
          categoryName: formatCategoryName(primaryCategory.name),
          available: foundProduct.stock > 0,
          images: images.map((img) => ({
            id: img.id,
            url: img.diskname ? `/uploads/${img.diskname}` : "",
            diskname: img.diskname,
            isPrimary: img.isPrimary,
          })),
          imagesCombined:
            images.length > 0
              ? images.map((img) => ({
                  url: img.diskname ? `/uploads/${img.diskname}` : "",
                  isPrimary: img.isPrimary,
                }))
              : primaryImageFile?.diskname
                ? [
                    {
                      url: `/uploads/${primaryImageFile.diskname}`,
                      isPrimary: true,
                    },
                  ]
                : [],
          categories: categories.map((cat) => ({
            id: cat.id,
            name: formatCategoryName(cat.name),
          })),
          variants: variants.map((v) => ({
            name: v.name,
            values: (v.values as any[]).map((val) =>
              typeof val === "string" ? { value: val, priceModifier: 0 } : val,
            ),
          })),
          rating: 0,
          reviewCount: 0,
          bestLayeredWith: bestLayeredWith.map((p) => ({
            id: p.id,
            slug: p.slug,
            name: p.name,
            price: Number(p.price),
            discountPrice: p.discountPrice ? Number(p.discountPrice) : null,
            stock: p.stock,
            available: p.stock > 0,
            imageUrl: p.imageUrl ? `/uploads/${p.imageUrl}` : undefined,
            images: p.imageUrl
              ? [{ url: `/uploads/${p.imageUrl}`, isPrimary: true }]
              : [],
            categoryName: formatCategoryName(p.categoryName),
          })),
          curatedRelatedProducts: curatedRelated.map((p) => ({
            id: p.id,
            slug: p.slug,
            name: p.name,
            price: Number(p.price),
            discountPrice: p.discountPrice ? Number(p.discountPrice) : null,
            stock: p.stock,
            available: p.stock > 0,
            imageUrl: p.imageUrl ? `/uploads/${p.imageUrl}` : undefined,
            images: p.imageUrl
              ? [{ url: `/uploads/${p.imageUrl}`, isPrimary: true }]
              : [],
            categoryName: formatCategoryName(p.categoryName),
          })),
        };

        return formattedProduct;
      }),
    );
    // If result is null (product not found or criteria not met), Effect will handle it.
    // Consider adding specific error handling/tagging if needed.
    if (!result) {
      return yield* $(
        Effect.fail(
          new ServerError({
            tag: "NotFound",
            statusCode: 404,
            clientMessage: "Product not found or not available",
          }),
        ),
      );
    }
    return result;
  });

// Define the expected output type based on the successful result of the query function
// This assumes the structure returned by `formattedProduct` when successful
// Note: This might need manual adjustment if the structure changes significantly
export type ProductByIdResult = {
  id: string;
  slug: string | null;
  name: string;
  description: string;
  imageId: string;
  categoryId: string;
  price: number;
  discountPrice: number | null;
  createdAt: Date;
  updatedAt: Date | null;
  stock: number;
  imageUrl: string | null;
  categoryName: string;
  available: boolean;
  images: { id: string; url: string; diskname: string; isPrimary: boolean }[];
  imagesCombined: { url: string; isPrimary: boolean }[];
  categories: { id: string; name: string }[];
  variants: { name: string; values: string[] }[];
  rating: number;
  reviewCount: number;
  sku?: string | null;
  supplementInfo?: SupplementInfo | null;
  fragranceInfo?: {
    tagline?: string;
    taglineAr?: string;
    about?: string;
    aboutAr?: string;
    longevity?: string;
    longevityAr?: string;
    whenToUse?: string;
    whenToUseAr?: string;
    concentration?: string;
    scentIntensity?: string;
    scentIntensityAr?: string;
    gender?: string;
    genderAr?: string;
    topNotes?: string;
    topNotesAr?: string;
    middleNotes?: string;
    middleNotesAr?: string;
    baseNotes?: string;
    baseNotesAr?: string;
    ingredients?: string;
    ingredientsAr?: string;
    badges?: string[];
  } | null;
  bestLayeredWith: {
    id: string;
    slug: string | null;
    name: string;
    price: number;
    discountPrice: number | null;
    stock: number;
    available: boolean;
    imageUrl?: string;
    images: { url: string; isPrimary?: boolean }[];
    categoryName: string;
  }[];
};
