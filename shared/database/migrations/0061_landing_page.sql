-- Additive: the fixed /landing-2 marketing page.
--
-- 1. user_role gains 'media_buyer' — an account that may edit the Landing 2
--    page's content and nothing else. Every other admin gate allow-lists
--    admin/superadmin, so no existing permission widens. ADD VALUE cannot run
--    inside a transaction block on older Postgres; the boot runner executes
--    each statement on its own, outside one.
-- 2. store_settings.landing_page_config holds the hero and the ordered list of
--    existing product ids. Nullable: NULL means "use the shipped defaults"
--    (shared/landing-page/config.ts), so nothing needs backfilling.
--
-- FORMATTING: shared/database/auto-migrate.ts splits this file on the
-- statement-breakpoint marker and DISCARDS any chunk beginning with a SQL
-- line comment, so this header ends with its own breakpoint.
--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'media_buyer';
--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "landing_page_config" jsonb;
