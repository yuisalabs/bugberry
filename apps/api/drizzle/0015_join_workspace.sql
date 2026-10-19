CREATE TABLE "join_request" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "join_request_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "share_code" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "join_domain" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "join_mode" text;--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD COLUMN "code_hash" text;--> statement-breakpoint
ALTER TABLE "join_request" ADD CONSTRAINT "join_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "join_request" ADD CONSTRAINT "join_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_share_code_unique" UNIQUE("share_code");--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_code_hash_unique" UNIQUE("code_hash");