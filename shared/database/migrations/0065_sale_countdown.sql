-- Additive: reusable sale countdown for the top promotional banner.
--
-- Creates three new, empty tables and nothing else:
--   * sale_countdown       — one settings/state row per store (id 'default'),
--                            created by the dashboard on first save;
--   * sale_countdown_item  — products whose price changes when a countdown
--                            with "automatically end sale" expires, each with
--                            its explicit post-sale price;
--   * sale_countdown_event — append-only audit trail (starts, stops, expiry
--                            with before/after prices, rollbacks).
-- No existing table, row, column or price changes. No row is inserted, so the
-- countdown stays off until an admin configures it.
--
-- FORMATTING: shared/database/auto-migrate.ts splits this file on the
-- statement-breakpoint marker and DISCARDS any chunk beginning with a SQL
-- line comment, so this header ends with its own breakpoint.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sale_countdown" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "duration_minutes" integer DEFAULT 60 NOT NULL,
  "label" text DEFAULT 'Sale ends in' NOT NULL,
  "status" text DEFAULT 'inactive' NOT NULL,
  "run_id" uuid,
  "started_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "auto_end_sale" boolean DEFAULT false NOT NULL,
  "expired_at" timestamp with time zone,
  "sale_ended_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text,
  CONSTRAINT "sale_countdown_status_check" CHECK ("status" IN ('inactive', 'running', 'expired')),
  CONSTRAINT "sale_countdown_duration_check" CHECK ("duration_minutes" BETWEEN 1 AND 525600),
  CONSTRAINT "sale_countdown_running_has_deadline" CHECK ("status" <> 'running' OR "ends_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sale_countdown_item" (
  "id" uuid PRIMARY KEY NOT NULL,
  "product_id" uuid NOT NULL,
  "post_sale_price" numeric(10, 2),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sale_countdown_item_product_id_unique" UNIQUE ("product_id"),
  CONSTRAINT "sale_countdown_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sale_countdown_item_post_sale_price_check" CHECK ("post_sale_price" IS NULL OR "post_sale_price" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sale_countdown_event" (
  "id" uuid PRIMARY KEY NOT NULL,
  "run_id" uuid,
  "type" text NOT NULL,
  "actor" text NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_countdown_event_created_idx" ON "sale_countdown_event" USING btree ("created_at");
