CREATE TABLE "agent_upload" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"report_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_upload_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "via_agent" text;--> statement-breakpoint
ALTER TABLE "agent_upload" ADD CONSTRAINT "agent_upload_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_upload" ADD CONSTRAINT "agent_upload_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_upload_report_idx" ON "agent_upload" USING btree ("report_id");