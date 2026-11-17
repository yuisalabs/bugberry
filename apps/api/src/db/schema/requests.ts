import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { user } from "./auth"
import { createdAt } from "./columns"
import { project } from "./projects"
import { workspace } from "./workspaces"

/** A link a member sends to someone without an account, who records their screen with it. Only the token's hash is kept. */
export const recordingRequest = pgTable(
  "recording_request",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    createdById: text("created_by_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    note: text("note").notNull().default(""),
    pageUrl: text("page_url"),
    maxUses: integer("max_uses").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("recording_request_workspace_created_idx").on(table.workspaceId, table.createdAt)],
)
