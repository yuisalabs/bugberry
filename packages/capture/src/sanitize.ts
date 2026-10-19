import { MAX_BODY_CHARS } from "./limits"

export const REDACTED = "[redacted]"
/** How URLSearchParams writes REDACTED; turned back so the dashboard shows "[redacted]". */
const ENCODED_REDACTED = encodeURIComponent(REDACTED)

const readable = (serialized: string) => serialized.replaceAll(ENCODED_REDACTED, REDACTED)

const SENSITIVE_KEY = /password|token|secret|api[-_]?key|authorization/i
/** Extra names that only carry secrets in URLs (signed URLs, OAuth codes, Google API keys, session ids). */
const SENSITIVE_URL_KEY = /^(code|key|sig|signature|session|sid|credential|x-amz-(signature|credential|security-token)|x-goog-(signature|credential))$/i
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "set-cookie", "x-api-key", "proxy-authorization"])
const MAX_REDACT_DEPTH = 20

/** `"key": value` pairs, for text that is not strictly parseable JSON. */
const LOOSE_JSON_PAIR = /("((?:[^"\\]|\\.)*)"\s*:\s*)("(?:[^"\\]|\\.)*"|[^,}\]\s]+)/g
/** `key=value` pairs in query strings, cookies and log lines. */
const LOOSE_KEY_VALUE = /(^|[?&;,\s])([\w.-]+)=([^&;,\s]*)/g

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key)
}

function isSensitiveUrlKey(key: string): boolean {
  return isSensitiveKey(key) || SENSITIVE_URL_KEY.test(key)
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[truncated ${text.length - max} chars]`
}

export function redactHeaders(headers: HeadersInit | null | undefined): Record<string, string> | undefined {
  if (!headers) return undefined
  let normalized: Headers
  try {
    normalized = new Headers(headers)
  } catch {
    return undefined
  }
  const result: Record<string, string> = {}
  normalized.forEach((value, name) => {
    result[name] = SENSITIVE_HEADERS.has(name) || isSensitiveKey(name) ? REDACTED : value
  })
  return result
}

function redactParams(params: URLSearchParams, isSecret: (key: string) => boolean = isSensitiveKey): boolean {
  let changed = false
  for (const key of new Set(params.keys())) {
    if (isSecret(key)) {
      params.set(key, REDACTED)
      changed = true
    }
  }
  return changed
}

/** Redacts the `a=b&c=d` part of a fragment, whether it is the whole fragment or follows a hash route (`#/cb?…`). */
function redactFragment(hash: string): string {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash
  const queryStart = fragment.indexOf("?")
  const route = queryStart >= 0 ? fragment.slice(0, queryStart + 1) : ""
  const query = queryStart >= 0 ? fragment.slice(queryStart + 1) : fragment
  if (!query.includes("=")) return hash
  const params = new URLSearchParams(query)
  return redactParams(params, isSensitiveUrlKey) ? `#${route}${readable(params.toString())}` : hash
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    let changed = redactParams(parsed.searchParams, isSensitiveUrlKey)
    if (parsed.username || parsed.password) {
      parsed.username = ""
      parsed.password = ""
      changed = true
    }
    if (parsed.hash) {
      const hash = redactFragment(parsed.hash)
      if (hash !== parsed.hash) {
        parsed.hash = hash
        changed = true
      }
    }
    return changed ? readable(parsed.toString()) : url
  } catch {
    return url
  }
}

function mediaType(contentType: string | null | undefined): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
}

export function isTextContentType(contentType: string | null | undefined): boolean {
  const type = mediaType(contentType)
  // Streams can be endless: never read them.
  if (!type || type.includes("stream") || type.includes("ndjson")) return false
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type.endsWith("+json") ||
    type === "application/x-www-form-urlencoded" ||
    type === "application/xml" ||
    type.endsWith("+xml") ||
    type === "application/javascript"
  )
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH || value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1))
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, isSensitiveKey(key) ? REDACTED : redactValue(item, depth + 1)]),
  )
}

/** Pattern-based redaction for text that cannot be parsed strictly; it never fails open. */
function redactLoosely(text: string): string {
  return text
    .replace(LOOSE_JSON_PAIR, (match, prefix: string, key: string) =>
      isSensitiveKey(key) ? `${prefix}"${REDACTED}"` : match,
    )
    .replace(LOOSE_KEY_VALUE, (match, lead: string, key: string) =>
      isSensitiveKey(key) ? `${lead}${key}=${REDACTED}` : match,
    )
}

function redactJsonText(text: string): string {
  try {
    return JSON.stringify(redactValue(JSON.parse(text)))
  } catch {
    return redactLoosely(text)
  }
}

/**
 * Redacts secrets in a request/response body and cuts it to MAX_BODY_CHARS. Long bodies are cut first
 * and then redacted by pattern, so the work per body stays bounded.
 */
export function sanitizeBody(text: string, contentType: string | null | undefined): string {
  if (text.length > MAX_BODY_CHARS) {
    return `${redactLoosely(text.slice(0, MAX_BODY_CHARS))}…[truncated ${text.length - MAX_BODY_CHARS} chars]`
  }
  const type = mediaType(contentType)
  if (type === "application/x-www-form-urlencoded") {
    const params = new URLSearchParams(text)
    return redactParams(params) ? readable(params.toString()) : text
  }
  // JSON is often sent as text/plain by fetch(url, { body: JSON.stringify(...) }).
  if (/^\s*[[{]/.test(text)) return redactJsonText(text)
  return redactLoosely(text)
}
