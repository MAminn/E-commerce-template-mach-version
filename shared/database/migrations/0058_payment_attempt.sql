-- Additive: payment-attempt-first online checkout (Fawaterak).
--
-- An online checkout no longer creates an "order" row before payment. It
-- creates a payment_attempt holding the frozen, priced checkout snapshot; the
-- real order is materialized only after the provider verifies the payment.
-- The materialized order reuses the attempt's id, so order.id's primary key
-- is itself the "one order per paid attempt" guarantee, and the merchant
-- reference Fawaterak shows (ORD-XXXXXXXX) matches the customer's order
-- number.
--
-- order.fulfillment_hold marks a PAID order that must not be prepared or
-- shipped (e.g. "stock_conflict": stock ran out while the customer was
-- paying). NULL means no hold, so every existing order is unaffected.
--
-- Nothing is backfilled. Legacy online orders created under the old
-- order-first flow keep working through the legacy webhook/verify branch.
--
-- FORMATTING: shared/database/auto-migrate.ts splits this file on the
-- statement-breakpoint marker and DISCARDS any chunk beginning with a SQL
-- line comment, so this header ends with its own breakpoint.
--> statement-breakpoint
CREATE TYPE "public"."payment_attempt_status" AS ENUM('created', 'session_failed', 'pending', 'failed', 'cancelled', 'expired', 'paid_pending_materialization', 'materialized');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" "payment_method" DEFAULT 'fawaterak' NOT NULL,
	"status" "payment_attempt_status" DEFAULT 'created' NOT NULL,
	"order_id" uuid,
	"user_id" text,
	"cart_session_token" text,
	"fingerprint" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text NOT NULL,
	"order_snapshot" jsonb NOT NULL,
	"items_snapshot" jsonb NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"offer_discount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"promo_discount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(10, 2),
	"shipping" numeric(10, 2) NOT NULL,
	"tax" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"promo_code_id" uuid,
	"promo_code" text,
	"intent_key" text,
	"payment_url" text,
	"transaction_id" text,
	"provider_payment_method" text,
	"gateway_data" jsonb,
	"failure_reason" text,
	"paid_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"materialized_at" timestamp with time zone,
	"materialization_error" text,
	"materialization_attempts" integer DEFAULT 0 NOT NULL,
	"last_materialization_attempt_at" timestamp with time zone,
	"effects_claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_attempt" ADD CONSTRAINT "payment_attempt_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE set null ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "payment_attempt" ADD CONSTRAINT "payment_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "payment_attempt" ADD CONSTRAINT "payment_attempt_promo_code_id_promo_code_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_code"("id") ON DELETE set null ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempt_order_id_idx" ON "payment_attempt" USING btree ("order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempt_intent_key_idx" ON "payment_attempt" USING btree ("intent_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_attempt_status_created_idx" ON "payment_attempt" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_attempt_resume_idx" ON "payment_attempt" USING btree ("cart_session_token", "fingerprint");
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "fulfillment_hold" text;
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "fulfillment_hold_note" text;
