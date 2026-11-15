import { PRIORITIES, type Priority } from "@bugberry/shared"
import { badRequest } from "../../lib/errors"

export type ListSort = "newest" | "oldest" | "priority"

/**
 * Where a page of the report list ended: its last report's place in the order asked for. `createdAt` is Postgres'
 * own text with microseconds; a Date keeps only milliseconds, and a page edge could then skip or repeat a report.
 */
export interface ListCursor {
  sort: ListSort
  createdAt: string
  id: string
  /** Set for the priority sort, and only for it. */
  priority?: Priority
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const badCursor = () => badRequest("bad_cursor", "Invalid cursor")

export const encodeListCursor = (cursor: ListCursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url")

/** A time Postgres will take: a real calendar moment, and not in the year 0 it does not have. */
function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP.test(value) || value.startsWith("0000")) return false
  const toMillis = `${value.slice(0, 23)}Z`
  const date = new Date(toMillis)
  return !Number.isNaN(date.getTime()) && date.toISOString() === toMillis
}

/**
 * Reads a cursor a client sent back, for a list in `sort` order. A cursor grants nothing: the workspace and filters
 * come from the request. Its values are checked so a bad one is a 400 here and not a failed query.
 */
export function decodeListCursor(value: string, sort: ListSort): ListCursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
  } catch {
    throw badCursor()
  }
  if (typeof parsed !== "object" || parsed === null) throw badCursor()
  const { sort: madeFor, createdAt, id, priority } = parsed as Record<string, unknown>
  if (madeFor !== sort || !isTimestamp(createdAt)) throw badCursor()
  if (typeof id !== "string" || id.length < 1 || id.length > 100 || id.includes("\u0000")) throw badCursor()
  if (sort !== "priority") {
    if (priority !== undefined) throw badCursor()
    return { sort, createdAt, id }
  }
  if (!PRIORITIES.includes(priority as Priority)) throw badCursor()
  return { sort, createdAt, id, priority: priority as Priority }
}
