CREATE TABLE "intel_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"candidates" integer,
	"profiled" integer,
	"failed" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "trader_profiles" (
	"venue" text NOT NULL,
	"address" text NOT NULL,
	"display_name" text,
	"score" integer NOT NULL,
	"copyable" boolean NOT NULL,
	"flags" text[] NOT NULL,
	"account_value" double precision,
	"pnl_week" double precision,
	"pnl_month" double precision,
	"pnl_all" double precision,
	"roi_month" double precision,
	"roi_all" double precision,
	"max_drawdown" double precision,
	"win_rate" double precision,
	"trade_count" integer NOT NULL,
	"profile" jsonb NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "intel_runs_venue_started_idx" ON "intel_runs" USING btree ("venue","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trader_profiles_pk" ON "trader_profiles" USING btree ("venue","address");--> statement-breakpoint
CREATE INDEX "trader_profiles_venue_score_idx" ON "trader_profiles" USING btree ("venue","score");