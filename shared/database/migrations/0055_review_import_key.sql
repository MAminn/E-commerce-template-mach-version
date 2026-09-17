-- Additive: identity column for CSV-imported product reviews.
--
-- import_key is NULL for every existing row (storefront reviews) and the
-- unique index treats NULLs as distinct, so nothing is backfilled and no
-- existing row can violate it. Re-importing the same CSV row hits the index
-- and is skipped by ON CONFLICT DO NOTHING in the importer.
--
-- FORMATTING: shared/database/auto-migrate.ts splits this file on the
-- statement-breakpoint marker and DISCARDS any chunk beginning with a SQL
-- line comment, so this header ends with its own breakpoint and each
-- statement below stands alone.
--> statement-breakpoint
ALTER TABLE "product_review" ADD COLUMN IF NOT EXISTS "import_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_review_import_key_idx" ON "product_review" USING btree ("import_key");
