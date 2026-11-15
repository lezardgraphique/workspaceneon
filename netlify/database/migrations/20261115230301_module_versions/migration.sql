CREATE TABLE "module_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"module_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"tree" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "module_versions_owner_idx" ON "module_versions" ("user_id","module_id","created_at");