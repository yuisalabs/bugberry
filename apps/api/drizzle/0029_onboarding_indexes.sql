CREATE INDEX "comment_author_idx" ON "comment" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "report_reporter_idx" ON "report" USING btree ("reporter_id","capture_type","upload_status");--> statement-breakpoint
CREATE INDEX "report_activity_actor_idx" ON "report_activity" USING btree ("actor_id","kind");--> statement-breakpoint
CREATE INDEX "workspace_invitation_invited_by_idx" ON "workspace_invitation" USING btree ("invited_by_id");