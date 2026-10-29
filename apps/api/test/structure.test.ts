import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

const SRC = fileURLToPath(new URL("../src", import.meta.url))

// One import or re-export statement at a time: `[^"]*?` can't run past the previous statement's specifier.
const STATEMENT = /^(?:import|export)\s+(type\s+)?([^"]*?)\bfrom\s+"([^"]+)"/gm
const DYNAMIC_DRIZZLE = /\bimport\s*\(\s*["']drizzle-orm/
const TRANSACTION = /\.transaction\s*\(/
const QUERY_WITHOUT_EXECUTOR =
  /\b(db|tx)\s*\.\s*(?:(?:select|selectDistinct|selectDistinctOn|insert|update|delete|execute|transaction|batch|\$count|\$with|with)\s*\(|query\s*\.)/
const EXECUTOR_CALL = /\bexecutor\s*\(/

/** A statement that brings a value (not only types) from drizzle-orm into the file. */
function importsDrizzleValue(text: string): boolean {
  if (DYNAMIC_DRIZZLE.test(text)) return true
  for (const [, typeOnly, names = "", from = ""] of text.matchAll(STATEMENT)) {
    if (!/^drizzle-orm(\/|$)/.test(from) || typeOnly) continue
    const braced = /\{([^}]*)\}/.exec(names)
    const values = braced ? braced[1]?.split(",").filter((name) => name.trim() && !name.trim().startsWith("type ")) : [names]
    if (values?.length) return true
  }
  return false
}

const isRepository = (path: string) => /^modules\/[^/]+\/repository\.ts$/.test(path)
const mayImportDrizzle = (path: string) =>
  path.startsWith("db/") || path.startsWith("admin/") || isRepository(path) || path === "modules/auth/better-auth.ts"
const mayOpenTransaction = (path: string) =>
  path === "db/client.ts" || path.startsWith("admin/") || path === "modules/auth/better-auth.ts"

/** Whether a source file at `file` (relative to src/) breaks the rule on where Drizzle may be used. */
function breaksRules(file: string, text: string): boolean {
  return (
    (!mayImportDrizzle(file) && importsDrizzleValue(text)) ||
    (!mayOpenTransaction(file) && TRANSACTION.test(text)) ||
    (isRepository(file) && QUERY_WITHOUT_EXECUTOR.test(text)) ||
    // A query needs no Drizzle import when it uses no operators, so the calls themselves are checked too.
    (!mayImportDrizzle(file) && (QUERY_WITHOUT_EXECUTOR.test(text) || EXECUTOR_CALL.test(text)))
  )
}

async function violators(): Promise<string[]> {
  const found: string[] = []
  for (const path of new Bun.Glob("**/*.ts").scanSync(SRC)) {
    const file = path.replaceAll("\\", "/")
    if (breaksRules(file, await Bun.file(`${SRC}/${file}`).text())) found.push(file)
  }
  return found.sort()
}

const ROUTE = "modules/x/index.ts"
const REPOSITORY = "modules/x/repository.ts"

describe("structure", () => {
  test("Drizzle is used only where the structure allows it", async () => {
    expect(await violators()).toEqual([])
  })

  test("a route may import Drizzle types but not values", () => {
    expect(breaksRules(ROUTE, 'import { Elysia } from "elysia"\nimport type { SQL } from "drizzle-orm"\n')).toBe(false)
    expect(breaksRules(ROUTE, 'import { type SQL, eq } from "drizzle-orm"\n')).toBe(true)
    expect(breaksRules(ROUTE, 'import {\n  eq,\n} from "drizzle-orm/pg-core"\n')).toBe(true)
    expect(breaksRules(ROUTE, 'export { sql } from "drizzle-orm"\n')).toBe(true)
    expect(breaksRules(ROUTE, 'const { eq } = await import("drizzle-orm")\n')).toBe(true)
  })

  test("a route runs no query, whichever query API it uses", () => {
    for (const call of [
      "db.select().from(user)",
      "deps.db.insert(user).values(row)",
      "db.selectDistinctOn([user.id]).from(user)",
      "db.query.user.findFirst({ where: (u, { eq }) => eq(u.id, id) })",
      "db.$count(user)",
      "db.$with('a').as(q)",
      "db.with(a).select().from(a)",
      "executor(db).select().from(user)",
      "db.transaction(async () => {})",
    ]) {
      expect(breaksRules(ROUTE, `const rows = await ${call}\n`)).toBe(true)
    }
  })

  test("a repository runs every query through executor", () => {
    expect(breaksRules(REPOSITORY, "return executor(db).select().from(user)\n")).toBe(false)
    expect(breaksRules(REPOSITORY, "return executor(db).query.user.findFirst()\n")).toBe(false)
    expect(breaksRules(REPOSITORY, "return db.query.user.findMany()\n")).toBe(true)
    expect(breaksRules(REPOSITORY, "return db.$count(user)\n")).toBe(true)
    expect(breaksRules(REPOSITORY, "return tx.update(user).set(row)\n")).toBe(true)
  })
})
