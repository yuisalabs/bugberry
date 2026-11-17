ALTER TYPE "public"."notification_kind" ADD VALUE 'recording_received';--> statement-breakpoint
CREATE TABLE "recording_request" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"created_by_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"page_url" text,
	"max_uses" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recording_request_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "recording_request_id" text;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "sender_name" text;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "sender_email" text;--> statement-breakpoint
ALTER TABLE "recording_request" ADD CONSTRAINT "recording_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_request" ADD CONSTRAINT "recording_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_request" ADD CONSTRAINT "recording_request_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recording_request_workspace_created_idx" ON "recording_request" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_recording_request_id_recording_request_id_fk" FOREIGN KEY ("recording_request_id") REFERENCES "public"."recording_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_recording_request_idx" ON "report" USING btree ("recording_request_id");