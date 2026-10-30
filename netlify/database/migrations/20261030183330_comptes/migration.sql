CREATE TABLE "legacy_claim" (
	"id" integer PRIMARY KEY DEFAULT 1,
	"user_id" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_blocks" DROP CONSTRAINT "custom_blocks_slug_unique";--> statement-breakpoint
ALTER TABLE "custom_blocks" DROP CONSTRAINT "custom_blocks_signature_unique";--> statement-breakpoint
ALTER TABLE "custom_blocks" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "modules" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "custom_blocks" ADD CONSTRAINT "custom_blocks_user_slug_unique" UNIQUE("user_id","slug");--> statement-breakpoint
ALTER TABLE "custom_blocks" ADD CONSTRAINT "custom_blocks_user_signature_unique" UNIQUE("user_id","signature");--> statement-breakpoint
CREATE INDEX "modules_user_idx" ON "modules" ("user_id","updated_at");