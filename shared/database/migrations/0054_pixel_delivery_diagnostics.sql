-- Additive delivery diagnostics for tracking_event_delivery.
--
-- Every column is nullable and nothing is backfilled, so rows written before
-- this migration stay readable: they simply report no diagnostics, which is
-- accurate — the old pipeline never captured any.
--
-- FORMATTING: shared/database/auto-migrate.ts splits this file on the
-- statement-breakpoint marker and then DISCARDS any chunk beginning with a
-- SQL line comment. A comment sharing a chunk with a statement takes that
-- statement down with it, so this header is terminated by its own breakpoint
-- and every statement below stands alone.
--> statement-breakpoint
ALTER TABLE "tracking_event_delivery" ADD COLUMN IF NOT EXISTS "pixel_config_id" uuid;--> statement-breakpoint
ALTER TABLE "tracking_event_delivery" ADD COLUMN IF NOT EXISTS "status_code" integer;--> statement-breakpoint
ALTER TABLE "tracking_event_delivery" ADD COLUMN IF NOT EXISTS "platform_code" text;--> statement-breakpoint
ALTER TABLE "tracking_event_delivery" ADD COLUMN IF NOT EXISTS "platform_message" text;--> statement-breakpoint
ALTER TABLE "tracking_event_delivery" ADD COLUMN IF NOT EXISTS "request_id" text;--> statement-breakpoint
ALTER TABLE "tracking_event_delivery" ADD COLUMN IF NOT EXISTS "accepted_count" integer;--> statement-breakpoint
ALTER TABLE "tracking_event_delivery" ADD COLUMN IF NOT EXISTS "attempts" integer;--> statement-breakpoint
ALTER TABLE "tracking_event_delivery" ADD COLUMN IF NOT EXISTS "skipped_reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracking_event_delivery"
   ADD CONSTRAINT "tracking_event_delivery_pixel_config_id_pixel_config_id_fk"
   FOREIGN KEY ("pixel_config_id") REFERENCES "public"."pixel_config"("id")
   ON DELETE set null ON UPDATE cascade;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracking_event_delivery_pixel_config_id_idx" ON "tracking_event_delivery" USING btree ("pixel_config_id");
