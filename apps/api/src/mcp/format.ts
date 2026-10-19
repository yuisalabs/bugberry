import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { McpToolError } from "./context"

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200
export const DEFAULT_TEXT_CHARS = 2000

/** Text an agent reads without drowning in it: long values are cut and say by how much. */
export function clip(text: string, max = DEFAULT_TEXT_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[truncated ${text.length - max} chars]`
}

/** "+00:12.3": time from the start of the recording, the same offsets the dashboard shows. */
export function offsetLabel(ms: number): string {
  const sign = ms < 0 ? "-" : "+"
  const tenths = Math.round(Math.abs(ms) / 100)
  const minutes = Math.floor(tenths / 600)
  const seconds = (tenths % 600) / 10
  return `${sign}${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`
}

const encodeCursor = (offset: number) => Buffer.from(String(offset)).toString("base64url")

function decodeCursor(cursor: string): number {
  const offset = Number(Buffer.from(cursor, "base64url").toString("utf8"))
  if (!/^[A-Za-z0-9_-]+$/.test(cursor) || !Number.isInteger(offset) || offset < 0) {
    throw new McpToolError("bad_cursor", "Invalid cursor")
  }
  return offset
}

/** One page of a list; the cursor is opaque to the agent and just holds the next offset. */
export function paginate<T>(items: readonly T[], limit = DEFAULT_LIMIT, cursor?: string) {
  const size = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)))
  const start = cursor ? decodeCursor(cursor) : 0
  const page = items.slice(start, start + size)
  const end = start + page.length
  return { items: page, nextCursor: end < items.length ? encodeCursor(end) : null, remaining: Math.max(0, items.length - end) }
}

/** The line that tells the agent how to get the next page, or nothing on the last one. */
export function moreLine(page: { nextCursor: string | null; remaining: number }): string[] {
  return page.nextCursor ? [`${page.remaining} more — call again with cursor="${page.nextCursor}"`] : []
}

export function textResult(text: string, structured?: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text }], ...(structured ? { structuredContent: structured } : {}) }
}

export function reportUrl(appUrl: string, reportId: string): string {
  return `${appUrl}/app/r/${reportId}`
}
