import type { CaptureEvent, DebuggerPayload, NetworkEvent } from "@bugberry/capture"

/** One thing that happened in the recording, as the AI reads it. `atMs` is from the start of the video. */
export interface MaterialLine {
  atMs: number
  kind: "action" | "navigate" | "error" | "request" | "note"
  text: string
  /** A failed request's response body, cut short; only when the workspace sends bodies. */
  body?: string
}

/** What the AI gets from a recording: never request bodies, headers, successful requests or typed values. */
export interface Material {
  page: { url: string; title: string | null }
  device: { browser: string; os: string }
  lines: MaterialLine[]
  /** Lines left out to stay under the caps. */
  omitted: number
}

export const MAX_LINES = 200
export const MAX_BODY_CHARS = 1000
export const MAX_LINE_CHARS = 500
export const MAX_MATERIAL_CHARS = 40_000

/** Lines that explain the bug: kept first when a recording is too long. */
const KEY_KINDS = new Set<MaterialLine["kind"]>(["error", "request", "note"])

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}…[cut]`)

/** The address without its query string or fragment, which can hold tokens and personal data. */
function withoutQuery(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url.split(/[?#]/)[0] ?? url
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url.split(/[?#]/)[0] ?? url
  }
}

const isFailed = (event: CaptureEvent): event is NetworkEvent =>
  event.kind === "network" && (Boolean(event.failed) || (event.status ?? 0) >= 400)

function lineOf(event: CaptureEvent, atMs: number, includeResponseBodies: boolean): MaterialLine | null {
  switch (event.kind) {
    case "action": {
      const target = event.target ?? "the page"
      if (event.type === "navigate") return event.url ? { atMs, kind: "navigate", text: `Opened ${pathOf(event.url)}` } : null
      if (event.type === "click") return { atMs, kind: "action", text: `Clicked ${target}` }
      if (event.type === "rage-click") return { atMs, kind: "action", text: `Clicked ${target} ${event.value ?? "several"} times` }
      if (event.type === "submit") return { atMs, kind: "action", text: `Submitted ${target}` }
      if (event.type === "input") return { atMs, kind: "action", text: `Typed into ${target}` }
      return null
    }
    case "console":
      return event.level === "error" ? { atMs, kind: "error", text: event.args.join(" ") } : null
    case "error":
      return { atMs, kind: "error", text: event.message }
    case "network": {
      if (!isFailed(event)) return null
      const request = `${event.method.toUpperCase()} ${pathOf(event.url)}`
      const outcome = event.failed ? `failed: ${event.failed}` : String(event.status)
      const body = includeResponseBodies && event.responseBody ? { body: event.responseBody } : {}
      return { atMs, kind: "request", text: `${request} → ${outcome}`, ...body }
    }
    default:
      return null
  }
}

const sizeOf = (material: Material) => JSON.stringify(material).length

/** Keeps the material under MAX_LINES and MAX_MATERIAL_CHARS: key lines first, then the earliest of the rest. */
function fit(material: Material): Material {
  const byTime = [...material.lines].sort((a, b) => a.atMs - b.atMs)
  let lines = byTime
  if (lines.length > MAX_LINES) {
    // Steps need the reporter's actions as much as the errors: key lines take at most half when both are many.
    const key = byTime.filter((line) => KEY_KINDS.has(line.kind))
    const others = byTime.filter((line) => !KEY_KINDS.has(line.kind))
    const keyCount = Math.min(key.length, Math.max(MAX_LINES - others.length, MAX_LINES / 2))
    lines = [...key.slice(0, keyCount), ...others.slice(0, MAX_LINES - keyCount)].sort((a, b) => a.atMs - b.atMs)
  }
  let omitted = material.omitted + byTime.length - lines.length
  let fitted: Material = { ...material, lines, omitted }
  // Bodies give way first, then whole lines from the end: the others before the key ones.
  for (const max of [200, 0]) {
    if (sizeOf(fitted) <= MAX_MATERIAL_CHARS) return fitted
    fitted = {
      ...fitted,
      lines: fitted.lines.map(({ body, ...line }) => (body && max > 0 ? { ...line, body: cut(body, max) } : line)),
    }
  }
  while (sizeOf(fitted) > MAX_MATERIAL_CHARS && fitted.lines.length > 0) {
    const others = fitted.lines.findLastIndex((line) => !KEY_KINDS.has(line.kind))
    const drop = others >= 0 ? others : fitted.lines.length - 1
    omitted += 1
    fitted = { ...fitted, lines: fitted.lines.filter((_, index) => index !== drop), omitted }
  }
  return fitted
}

/** Full addresses anywhere in a text, without their query string or fragment. */
const withoutQueries = (text: string) => text.replace(/(https?:\/\/[^\s?#]*)[?#]\S*/g, "$1")

function tidy(line: MaterialLine, includeResponseBodies: boolean): MaterialLine {
  // Request and page lines hold bare paths too ("GET /x?token=1 → 500").
  const text = line.kind === "request" || line.kind === "navigate" ? line.text.replace(/[?#]\S*/g, "") : withoutQueries(line.text)
  const tidied: MaterialLine = { atMs: line.atMs, kind: line.kind, text: cut(text, MAX_LINE_CHARS) }
  if (includeResponseBodies && line.kind === "request" && line.body) tidied.body = cut(line.body, MAX_BODY_CHARS)
  return tidied
}

/** The recording as the AI reads it: what the reporter did, what broke, and their notes. */
export function buildMaterial(input: {
  payload: DebuggerPayload
  page: { url: string; title?: string | null }
  device: { browser: string; os: string }
  includeResponseBodies: boolean
}): Material {
  const { payload, includeResponseBodies } = input
  const base = payload.recordingStartedAt ?? payload.capturedAt
  const lines: MaterialLine[] = []
  for (const event of payload.events) {
    const line = lineOf(event, Math.max(0, event.t - base), includeResponseBodies)
    if (line) lines.push(line)
  }
  for (const note of payload.notes ?? []) lines.push({ atMs: note.atMs, kind: "note", text: `Note ${note.n}: ${note.text}` })
  return restrictMaterial(
    { page: { url: input.page.url, title: input.page.title ?? null }, device: input.device, lines, omitted: 0 },
    { includeResponseBodies },
  )
}

/** The privacy rules and caps again, on material from anywhere: the server applies them to what the extension sends. */
export function restrictMaterial(material: Material, opts: { includeResponseBodies: boolean }): Material {
  return fit({
    page: { url: withoutQuery(material.page.url), title: material.page.title ? cut(material.page.title, MAX_LINE_CHARS) : null },
    device: { browser: cut(material.device.browser, 100), os: cut(material.device.os, 100) },
    lines: material.lines.map((line) => tidy(line, opts.includeResponseBodies)),
    omitted: material.omitted,
  })
}
