import { join } from "node:path"
import { migrate } from "drizzle-orm/bun-sql/migrator"
import { ensureWorkspaceSlugs } from "../workspaces/slug"
import type { Db } from "./client"

export const MIGRATIONS_FOLDER = join(import.meta.dir, "..", "..", "drizzle")

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  // Workspaces from before slugs existed get one; SQL alone can't apply the slug rules.
  await ensureWorkspaceSlugs(db)
}
