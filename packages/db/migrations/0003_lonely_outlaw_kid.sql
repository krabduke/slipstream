CREATE TABLE "paper_books" (
	"subscription_id" uuid PRIMARY KEY NOT NULL,
	"starting_equity" numeric(38, 18) NOT NULL,
	"realized_pnl" numeric(38, 18) DEFAULT '0' NOT NULL,
	"fees_paid" numeric(38, 18) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_positions" (
	"subscription_id" uuid NOT NULL,
	"market_id" text NOT NULL,
	"label" text,
	"side" text NOT NULL,
	"size" numeric(38, 18) NOT NULL,
	"entry_price" numeric(38, 18) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_books" ADD CONSTRAINT "paper_books_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paper_positions_pk" ON "paper_positions" USING btree ("subscription_id","market_id");--> statement-breakpoint
ALTER TABLE "paper_books" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "paper_positions" ENABLE ROW LEVEL SECURITY;
