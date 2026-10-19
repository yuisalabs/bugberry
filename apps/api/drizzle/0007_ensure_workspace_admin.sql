-- A workspace migrated without any admin (no user had the old admin role) gets its oldest member as admin,
-- so someone can still invite people and manage it.
UPDATE "workspace_member" SET "role" = 'admin'
WHERE ("workspace_id", "user_id") IN (
  SELECT DISTINCT ON (m."workspace_id") m."workspace_id", m."user_id"
  FROM "workspace_member" m
  WHERE NOT EXISTS (
    SELECT 1 FROM "workspace_member" a WHERE a."workspace_id" = m."workspace_id" AND a."role" = 'admin'
  )
  ORDER BY m."workspace_id", m."created_at", m."user_id"
);
