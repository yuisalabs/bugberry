CREATE TABLE "connection" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" "tracker_provider" NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_external_link" DROP CONSTRAINT "report_external_link_integration_id_integration_id_fk";
--> statement-breakpoint
ALTER TABLE "report_external_link" ALTER COLUMN "integration_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "connection_id" text;--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "target_key" text;--> statement-breakpoint
ALTER TABLE "report_external_link" ADD COLUMN "provider" "tracker_provider";--> statement-breakpoint
-- Each integration becomes a connection of its own (same id), named after what it points at; the sealed secret is copied as it is.
INSERT INTO "connection" ("id", "workspace_id", "provider", "name", "settings", "secret_encrypted", "created_at", "updated_at")
SELECT i."id", p."workspace_id", i."provider",
	-- Compared as text: 0021 adds these enum values, and Postgres refuses new enum values used in the transaction that added them.
	CASE i."provider"::text
		WHEN 'github' THEN 'GitHub · ' || (i."config"->>'owner') || '/' || (i."config"->>'repo')
		WHEN 'gitlab' THEN 'GitLab · ' || (i."config"->>'projectPath')
		WHEN 'linear' THEN 'Linear · Team ' || (i."config"->>'teamKey')
		WHEN 'jira' THEN 'Jira · ' || (i."config"->>'projectKey')
		WHEN 'activecollab' THEN 'ActiveCollab · Project #' || (i."config"->>'projectId')
		WHEN 'telegram' THEN 'Telegram · Chat ' || (i."config"->>'chatId')
		WHEN 'webhook' THEN 'Webhook · ' || coalesce(substring(i."config"->>'url' from '^[A-Za-z]+://([^/?#]+)'), 'address')
		WHEN 'slack' THEN 'Slack channel'
		WHEN 'discord' THEN 'Discord channel'
	END,
	jsonb_strip_nulls(jsonb_build_object(
		'baseUrl', i."config"->'baseUrl', 'siteUrl', i."config"->'siteUrl', 'email', i."config"->'email', 'url', i."config"->'url'
	)),
	i."secret_encrypted", i."created_at", i."updated_at"
FROM "integration" i JOIN "project" p ON p."id" = i."project_id";--> statement-breakpoint
-- Each integration becomes that connection's use in its project, keyed the way targetKey() keys a new use (one per target).
UPDATE "integration" SET "connection_id" = "id",
	"target_key" = coalesce(CASE "provider"::text
		WHEN 'github' THEN lower(("config"->>'owner') || '/' || ("config"->>'repo'))
		WHEN 'gitlab' THEN lower("config"->>'projectPath')
		WHEN 'linear' THEN upper("config"->>'teamKey')
		WHEN 'jira' THEN lower(("config"->>'projectKey') || '/' || ("config"->>'issueType'))
		WHEN 'activecollab' THEN ("config"->>'projectId') || '/' || ("config"->>'taskListId')
		WHEN 'telegram' THEN "config"->>'chatId'
	END, ''),
	"config" = "config" - 'baseUrl' - 'siteUrl' - 'email' - 'url';--> statement-breakpoint
UPDATE "report_external_link" l SET "provider" = i."provider" FROM "integration" i WHERE l."integration_id" = i."id";--> statement-breakpoint
ALTER TABLE "integration" ALTER COLUMN "connection_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "integration" ALTER COLUMN "target_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connection_workspace_idx" ON "connection" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_connection_id_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_external_link" ADD CONSTRAINT "report_external_link_integration_id_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_project_connection_target_idx" ON "integration" USING btree ("project_id","connection_id","target_key");--> statement-breakpoint
ALTER TABLE "integration" DROP COLUMN "secret_encrypted";
