CREATE TABLE "report_template" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"skeleton" text DEFAULT '' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_ai_provider" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"preset" text NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"key_encrypted" text NOT NULL,
	"key_hint" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "ai_template_id" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ai_send_response_bodies" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ai_default_template_id" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ai_templates_seeded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_template" ADD CONSTRAINT "report_template_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_template" ADD CONSTRAINT "report_template_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_ai_provider" ADD CONSTRAINT "workspace_ai_provider_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_ai_provider" ADD CONSTRAINT "workspace_ai_provider_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_template_workspace_idx" ON "report_template" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_ai_template_id_report_template_id_fk" FOREIGN KEY ("ai_template_id") REFERENCES "public"."report_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_ai_default_template_id_report_template_id_fk" FOREIGN KEY ("ai_default_template_id") REFERENCES "public"."report_template"("id") ON DELETE set null ON UPDATE no action;