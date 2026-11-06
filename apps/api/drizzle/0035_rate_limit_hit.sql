CREATE TABLE "rate_limit_hit" (
	"bucket" text NOT NULL,
	"key" text NOT NULL,
	"window_start" bigint NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limit_hit_bucket_key_window_start_pk" PRIMARY KEY("bucket","key","window_start")
);
--> statement-breakpoint
CREATE INDEX "rate_limit_hit_window_idx" ON "rate_limit_hit" USING btree ("window_start");