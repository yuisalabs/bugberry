ALTER TABLE "workspace" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Workspaces from before owners existed: the admin who joined first becomes the owner.
UPDATE "workspace" w SET "owner_id" = first_admin."user_id"
FROM (
  SELECT DISTINCT ON (m."workspace_id") m."workspace_id", m."user_id"
  FROM "workspace_member" m
  WHERE m."role" = 'admin'
  ORDER BY m."workspace_id", m."created_at", m."user_id"
) first_admin
WHERE w."id" = first_admin."workspace_id" AND w."owner_id" IS NULL;
