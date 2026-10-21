ALTER TYPE "public"."tracker_provider" ADD VALUE 'gitlab';--> statement-breakpoint
ALTER TYPE "public"."tracker_provider" ADD VALUE 'linear';--> statement-breakpoint
ALTER TYPE "public"."tracker_provider" ADD VALUE 'jira';--> statement-breakpoint
ALTER TYPE "public"."tracker_provider" ADD VALUE 'slack';--> statement-breakpoint
ALTER TYPE "public"."tracker_provider" ADD VALUE 'discord';--> statement-breakpoint
ALTER TYPE "public"."tracker_provider" ADD VALUE 'telegram';--> statement-breakpoint
ALTER TYPE "public"."tracker_provider" ADD VALUE 'webhook';--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN "last_delivered_at" timestamp with time zone;