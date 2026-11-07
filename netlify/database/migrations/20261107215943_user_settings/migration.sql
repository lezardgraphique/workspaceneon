CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY,
	"prefs" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
