CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DROP INDEX "report_workspace_created_idx";--> statement-breakpoint
DROP INDEX "report_status_idx";--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "has_errors" boolean GENERATED ALWAYS AS (coalesce(((case when jsonb_typeof(debugger_summary) = 'string' then (debugger_summary #>> '{}')::jsonb else debugger_summary end) ->> 'errors')::int, 0) > 0 or coalesce(((case when jsonb_typeof(debugger_summary) = 'string' then (debugger_summary #>> '{}')::jsonb else debugger_summary end) ->> 'failedRequests')::int, 0) > 0) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "comment_body_trgm_idx" ON "comment" USING gin ("body" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "report_workspace_created_id_idx" ON "report" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "report_workspace_status_created_idx" ON "report" USING btree ("workspace_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "report_workspace_assignee_created_idx" ON "report" USING btree ("workspace_id","assignee_id","created_at","id");--> statement-breakpoint
CREATE INDEX "report_workspace_priority_created_idx" ON "report" USING btree ("workspace_id","priority","created_at","id");--> statement-breakpoint
CREATE INDEX "report_title_trgm_idx" ON "report" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "report_page_url_trgm_idx" ON "report" USING gin ("page_url" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "report_description_trgm_idx" ON "report" USING gin ("description" gin_trgm_ops);