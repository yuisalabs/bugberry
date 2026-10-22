CREATE TABLE "pending_project_logo" (
	"project_id" text PRIMARY KEY NOT NULL,
	"logo_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "pending_project_logo" ADD CONSTRAINT "pending_project_logo_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;