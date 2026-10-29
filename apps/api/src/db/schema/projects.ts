import { sql } from "drizzle-orm"
import { type AnyPgColumn, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core"
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
