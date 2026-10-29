import { AsyncLocalStorage } from "node:async_hooks"
import { SQL } from "bun"
import { drizzle } from "drizzle-orm/bun-sql"
import * as schema from "./schema"

export function createDb(url: string) {
  return drizzle({ client: new SQL(url), schema })
}

export type Db = ReturnType<typeof createDb>
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
export type Executor = Db | Tx

const activeTx = new AsyncLocalStorage<{ db: Db; tx: Tx }>()

/**
 * Where a repository sends its query: the transaction withTransaction opened on this `db` in the current
 * async call chain, else `db` itself. Querying `db` directly inside one escapes it and can wait on its locks.
 */
export function executor(db: Db): Executor {
  const active = activeTx.getStore()
  return active && active.db === db ? active.tx : db
}

/** Runs `fn` in one transaction; a throw rolls it back and is rethrown. A nested call joins the outer one. */
export function withTransaction<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  const active = activeTx.getStore()
  if (active && active.db === db) return fn()
  return db.transaction((tx) => activeTx.run({ db, tx }, fn))
}
