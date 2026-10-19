import { callSite, currentStack, type StackOf } from "../callsite"
import type { Emit, NetworkEvent, Uninstall } from "../events"
import { MAX_RESPONSE_READ_BYTES } from "../limits"
import { attempt, safely } from "../safe"
import { isTextContentType, redactHeaders, redactUrl, sanitizeBody } from "../sanitize"
import { absoluteUrl, bodyPreview, errorMessage } from "./network"

type FetchArgs = Parameters<typeof globalThis.fetch>

export interface FetchHost {
  fetch: typeof fetch
  location: { href: string }
}

function isRequest(input: unknown): input is Request {
  return typeof input === "object" && input !== null && "url" in input && "method" in input && "headers" in input
}

function contentTypeOf(headers: HeadersInit | undefined): string | null {
  return attempt(() => new Headers(headers).get("content-type")) ?? null
}

function describeRequest(input: RequestInfo | URL, init: RequestInit | undefined, baseHref: string, t: number) {
  const request = isRequest(input) ? input : null
  const headers = init?.headers ?? request?.headers
  const requestHeaders = redactHeaders(headers)
  const requestBody = bodyPreview(init?.body, contentTypeOf(headers))
  const event: NetworkEvent = {
    kind: "network",
    t,
    method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
    url: redactUrl(absoluteUrl(request ? request.url : String(input), baseHref)),
    ...(requestHeaders ? { requestHeaders } : {}),
    ...(requestBody !== undefined ? { requestBody } : {}),
  }
  return event
}

function recordResponse(event: NetworkEvent, response: Response) {
  event.status = response.status
  const responseHeaders = redactHeaders(response.headers)
  if (responseHeaders) event.responseHeaders = responseHeaders

  const contentType = response.headers.get("content-type")
  const declaredLength = Number(response.headers.get("content-length"))
  const tooLarge = Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_READ_BYTES
  if (!response.body || tooLarge || !isTextContentType(contentType)) return

  // Read a copy in the background; the page gets its response without waiting for us.
  const copy = response.clone().body
  if (!copy) return
  readTextLimited(copy, MAX_RESPONSE_READ_BYTES).then(
    (text) => {
      event.responseBody = sanitizeBody(text, contentType)
    },
    () => {},
  )
}

/**
 * Reads at most `maxBytes` (decoded size can be far larger than content-length for compressed
 * responses), then cancels our copy so an endless or huge body is never buffered in full.
 */
async function readTextLimited(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ""
  let received = 0
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      received += value.byteLength
      text += decoder.decode(value, { stream: true })
    }
    return text
  } finally {
    reader.cancel().catch(() => {})
  }
}

export function installFetchHook(host: FetchHost, emit: Emit, now: () => number, stackOf: StackOf = currentStack): Uninstall {
  const original = host.fetch
  if (typeof original !== "function") throw new Error("fetch is not available")

  const hooked = async function fetch(this: unknown, ...args: FetchArgs): Promise<Response> {
    const started = now()
    const event = attempt(() => describeRequest(args[0], args[1], host.location.href, started))
    // Recorded now, so a request still waiting when the report is taken is in it; completed in place later.
    safely(() => {
      if (!event) return
      const initiator = callSite(stackOf())
      if (initiator) event.initiator = initiator
      event.pending = true
      emit(event)
    })
    let response: Response
    try {
      response = await Reflect.apply(original, this, args)
    } catch (error) {
      safely(() => {
        if (!event) return
        delete event.pending
        event.durationMs = now() - started
        event.failed = errorMessage(error)
      })
      throw error
    }
    safely(() => {
      if (!event) return
      delete event.pending
      event.durationMs = now() - started
      recordResponse(event, response)
    })
    return response
  } as typeof fetch

  host.fetch = hooked
  if (host.fetch !== hooked) throw new Error("fetch could not be replaced")
  return () => {
    if (host.fetch === hooked) host.fetch = original
  }
}
