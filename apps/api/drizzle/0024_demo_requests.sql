CREATE TABLE "demo_request" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"company" text NOT NULL,
	"tracker" text NOT NULL,
	"team_size" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"self_hosting" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
