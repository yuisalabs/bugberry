CREATE TYPE "public"."activity_kind" AS ENUM('status', 'priority', 'assignee', 'title', 'tracker', 'agent_read');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('mention', 'reply_to_you', 'reply_in_thread');--> statement-breakpoint
CREATE TABLE "comment_reaction" (
	"comment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reaction_comment_id_user_id_emoji_pk" PRIMARY KEY("comment_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "report_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"actor_id" text,
	"via_agent" text,
	"kind" "activity_kind" NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "kind" "notification_kind" DEFAULT 'mention' NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_activity" ADD CONSTRAINT "report_activity_report_id_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_activity" ADD CONSTRAINT "report_activity_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_activity_report_created_idx" ON "report_activity" USING btree ("report_id","created_at");--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_parent_id_comment_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_parent_idx" ON "comment" USING btree ("parent_id");--> statement-breakpoint
INSERT INTO "report_activity" ("id", "report_id", "actor_id", "via_agent", "kind", "detail", "created_at", "updated_at")
SELECT gen_random_uuid()::text, l."report_id", NULL, NULL, 'tracker',
  jsonb_build_object('provider', i."provider", 'externalId', l."external_id", 'externalUrl', l."external_url"),
  l."created_at", l."created_at"
FROM "report_external_link" l
JOIN "integration" i ON i."id" = l."integration_id"
WHERE l."external_id" IS NOT NULL;
