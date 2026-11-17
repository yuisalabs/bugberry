ALTER TABLE "user" ADD COLUMN "last_member_workspace_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_last_member_workspace_id_workspace_id_fk" FOREIGN KEY ("last_member_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "user" SET "last_member_workspace_id" = "last_workspace_id" WHERE "last_workspace_id" IS NOT NULL AND EXISTS (SELECT 1 FROM "workspace_member" WHERE "workspace_member"."user_id" = "user"."id" AND "workspace_member"."workspace_id" = "user"."last_workspace_id");
