import type { StorageDriver } from "../../storage/types"

/** Payloads are capped at the source; anything larger than this after gunzip is not ours. */
const MAX_DECOMPRESSED_BYTES = 16 * 1024 * 1024
const MAX_ERRORS = 3
const MAX_ERROR_CHARS = 500

export async function gunzipLimited(blob: Blob, maxBytes = MAX_DECOMPRESSED_BYTES): Promise<string> {
  const reader = blob.stream().pipeThrough(new DecompressionStream("gzip")).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new Error("Debugger payload is too large")
      chunks.push(value)
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

function errorText(event: unknown): string | null {
  if (typeof event !== "object" || event === null) return null
  const value = event as { kind?: unknown; message?: unknown; level?: unknown; args?: unknown }
  if (value.kind === "error" && typeof value.message === "string") return value.message
  if (value.kind === "console" && value.level === "error" && Array.isArray(value.args)) {
    return value.args.filter((arg): arg is string => typeof arg === "string").join(" ")
  }
  return null
}

/** The first distinct page and console errors, in the order they happened (the first is usually the cause). */
export function topErrors(events: unknown[], limit = MAX_ERRORS, maxChars = MAX_ERROR_CHARS): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const event of events) {
    const text = errorText(event)?.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text.length > maxChars ? `${text.slice(0, maxChars)}…` : text)
    if (result.length === limit) break
  }
  return result
}

/** Top errors from a report's debugger.json.gz; any problem reading it just means no errors to show. */
export async function readTopErrors(storage: StorageDriver, key: string): Promise<string[]> {
  try {
    const blob = await storage.read(key)
    if (!blob) return []
    const payload = JSON.parse(await gunzipLimited(blob)) as { events?: unknown }
    return Array.isArray(payload.events) ? topErrors(payload.events) : []
  } catch {
    return []
  }
}
