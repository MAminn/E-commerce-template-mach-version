-- Additive: unique order / payment references + provider reconciliation state.
--
-- 1. order_reference is a registry of every customer/merchant-facing
--    "ORD-XXXXXXXX" reference. Its primary key is what makes a reference
--    unique across COD orders AND payment attempts (an attempt's order reuses
--    the attempt's reference). New references are claimed with
--    INSERT … ON CONFLICT DO NOTHING; a conflict means "pick another id".
--    Existing orders keep their old, unstored reference (first 8 hex chars of
--    the id); those values are registered here too — ON CONFLICT DO NOTHING
--    collapses the legacy duplicates — so a new reference can never equal a
--    number an existing customer already holds. Nothing existing is rewritten.
-- 2. order.reference / payment_attempt.reference store the new references
--    (NULL for legacy rows, which keep displaying their legacy number).
-- 3. payment_attempt provider_* columns record automatic reconciliation of
--    pending attempts with Fawaterak (last check, result, error, next check).
--    next_provider_check_at is a polling schedule, NOT an expiry.
--
-- FORMATTING: shared/database/auto-migrate.ts splits this file on the
-- statement-breakpoint marker and DISCARDS any chunk beginning with a SQL
-- line comment, so this header ends with its own breakpoint.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_reference" (
	"reference" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "order_reference" ("reference", "kind") SELECT DISTINCT 'ORD-' || upper(substr(replace("id"::text, '-', ''), 1, 8)), 'legacy' FROM "order" ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "order_reference" ("reference", "kind") SELECT DISTINCT 'ORD-' || upper(substr(replace("id"::text, '-', ''), 1, 8)), 'legacy' FROM "payment_attempt" ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "reference" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_reference_idx" ON "order" USING btree ("reference");
--> statement-breakpoint
ALTER TABLE "payment_attempt" ADD COLUMN IF NOT EXISTS "reference" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempt_reference_idx" ON "payment_attempt" USING btree ("reference");
--> statement-breakpoint
ALTER TABLE "payment_attempt" ADD COLUMN IF NOT EXISTS "provider_checked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "payment_attempt" ADD COLUMN IF NOT EXISTS "provider_check_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "payment_attempt" ADD COLUMN IF NOT EXISTS "provider_check_result" text;
--> statement-breakpoint
ALTER TABLE "payment_attempt" ADD COLUMN IF NOT EXISTS "provider_check_error" text;
--> statement-breakpoint
ALTER TABLE "payment_attempt" ADD COLUMN IF NOT EXISTS "next_provider_check_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_attempt_reconcile_idx" ON "payment_attempt" USING btree ("status", "next_provider_check_at");
