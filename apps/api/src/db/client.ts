import { SQL } from "bun"
import { drizzle } from "drizzle-orm/bun-sql"
import * as schema from "./schema"

export function createDb(url: string) {
  return drizzle({ client: new SQL(url), schema })
}

export type Db = ReturnType<typeof createDb>
