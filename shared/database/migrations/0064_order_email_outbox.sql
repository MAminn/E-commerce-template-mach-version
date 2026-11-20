-- Additive: durable, observable transactional order emails.
--
-- Order confirmations and new-order admin notifications move from an inline
-- send inside checkout (result discarded, never retried, never recorded) to
-- the existing scheduled_email queue, written in the same transaction as the
-- order. This migration only ADDS:
--   * two email_automation_type values for the transactional rows;
--   * three order_log_action values so each order's activity log shows
--     queued / sent (provider accepted) / failed;
--   * nullable provider-evidence columns on scheduled_email.
-- No existing row, column or value changes. ADD VALUE cannot run inside a
-- transaction block on older Postgres; the boot runner executes each
-- statement on its own.
--
-- FORMATTING: shared/database/auto-migrate.ts splits this file on the
-- statement-breakpoint marker and DISCARDS any chunk beginning with a SQL
-- line comment, so this header ends with its own breakpoint.
--> statement-breakpoint
ALTER TYPE "public"."email_automation_type" ADD VALUE IF NOT EXISTS 'order_confirmation';
--> statement-breakpoint
ALTER TYPE "public"."email_automation_type" ADD VALUE IF NOT EXISTS 'order_admin_notification';
--> statement-breakpoint
ALTER TYPE "public"."order_log_action" ADD VALUE IF NOT EXISTS 'confirmation_email_queued';
--> statement-breakpoint
ALTER TYPE "public"."order_log_action" ADD VALUE IF NOT EXISTS 'confirmation_email_sent';
--> statement-breakpoint
ALTER TYPE "public"."order_log_action" ADD VALUE IF NOT EXISTS 'confirmation_email_failed';
--> statement-breakpoint
ALTER TABLE "scheduled_email" ADD COLUMN IF NOT EXISTS "provider_message_id" text;
--> statement-breakpoint
ALTER TABLE "scheduled_email" ADD COLUMN IF NOT EXISTS "provider_response" text;
--> statement-breakpoint
ALTER TABLE "scheduled_email" ADD COLUMN IF NOT EXISTS "last_attempt_at" timestamp with time zone;
