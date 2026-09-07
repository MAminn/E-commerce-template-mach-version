ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "sku" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "supplement_info" jsonb;