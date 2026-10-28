CREATE TABLE "custom_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"slug" text NOT NULL CONSTRAINT "custom_blocks_slug_unique" UNIQUE,
	"description" text DEFAULT '' NOT NULL,
	"signature" text NOT NULL CONSTRAINT "custom_blocks_signature_unique" UNIQUE,
	"section" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
