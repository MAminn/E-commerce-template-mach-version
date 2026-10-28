-- Additive: same-product "Buy X Get Y Free" (BOGO) offers.
--
-- The offer definition itself needs no column: cart_offer.condition/reward are
-- JSONB and the new variants (buy_x_get_y / free_gift) live there.
--
-- order_item.is_free_gift / offer_id mark the extra units an offer gave away.
-- They are stored at price 0, so existing rows (all paid) default to false.
-- offer_id has no FK on purpose: the order keeps it after the offer is deleted.
--
-- order.applied_offers freezes the offers applied at checkout (rewards,
-- discounts, gifts) for audit. NULL on every existing order.
--
-- FORMATTING: shared/database/auto-migrate.ts splits this file on the
-- statement-breakpoint marker and DISCARDS any chunk beginning with a SQL
-- line comment, so this header ends with its own breakpoint.
--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "is_free_gift" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN IF NOT EXISTS "offer_id" uuid;
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "applied_offers" jsonb;
