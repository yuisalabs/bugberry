ALTER TYPE "public"."activity_kind" ADD VALUE 'fix';--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'resolved';--> statement-breakpoint
CREATE TABLE "report_fix" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"url" text NOT NULL,
	"added_by" text,
	"via_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "comment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "via_agent" text;--> statement-breakpoint
ALTER TABLE "report_fix" ADD CONSTRAINT "report_fix_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_fix" ADD CONSTRAINT "report_fix_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_fix_report_url_idx" ON "report_fix" USING btree ("report_id","url");