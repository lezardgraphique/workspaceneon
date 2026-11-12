CREATE TABLE "security_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"hits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"rule" text NOT NULL,
	"severity" text NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" text NOT NULL,
	"stats" jsonb DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "security_blocks_status_idx" ON "security_blocks" ("status");--> statement-breakpoint
CREATE INDEX "security_events_at_idx" ON "security_events" ("at");--> statement-breakpoint
CREATE INDEX "security_events_ip_idx" ON "security_events" ("ip","at");