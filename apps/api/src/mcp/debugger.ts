import { type DebuggerView, normalizePayload } from "@bugberry/debugger-view"
import { gunzipLimited } from "../lib/trackers/debugger-errors"
import { type McpContext, McpToolError } from "./context"
import type { ResolvedReport } from "./refs"

export const NO_DEBUGGER = "This report has no captured debugger data"

export interface DebuggerCache {
  get(key: string): DebuggerView | undefined
  set(key: string, view: DebuggerView): void
}

/**
 * Validated debugger views kept for a few minutes, so an agent's run of tools on one report reads
 * storage once. Least recently used goes first; a Map keeps insertion order, and a hit moves to the end.
 * Only data is cached: every tool call still checks who may read the report.
 */
export function createDebuggerCache(opts: { maxEntries?: number; ttlMs?: number; now?: () => number } = {}): DebuggerCache {
  const maxEntries = opts.maxEntries ?? 20
  const ttlMs = opts.ttlMs ?? 5 * 60_000
  const now = opts.now ?? Date.now
  const entries = new Map<string, { view: DebuggerView; expiresAt: number }>()
  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      entries.delete(key)
      if (entry.expiresAt <= now()) return undefined
      entries.set(key, entry)
      return entry.view
    },
    set(key, view) {
      entries.delete(key)
      if (entries.size >= maxEntries) {
        const oldest = entries.keys().next().value
        if (oldest !== undefined) entries.delete(oldest)
      }
      entries.set(key, { view, expiresAt: now() + ttlMs })
    },
  }
}

/** The report's debugger data, validated like the dashboard does; null when there is none or it can't be read. */
export async function loadDebuggerView(ctx: McpContext, report: ResolvedReport): Promise<DebuggerView | null> {
  const key = report.row.debuggerKey
  if (!key) return null
  const cacheKey = `${report.id}:${key}`
  const cached = ctx.cache.get(cacheKey)
  if (cached) return cached
  try {
    const blob = await ctx.deps.storage.read(key)
    if (!blob) return null
    const view = normalizePayload(JSON.parse(await gunzipLimited(blob)))
    ctx.cache.set(cacheKey, view)
    return view
  } catch {
    return null
  }
}

export async function requireDebuggerView(ctx: McpContext, report: ResolvedReport): Promise<DebuggerView> {
  const view = await loadDebuggerView(ctx, report)
  if (!view) throw new McpToolError("no_debugger", NO_DEBUGGER)
  return view
}
