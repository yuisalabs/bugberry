import { timestamp } from "drizzle-orm/pg-core"

export const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull()

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull()

export const ts = (name: string) => timestamp(name, { withTimezone: true })
