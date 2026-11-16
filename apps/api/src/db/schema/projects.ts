import { sql } from "drizzle-orm"
import { type AnyPgColumn, index, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core"
import { user } from "./auth"
import { createdAt } from "./columns"
import { workspace } from "./workspaces"
import { reportTemplate } from "./ai"

export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Unique within its workspace. */
    slug: text("slug").notNull(),
    urlPatterns: text("url_patterns")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The uploaded logo's public link; null shows the name's first letter instead. */
    logoUrl: text("logo_url"),
    /** Its default template for Write with AI; null uses the workspace's. */
    aiTemplateId: text("ai_template_id").references((): AnyPgColumn => reportTemplate.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("project_workspace_slug_idx").on(table.workspaceId, table.slug)],
)

/** Someone outside the workspace who may read one project's reports and comment on them. Never a workspace member. */
export const projectGuest = pgTable(
  "project_guest",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    invitedById: text("invited_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.userId] }), index("project_guest_user_idx").on(table.userId)],
)
