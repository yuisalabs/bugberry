ALTER TYPE "public"."capture_type" ADD VALUE 'replay';--> statement-breakpoint
ALTER TABLE "report" ADD COLUMN "replay_frames" jsonb;