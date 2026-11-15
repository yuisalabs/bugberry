import { expect, test } from "bun:test"
import { decodeListCursor, encodeListCursor, type ListSort } from "../src/modules/reports/cursor"

const at = "2026-03-01T10:00:00.123456Z"
const refused = expect.objectContaining({ status: 400, code: "bad_cursor" })

test("a cursor survives encoding", () => {
  const cursor = { sort: "priority", createdAt: at, id: "r1", priority: "high" } as const
  expect(decodeListCursor(encodeListCursor(cursor), "priority")).toEqual(cursor)
})

test("a cursor for another sort is refused", () => {
  expect(() => decodeListCursor(encodeListCursor({ sort: "newest", createdAt: at, id: "r1" }), "oldest")).toThrow(refused)
})

const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

test.each<[ListSort, string]>([
  ["newest", ""],
  ["newest", "not base64 at all!"],
  ["newest", Buffer.from("page:2").toString("base64url")],
  ["newest", enc([])],
  ["newest", enc(null)],
  ["newest", enc({ sort: "newest", createdAt: at })],
  ["newest", enc({ sort: "newest", createdAt: at, id: 7 })],
  ["newest", enc({ sort: "newest", createdAt: at, id: "" })],
  ["newest", enc({ sort: "newest", createdAt: "now()", id: "r1" })],
  // A time without its microseconds, and a day February does not have.
  ["newest", enc({ sort: "newest", createdAt: "2026-03-01T10:00:00Z", id: "r1" })],
  ["newest", enc({ sort: "newest", createdAt: "2026-02-31T10:00:00.000000Z", id: "r1" })],
  // Postgres has no year 0 and takes no NUL in text; either would fail in the query instead of here.
  ["newest", enc({ sort: "newest", createdAt: "0000-01-01T00:00:00.000000Z", id: "r1" })],
  ["newest", enc({ sort: "newest", createdAt: at, id: "r\u00001" })],
  ["newest", enc({ sort: "newest", createdAt: at, id: "x".repeat(101) })],
  ["newest", enc({ sort: "newest", createdAt: at, id: "r1", priority: "high" })],
  ["priority", enc({ sort: "priority", createdAt: at, id: "r1" })],
  ["priority", enc({ sort: "priority", createdAt: at, id: "r1", priority: "urgent'; drop table report; --" })],
])("an unreadable cursor for %s is refused: %s", (sort, value) => {
  expect(() => decodeListCursor(value, sort)).toThrow(refused)
})
