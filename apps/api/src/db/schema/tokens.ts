import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { createdAt } from "./columns"
import { apiTokenKindEnum } from "./enums"
import { user } from "./auth"

export const apiToken = pgTable(
  "api_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label").notNull(),
    kind: apiTokenKindEnum("kind").notNull().default("full"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("api_token_user_id_idx").on(table.userId)],
)
