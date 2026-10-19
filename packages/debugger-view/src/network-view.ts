import type { ViewEvent, ViewNetwork, ViewPage, ViewResource } from "./debugger-events"

const PLACEHOLDER_ORIGIN = "http://bugberry.invalid"

function parse(url: string): URL | null {
  try {
    return new URL(url, PLACEHOLDER_ORIGIN)
  } catch {
    return null
  }
}

/** What DevTools shows in its Name column: the last path segment with its query, else the host. */
export function requestName(url: string): string {
  const parsed = parse(url)
  if (!parsed || (parsed.origin === PLACEHOLDER_ORIGIN && !url.startsWith("/"))) return url
  const segment = parsed.pathname.split("/").filter(Boolean).at(-1)
  if (!segment) return parsed.origin === PLACEHOLDER_ORIGIN ? url : parsed.host
  return `${decodeURIComponentSafe(segment)}${parsed.search}`
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** The request's host; empty for a bare path or a URL that does not parse. */
export function requestDomain(url: string): string {
  const parsed = parse(url)
  return parsed && parsed.origin !== PLACEHOLDER_ORIGIN ? parsed.host : ""
}

/** The path and query, for the request detail heading. */
export function requestPath(url: string): string {
  const parsed = parse(url)
  return parsed ? `${parsed.pathname}${parsed.search}` : url
}

/** Canceled: no response came (a network error or still waiting when the report was taken). */
export function requestState(request: ViewNetwork): "ok" | "failed" | "canceled" {
  if (request.status === null && (request.failed !== null || request.pending)) return "canceled"
  if (request.failed !== null || (request.status ?? 0) >= 400) return "failed"
  return "ok"
}

export function networkSummary(requests: readonly ViewNetwork[]): { total: number; failed: number; canceled: number } {
  let failed = 0
  let canceled = 0
  for (const request of requests) {
    const state = requestState(request)
    if (state === "failed") failed++
    if (state === "canceled") canceled++
  }
  return { total: requests.length, failed, canceled }
}

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Payload Too Large",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
}

/** "500 Internal Server Error"; "(canceled)" when no response came. */
export function statusLabel(status: number | null): string {
  if (status === null) return "(canceled)"
  const text = STATUS_TEXT[status]
  return text ? `${status} ${text}` : String(status)
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

/** The request as a shell command, for "Copy as cURL". */
export function curlFor(request: ViewNetwork): string {
  // The method comes from the recorded page; anything but plain letters is quoted like the rest.
  const method = /^[A-Z]+$/.test(request.method) ? request.method : quote(request.method)
  const parts = [`curl -X ${method} ${quote(request.url)}`]
  for (const [name, value] of request.requestHeaders) parts.push(`-H ${quote(`${name}: ${value}`)}`)
  if (request.requestBody !== null) parts.push(`--data-raw ${quote(request.requestBody)}`)
  return parts.join(" ")
}

export type RowType = "document" | "fetch" | "xhr" | "script" | "stylesheet" | "img" | "font" | "media" | "websocket" | "other"

/** One line of the Network table: a recorded request, a timing entry, a page, or a request and its entry together. */
export interface NetworkRow {
  key: string
  t: number
  url: string
  method: string
  status: number | null
  type: RowType
  durationMs: number | null
  request: ViewNetwork | null
  resource: ViewResource | null
  page: ViewPage | null
}

/** A fetch/XHR and the browser's timing entry for it start within this many ms of each other. */
const MATCH_WINDOW_MS = 100

const EXTENSIONS: Array<[RegExp, RowType]> = [
  [/\.m?js$/, "script"],
  [/\.css$/, "stylesheet"],
  [/\.(?:woff2?|ttf|otf|eot)$/, "font"],
  [/\.(?:png|jpe?g|gif|webp|svg|avif|ico|bmp)$/, "img"],
  [/\.(?:mp4|webm|mp3|ogg|wav|m4a|mov)$/, "media"],
]

function byExtension(url: string): RowType | null {
  const path = parse(url)?.pathname.toLowerCase() ?? ""
  return EXTENSIONS.find(([pattern]) => pattern.test(path))?.[1] ?? null
}

/** What kind of file a row is: from the browser's initiator type, else from the file extension. */
export function rowType(initiatorType: string | null, url: string): RowType {
  switch (initiatorType) {
    case "fetch":
      return "fetch"
    case "xmlhttprequest":
      return "xhr"
    case "websocket":
      return "websocket"
    case "script":
      return "script"
    case "img":
    case "image":
      return "img"
    case "video":
    case "audio":
      return "media"
    case "navigation":
    case "iframe":
    case "frame":
      return "document"
    default:
      return byExtension(url) ?? "other"
  }
}

/** Every request, file and page of the recording in time order; a fetch/XHR absorbs its timing entry. */
export function networkRows(events: readonly ViewEvent[]): NetworkRow[] {
  const requests = events.filter((event): event is ViewNetwork => event.kind === "network")
  const matched = new Map<ViewNetwork, ViewResource>()
  const rows: NetworkRow[] = []
  events.forEach((event, index) => {
    if (event.kind === "resource") {
      if (event.initiatorType === "fetch" || event.initiatorType === "xmlhttprequest") {
        const request = requests.find(
          (candidate) => !matched.has(candidate) && candidate.url === event.url && Math.abs(candidate.t - event.t) <= MATCH_WINDOW_MS,
        )
        if (request) {
          matched.set(request, event)
          return
        }
      }
      rows.push({
        key: `r${index}`,
        t: event.t,
        url: event.url,
        method: "GET",
        status: null,
        type: rowType(event.initiatorType, event.url),
        durationMs: event.durationMs,
        request: null,
        resource: event,
        page: null,
      })
    } else if (event.kind === "page") {
      rows.push({
        key: `p${index}`,
        t: event.t,
        url: event.url,
        method: "GET",
        status: null,
        type: "document",
        durationMs: event.loadMs,
        request: null,
        resource: null,
        page: event,
      })
    }
  })
  requests.forEach((request, index) => {
    const resource = matched.get(request) ?? null
    rows.push({
      key: `n${index}`,
      t: request.t,
      url: request.url,
      method: request.method,
      status: request.status,
      type: resource ? rowType(resource.initiatorType, request.url) : "fetch",
      durationMs: request.durationMs ?? resource?.durationMs ?? null,
      request,
      resource,
      page: null,
    })
  })
  return rows.sort((a, b) => a.t - b.t)
}

export const TYPE_FILTERS = ["All", "Fetch/XHR", "WS", "JS", "CSS", "Doc", "Media", "Other"] as const
export type TypeFilter = (typeof TYPE_FILTERS)[number]

const FILTER_TYPES: Record<Exclude<TypeFilter, "All">, readonly RowType[]> = {
  "Fetch/XHR": ["fetch", "xhr"],
  WS: ["websocket"],
  JS: ["script"],
  CSS: ["stylesheet"],
  Doc: ["document"],
  Media: ["img", "media"],
  Other: ["font", "other"],
}

export function matchesFilter(row: NetworkRow, filter: TypeFilter): boolean {
  return filter === "All" || FILTER_TYPES[filter].includes(row.type)
}

/** Bytes the way Chrome writes them: base 1000, one decimal. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/** The Size column: a cache hit, the transferred bytes, or nothing when the browser hid the size. */
export function sizeLabel(row: NetworkRow): string {
  if (row.resource?.cache === "memory") return "(memory cache)"
  if (row.resource?.cache === "disk") return "(disk cache)"
  const bytes = row.resource?.transferSize ?? row.page?.transferSize ?? null
  return bytes === null ? "" : formatBytes(bytes)
}

const endOf = (row: NetworkRow) => row.t + (row.durationMs ?? 0)

/** Where each row's bar sits in the Waterfall column, across the whole recording's span. */
export function waterfall(rows: readonly NetworkRow[]): Map<string, { leftPercent: number; widthPercent: number }> {
  const bars = new Map<string, { leftPercent: number; widthPercent: number }>()
  if (rows.length === 0) return bars
  const start = Math.min(...rows.map((row) => row.t))
  const span = Math.max(...rows.map(endOf)) - start || 1
  for (const row of rows) {
    bars.set(row.key, {
      leftPercent: ((row.t - start) / span) * 100,
      widthPercent: Math.max(0.5, ((row.durationMs ?? 0) / span) * 100),
    })
  }
  return bars
}

/** The second footer line: what was transferred, the resources' size, how long it all took, and page timing. */
export function networkTotals(events: readonly ViewEvent[]): {
  transferredBytes: number
  resourceBytes: number
  finishMs: number | null
  domContentLoadedMs: number | null
  loadMs: number | null
} {
  const rows = networkRows(events)
  let transferredBytes = 0
  let resourceBytes = 0
  for (const row of rows) {
    transferredBytes += row.resource?.transferSize ?? row.page?.transferSize ?? 0
    resourceBytes += row.resource?.decodedSize ?? 0
  }
  const pages = events.filter((event): event is ViewPage => event.kind === "page")
  const latest = pages.reduce<ViewPage | null>((last, page) => (!last || page.t > last.t ? page : last), null)
  const finishMs = rows.length > 0 ? Math.max(...rows.map(endOf)) - Math.min(...rows.map((row) => row.t)) : null
  return {
    transferredBytes,
    resourceBytes,
    finishMs,
    domContentLoadedMs: latest?.domContentLoadedMs ?? null,
    loadMs: latest?.loadMs ?? null,
  }
}

/** How the capture marks a body it cut short: `…[truncated 168092 chars]` at the end. */
const TRUNCATED = /…\[truncated \d+ chars\]$/

/**
 * JSON laid out two spaces per level without parsing it, so a body cut off part way still reads well up to the
 * cut. Commas, colons and brackets inside strings are left alone; an empty `{}` or `[]` stays on one line.
 */
function layoutJson(text: string): string {
  let out = ""
  let depth = 0
  let inString = false
  let escaped = false
  const newline = () => `\n${"  ".repeat(depth)}`
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index)
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
    } else if (char === '"') {
      inString = true
      out += char
    } else if (char === "{" || char === "[") {
      let next = index + 1
      while (next < text.length && /\s/.test(text.charAt(next))) next++
      if (text.charAt(next) === (char === "{" ? "}" : "]")) {
        out += char + text.charAt(next)
        index = next
      } else {
        depth++
        out += char + newline()
      }
    } else if (char === "}" || char === "]") {
      depth = Math.max(0, depth - 1)
      out += newline() + char
    } else if (char === ",") {
      out += `,${newline()}`
    } else if (char === ":") {
      out += ": "
    } else if (!/\s/.test(char)) {
      out += char
    }
  }
  return out
}

/**
 * A recorded body as Chrome's Preview would lay it out: a JSON object or array indented by two spaces, also when
 * the capture cut it short. Anything else (plain text, form data, broken JSON) is shown exactly as it came.
 */
export function prettyBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return body
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    const cut = trimmed.match(TRUNCATED)
    return cut ? layoutJson(trimmed.slice(0, cut.index)) + cut[0] : body
  }
}
