CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"ip" text,
	"detail" jsonb NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"venue" text NOT NULL,
	"market_id" text NOT NULL,
	"verdict" text NOT NULL,
	"reason_code" text,
	"detail" jsonb NOT NULL,
	"leader_address" text,
	"leader_fill_price" numeric(38, 18),
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encrypted_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_account_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"wrapped_dek" text NOT NULL,
	"kms_key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "engine_leases" (
	"shard" integer PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_intent_id" uuid,
	"user_id" uuid NOT NULL,
	"venue_fill_id" text NOT NULL,
	"market_id" text NOT NULL,
	"side" text NOT NULL,
	"price" numeric(38, 18) NOT NULL,
	"size" numeric(38, 18) NOT NULL,
	"fee" numeric(38, 18) NOT NULL,
	"ts" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kill_switches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text,
	"active" boolean DEFAULT false NOT NULL,
	"flatten" boolean DEFAULT false NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leader_fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leader_id" uuid NOT NULL,
	"venue_market_id" text NOT NULL,
	"side" text NOT NULL,
	"price" numeric(38, 18) NOT NULL,
	"size" numeric(38, 18) NOT NULL,
	"fee" numeric(38, 18) NOT NULL,
	"closed_pnl" numeric(38, 18),
	"ts" timestamp with time zone NOT NULL,
	"venue_fill_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leader_stats" (
	"leader_id" uuid NOT NULL,
	"window" text NOT NULL,
	"pnl" numeric(38, 18) NOT NULL,
	"roi" numeric(38, 18) NOT NULL,
	"win_rate" numeric(38, 18) NOT NULL,
	"max_drawdown" numeric(38, 18) NOT NULL,
	"avg_hold_secs" integer NOT NULL,
	"trade_count" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue" text NOT NULL,
	"address" text NOT NULL,
	"label" text,
	"first_indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_event_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"venue" text NOT NULL,
	"market_id" text NOT NULL,
	"side" text NOT NULL,
	"size" numeric(38, 18) NOT NULL,
	"limit_price" numeric(38, 18),
	"kind" text NOT NULL,
	"intent_kind" text NOT NULL,
	"exit_reason" text,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"venue_order_id" text,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions_snapshot" (
	"venue_account_id" uuid NOT NULL,
	"market_id" text NOT NULL,
	"side" text NOT NULL,
	"size" numeric(38, 18) NOT NULL,
	"entry_price" numeric(38, 18) NOT NULL,
	"unrealized_pnl" numeric(38, 18) NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"max_notional_per_position" numeric(38, 18) NOT NULL,
	"max_position_pct_equity" numeric(38, 18) NOT NULL,
	"max_total_exposure" numeric(38, 18) NOT NULL,
	"max_leverage" numeric(38, 18) NOT NULL,
	"max_slippage_bps" integer NOT NULL,
	"max_signal_age_ms" integer NOT NULL,
	"max_book_pct" numeric(38, 18) NOT NULL,
	"daily_loss_limit" numeric(38, 18) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "siwe_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"address" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"leader_id" uuid NOT NULL,
	"venue_account_id" uuid NOT NULL,
	"sizing_mode" text NOT NULL,
	"sizing_param" numeric(38, 18) NOT NULL,
	"market_filter" jsonb NOT NULL,
	"is_paper" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "venue_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"venue" text NOT NULL,
	"owner_address" text NOT NULL,
	"signer_address" text NOT NULL,
	"funder_address" text,
	"status" text DEFAULT 'active' NOT NULL,
	"delegation_method" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encrypted_keys" ADD CONSTRAINT "encrypted_keys_venue_account_id_venue_accounts_id_fk" FOREIGN KEY ("venue_account_id") REFERENCES "public"."venue_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_order_intent_id_order_intents_id_fk" FOREIGN KEY ("order_intent_id") REFERENCES "public"."order_intents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leader_fills" ADD CONSTRAINT "leader_fills_leader_id_leaders_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."leaders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leader_stats" ADD CONSTRAINT "leader_stats_leader_id_leaders_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."leaders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_intents" ADD CONSTRAINT "order_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_intents" ADD CONSTRAINT "order_intents_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions_snapshot" ADD CONSTRAINT "positions_snapshot_venue_account_id_venue_accounts_id_fk" FOREIGN KEY ("venue_account_id") REFERENCES "public"."venue_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_profiles" ADD CONSTRAINT "risk_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_profiles" ADD CONSTRAINT "risk_profiles_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_leader_id_leaders_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."leaders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_venue_account_id_venue_accounts_id_fk" FOREIGN KEY ("venue_account_id") REFERENCES "public"."venue_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_accounts" ADD CONSTRAINT "venue_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_user_ts_idx" ON "audit_log" USING btree ("user_id","ts");--> statement-breakpoint
CREATE INDEX "decisions_user_ts_idx" ON "decisions" USING btree ("user_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "encrypted_keys_account_idx" ON "encrypted_keys" USING btree ("venue_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fills_venue_fill_idx" ON "fills" USING btree ("venue_fill_id");--> statement-breakpoint
CREATE INDEX "fills_user_ts_idx" ON "fills" USING btree ("user_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "kill_switches_scope_idx" ON "kill_switches" USING btree ("scope","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leader_fills_venue_fill_idx" ON "leader_fills" USING btree ("venue_fill_id");--> statement-breakpoint
CREATE INDEX "leader_fills_leader_ts_idx" ON "leader_fills" USING btree ("leader_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "leader_stats_pk" ON "leader_stats" USING btree ("leader_id","window");--> statement-breakpoint
CREATE UNIQUE INDEX "leaders_venue_address_idx" ON "leaders" USING btree ("venue","address");--> statement-breakpoint
CREATE UNIQUE INDEX "order_intents_idempotency_idx" ON "order_intents" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "order_intents_user_status_idx" ON "order_intents" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_snapshot_pk" ON "positions_snapshot" USING btree ("venue_account_id","market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_profiles_scope_idx" ON "risk_profiles" USING btree ("user_id","subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_address_idx" ON "users" USING btree ("address");--> statement-breakpoint
CREATE INDEX "venue_accounts_user_idx" ON "venue_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_accounts_venue_owner_idx" ON "venue_accounts" USING btree ("venue","owner_address");