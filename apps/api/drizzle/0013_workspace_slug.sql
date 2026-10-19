ALTER TABLE "workspace" ADD COLUMN "slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_slug_idx" ON "workspace" USING btree ("slug");