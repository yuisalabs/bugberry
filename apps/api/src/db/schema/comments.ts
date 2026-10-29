import { type AnyPgColumn, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core"
import { createdAt, updatedAt } from "./columns"
import { user } from "./auth"
import { report } from "./reports"

export const comment = pgTable(
  "comment",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => report.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    /** The AI app that wrote it through MCP ("Claude Code", "AI agent"); null when written in BugBerry. */
    viaAgent: text("via_agent"),
    /** The comment this one replies to; always a thread's first comment, so threads are one level deep. */
    parentId: text("parent_id").references((): AnyPgColumn => comment.id, { onDelete: "cascade" }),
    /** Set when a comment with replies is deleted: its body is wiped and it stays as "This comment was deleted". */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("comment_report_created_idx").on(table.reportId, table.createdAt),
    index("comment_parent_idx").on(table.parentId),
    index("comment_author_idx").on(table.authorId),
  ],
)

/** One person's emoji on one comment; the same person can add several different emoji. */
export const commentReaction = pgTable(
  "comment_reaction",
  {
    commentId: text("comment_id")
      .notNull()
      .references(() => comment.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.commentId, table.userId, table.emoji] })],
)
