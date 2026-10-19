CREATE TABLE "pending_logo" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"logo_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "pending_logo" ADD CONSTRAINT "pending_logo_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;