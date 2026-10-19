ALTER TABLE "report" ADD COLUMN "number" integer;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "next_report_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE "report" SET "number" = numbered.n
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "workspace_id" ORDER BY "created_at", "id") AS n FROM "report"
) AS numbered
WHERE "report"."id" = numbered."id";--> statement-breakpoint
UPDATE "workspace" SET "next_report_number" = counts.max_number + 1
FROM (SELECT "workspace_id", max("number") AS max_number FROM "report" GROUP BY "workspace_id") AS counts
WHERE "workspace"."id" = counts."workspace_id";--> statement-breakpoint
ALTER TABLE "report" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "report_workspace_number_idx" ON "report" USING btree ("workspace_id","number");
