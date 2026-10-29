import { index, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { createdAt } from "./columns"
import { notificationKindEnum } from "./enums"
import { user } from "./auth"
import { report } from "./reports"
import { comment } from "./comments"

/** "Someone mentioned you": one row per person and comment, so edits never notify anyone twice. */
export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    commentId: text("comment_id")
      .notNull()
      .references(() => comment.id, { onDelete: "cascade" }),
    reportId: text("report_id")
      .notNull()
      .references(() => report.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    kind: notificationKindEnum("kind").notNull().default("mention"),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notification_user_comment_idx").on(table.userId, table.commentId),
    index("notification_user_created_idx").on(table.userId, table.createdAt),
  ],
)
