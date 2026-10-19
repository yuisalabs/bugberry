import { type DebuggerView, normalizePayload } from "@bugberry/debugger-view"
import { gunzipLimited } from "../lib/trackers/debugger-errors"
import { type McpContext, McpToolError } from "./context"
import type { ResolvedReport } from "./refs"

export const NO_DEBUGGER = "This report has no captured debugger data"

/** What one read produced: the view, or null when there is none or it can't be read, and its rough size. */
export interface LoadedView {
  view: DebuggerView | null
  bytes: number
}

export interface DebuggerCache {
  /** The cached result for `key`, or the one `read` produces; parallel callers share a single read. */
  load(key: string, read: () => Promise<LoadedView>): Promise<DebuggerView | null>
}

/**
 * Validated debugger views kept for a few minutes, so an agent's run of tools on one report reads
 * storage once. Bounded by count and by the size of the JSON they came from; least recently used goes
 * first. Unreadable payloads are remembered too, so a broken file is not fetched and unpacked on every
 * call. Only data is cached: every tool call still checks who may read the report.
 */
export function createDebuggerCache(
  opts: { maxEntries?: number; maxBytes?: number; ttlMs?: number; now?: () => number } = {},
): DebuggerCache {
  const maxEntries = opts.maxEntries ?? 20
  const maxBytes = opts.maxBytes ?? 64 * 1024 * 1024
  const ttlMs = opts.ttlMs ?? 5 * 60_000
  const now = opts.now ?? Date.now
  const entries = new Map<string, LoadedView & { expiresAt: number }>()
  const inFlight = new Map<string, Promise<DebuggerView | null>>()
  let totalBytes = 0

  const drop = (key: string) => {
    const entry = entries.get(key)
    if (!entry) return
    totalBytes -= entry.bytes
    entries.delete(key)
  }

  const store = (key: string, loaded: LoadedView) => {
    drop(key)
    if (loaded.bytes > maxBytes) return
    while (entries.size > 0 && (entries.size >= maxEntries || totalBytes + loaded.bytes > maxBytes)) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      drop(oldest)
    }
    entries.set(key, { ...loaded, expiresAt: now() + ttlMs })
    totalBytes += loaded.bytes
  }

  return {
    load(key, read) {
      const entry = entries.get(key)
      if (entry && entry.expiresAt > now()) {
        // A hit moves to the end, so the least recently used entry is always first.
        entries.delete(key)
        entries.set(key, entry)
        return Promise.resolve(entry.view)
      }
      drop(key)
      const pending = inFlight.get(key)
      if (pending) return pending
      const loading = read()
        .then((loaded) => {
          store(key, loaded)
          return loaded.view
        })
        .finally(() => inFlight.delete(key))
      inFlight.set(key, loading)
      return loading
    },
  }
}

/** At most this many payloads are unpacked and parsed at once, across every request. */
const MAX_PARALLEL_READS = 4
let activeReads = 0
const waiting: Array<() => void> = []

async function withReadSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeReads >= MAX_PARALLEL_READS) await new Promise<void>((resolve) => waiting.push(resolve))
  activeReads++
  try {
    return await work()
  } finally {
    activeReads--
    waiting.shift()?.()
  }
}

/** The report's debugger data, validated like the dashboard does; null when there is none or it can't be read. */
export async function loadDebuggerView(ctx: McpContext, report: ResolvedReport): Promise<DebuggerView | null> {
  const key = report.row.debuggerKey
  if (!key) return null
  return ctx.cache.load(`${report.id}:${key}`, () =>
    withReadSlot(async (): Promise<LoadedView> => {
      try {
        const blob = await ctx.deps.storage.read(key)
        if (!blob) return { view: null, bytes: 0 }
        const json = await gunzipLimited(blob)
        return { view: normalizePayload(JSON.parse(json)), bytes: json.length }
      } catch {
        return { view: null, bytes: 0 }
      }
    }),
  )
}

export async function requireDebuggerView(ctx: McpContext, report: ResolvedReport): Promise<DebuggerView> {
  const view = await loadDebuggerView(ctx, report)
  if (!view) throw new McpToolError("no_debugger", NO_DEBUGGER)
  return view
}
