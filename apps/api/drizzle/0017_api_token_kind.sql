CREATE TYPE "public"."api_token_kind" AS ENUM('full', 'mcp');--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN "kind" "api_token_kind" DEFAULT 'full' NOT NULL;