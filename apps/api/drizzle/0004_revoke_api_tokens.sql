-- Existing API tokens are retired: the dashboard no longer issues or lists them, so none could be revoked.
UPDATE "api_token" SET "revoked_at" = now() WHERE "revoked_at" IS NULL;
