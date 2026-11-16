import type { LabelColor } from "@bugberry/shared"
import { sql } from "drizzle-orm"
import { index, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core"
import { user } from "./auth"
import { createdAt, updatedAt } from "./columns"
import { report } from "./reports"
import { workspace } from "./workspaces"

/** A workspace's own triage tag; any of its reports can carry it. */
export const label = pgTable(
  "label",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").$type<LabelColor>().notNull().default("gray"),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // "Bug" and "bug" are the same label.
  (table) => [uniqueIndex("label_workspace_name_idx").on(table.workspaceId, sql`lower(${table.name})`)],
)

export const reportLabel = pgTable(
  "report_label",
  {
    reportId: text("report_id")
      .notNull()
      .references(() => report.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => label.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  // The list's filter goes from a label to its reports.
  (table) => [primaryKey({ columns: [table.reportId, table.labelId] }), index("report_label_label_idx").on(table.labelId, table.reportId)],
)
