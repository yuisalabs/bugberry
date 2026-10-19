CREATE TYPE "public"."workspace_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "workspace_member" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "project" DROP CONSTRAINT "project_slug_unique";--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "reporter_domain" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_workspace_id" text;--> statement-breakpoint
-- Today's single-company data becomes one workspace, named after the most common email domain.
INSERT INTO "workspace" ("id", "name")
SELECT gen_random_uuid()::text, COALESCE(
  (SELECT split_part("email", '@', 2) FROM "user" GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1),
  'Workspace')
WHERE EXISTS (SELECT 1 FROM "user") OR EXISTS (SELECT 1 FROM "project") OR EXISTS (SELECT 1 FROM "report");--> statement-breakpoint
INSERT INTO "workspace_member" ("workspace_id", "user_id", "role")
SELECT (SELECT "id" FROM "workspace" LIMIT 1), "id", CASE WHEN "role" = 'admin' THEN 'admin'::"workspace_role" ELSE 'member'::"workspace_role" END
FROM "user" WHERE EXISTS (SELECT 1 FROM "workspace");--> statement-breakpoint
UPDATE "user" SET "last_workspace_id" = (SELECT "id" FROM "workspace" LIMIT 1);--> statement-breakpoint
UPDATE "project" SET "workspace_id" = (SELECT "id" FROM "workspace" LIMIT 1);--> statement-breakpoint
UPDATE "report" SET "workspace_id" = (SELECT "id" FROM "workspace" LIMIT 1);--> statement-breakpoint
UPDATE "report" SET "reporter_domain" = lower(split_part(u."email", '@', 2)) FROM "user" u WHERE u."id" = "report"."reporter_id";--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "report" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
-- "internal" used to mean everyone at the company, which is now the workspace.
ALTER TYPE "public"."visibility" RENAME TO "visibility_old";--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('workspace', 'internal', 'public');--> statement-breakpoint
ALTER TABLE "report" ALTER COLUMN "visibility" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "report" ALTER COLUMN "visibility" TYPE "public"."visibility"
  USING (CASE WHEN "visibility"::text = 'public' THEN 'public' ELSE 'workspace' END)::"public"."visibility";--> statement-breakpoint
ALTER TABLE "report" ALTER COLUMN "visibility" SET DEFAULT 'workspace';--> statement-breakpoint
DROP TYPE "public"."visibility_old";--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_invited_by_id_user_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_invitation_workspace_idx" ON "workspace_invitation" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_invitation_email_idx" ON "workspace_invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "workspace_member_user_idx" ON "workspace_member" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_last_workspace_id_workspace_id_fk" FOREIGN KEY ("last_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_workspace_slug_idx" ON "project" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "report_workspace_created_idx" ON "report" USING btree ("workspace_id","created_at");