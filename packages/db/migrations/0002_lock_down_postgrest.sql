-- Supabase exposes the public schema through PostgREST, and its anon key is
-- public by design. Slipstream never uses PostgREST; it connects to Postgres
-- directly as the table owner, which RLS does not restrict. Enabling RLS with
-- no policies therefore closes the REST path completely without touching the
-- app. Any table added later must be added here too (the invariant test checks).
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "encrypted_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "engine_leases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intel_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kill_switches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leader_fills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leader_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leaders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_intents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "positions_snapshot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "risk_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "siwe_nonces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trader_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "venue_accounts" ENABLE ROW LEVEL SECURITY;
