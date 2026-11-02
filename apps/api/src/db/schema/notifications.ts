import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { createdAt } from "./columns"
import { notificationKindEnum } from "./enums"
import { user } from "./auth"
import { report } from "./reports"
import { comment } from "./comments"

/**
 * A bell notification. Comment kinds have one row per person and comment, so edits never notify anyone twice;
 * a "resolved" row has no comment.
 */
export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => comment.id, { onDelete: "cascade" }),
    reportId: text("report_id")
      .notNull()
      .references(() => report.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    kind: notificationKindEnum("kind").notNull().default("mention"),
    /** The AI app that resolved the report; comment kinds take it from their comment. */
    viaAgent: text("via_agent"),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notification_user_comment_idx").on(table.userId, table.commentId),
    index("notification_user_created_idx").on(table.userId, table.createdAt),
  ],
)
