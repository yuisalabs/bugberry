import { afterEach, beforeAll, expect, test } from "bun:test"
import { inArray } from "drizzle-orm"
import { createDb, type Db, executor, withTransaction } from "../src/db/client"
import { demoRequest } from "../src/db/schema"
import { AppError, conflict } from "../src/lib/errors"
import { newId } from "../src/lib/ids"
import { getTestDb, TEST_DATABASE_URL } from "./helpers"

let db: Db
const made: string[] = []

beforeAll(async () => {
  db = await getTestDb()
})

afterEach(async () => {
  if (made.length > 0) await db.delete(demoRequest).where(inArray(demoRequest.id, made.splice(0)))
})

async function insertRow(): Promise<string> {
  const id = newId()
  made.push(id)
  await executor(db).insert(demoRequest).values({
    id,
    firstName: "Ana",
    lastName: "Putri",
    email: `${id}@kantor.test`,
    company: "Kantor",
    tracker: "jira",
    teamSize: "1-10",
  })
  return id
}

const countRows = async (ids: string[]) =>
  (await db.select({ id: demoRequest.id }).from(demoRequest).where(inArray(demoRequest.id, ids))).length

test("executor outside a transaction is the database itself", () => {
  expect(executor(db)).toBe(db)
})

test("withTransaction commits when fn resolves and returns its value", async () => {
  let id = ""
  const out = await withTransaction(db, async () => {
    id = await insertRow()
    return 42
  })
  expect(out).toBe(42)
  expect(await countRows([id])).toBe(1)
})

test("withTransaction rolls every write back when fn throws, and rethrows", async () => {
  let id = ""
  await expect(
    withTransaction(db, async () => {
      id = await insertRow()
      throw new Error("boom")
    }),
  ).rejects.toThrow("boom")
  expect(await countRows([id])).toBe(0)
})

test("a thrown AppError rolls back and reaches the caller unchanged", async () => {
  let id = ""
  const error = await withTransaction(db, async () => {
    id = await insertRow()
    throw conflict("x_taken", "X")
  }).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(AppError)
  expect((error as AppError).code).toBe("x_taken")
  expect(await countRows([id])).toBe(0)
})

test("a nested withTransaction joins the outer one: the inner write rolls back with it", async () => {
  const ids: string[] = []
  let inner: unknown
  let outer: unknown
  await expect(
    withTransaction(db, async () => {
      outer = executor(db)
      ids.push(await insertRow())
      await withTransaction(db, async () => {
        inner = executor(db)
        ids.push(await insertRow())
      })
      throw new Error("boom")
    }),
  ).rejects.toThrow("boom")
  expect(inner).toBe(outer)
  expect(inner).not.toBe(db)
  expect(await countRows(ids)).toBe(0)
})

test("the transaction of one database is never handed to another", async () => {
  const other = createDb(TEST_DATABASE_URL)
  try {
    await withTransaction(db, async () => {
      expect(executor(other)).toBe(other)
    })
  } finally {
    await other.$client.close()
  }
})

test("two parallel transactions never see each other's uncommitted writes", async () => {
  let idA = ""
  let seenByB = -1
  let inserted = () => {}
  const insertedByA = new Promise<void>((resolve) => {
    inserted = resolve
  })
  const a = withTransaction(db, async () => {
    idA = await insertRow()
    inserted()
    await Bun.sleep(30)
    throw new Error("rollback A")
  }).catch((e: Error) => e.message)
  await insertedByA
  // Had B inherited A's transaction through a leaking AsyncLocalStorage, it would count A's uncommitted row.
  const b = withTransaction(db, async () => {
    seenByB = (await executor(db).select({ id: demoRequest.id }).from(demoRequest).where(inArray(demoRequest.id, [idA])))
      .length
  })
  expect(await a).toBe("rollback A")
  await b
  expect(seenByB).toBe(0)
  expect(await countRows([idA])).toBe(0)
})
