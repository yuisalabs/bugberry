import { bigint, index, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core"

/**
 * Calls counted per key and fixed window, for limits that must hold across several server processes (MCP in its
 * own containers). Rows of past windows are dropped by the hourly cleanup.
 */
export const rateLimitHit = pgTable(
  "rate_limit_hit",
  {
    /** Which limit: "mcp_calls", "mcp_screenshots". */
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
    /** Start of the window, in milliseconds since the epoch. */
    windowStart: bigint("window_start", { mode: "number" }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.bucket, table.key, table.windowStart] }), index("rate_limit_hit_window_idx").on(table.windowStart)],
)
