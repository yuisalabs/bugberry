import { boolean, pgTable, text } from "drizzle-orm/pg-core"
import { createdAt } from "./columns"

/** Someone asked for a demo on the public site (PUBLIC_SITE); the team is emailed and replies. */
export const demoRequest = pgTable("demo_request", {
  id: text("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  company: text("company").notNull(),
  tracker: text("tracker").notNull(),
  teamSize: text("team_size").notNull(),
  message: text("message").default("").notNull(),
  selfHosting: boolean("self_hosting").default(false).notNull(),
  createdAt: createdAt(),
})
