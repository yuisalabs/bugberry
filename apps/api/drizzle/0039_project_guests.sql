CREATE TABLE "project_guest" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"invited_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_guest_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD COLUMN "guest_project_id" text;--> statement-breakpoint
ALTER TABLE "project_guest" ADD CONSTRAINT "project_guest_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_guest" ADD CONSTRAINT "project_guest_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_guest" ADD CONSTRAINT "project_guest_invited_by_id_user_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_guest_user_idx" ON "project_guest" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_guest_project_id_project_id_fk" FOREIGN KEY ("guest_project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;