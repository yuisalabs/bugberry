import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { createdAt } from "./columns"
import { user } from "./auth"
import { report } from "./reports"

/** Where a report was fixed: a PR, merge request or commit link. Its label is derived when shown, never stored. */
export const reportFix = pgTable(
  "report_fix",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => report.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    addedBy: text("added_by").references(() => user.id, { onDelete: "set null" }),
    /** The AI app that added it through MCP, as on comments. */
    viaAgent: text("via_agent"),
    createdAt: createdAt(),
  },
  // Also serves lookups by report: report_id leads it.
  (table) => [uniqueIndex("report_fix_report_url_idx").on(table.reportId, table.url)],
)

export type ReportFixRow = typeof reportFix.$inferSelect
