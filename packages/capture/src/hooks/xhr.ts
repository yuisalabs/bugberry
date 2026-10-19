import { callSite, currentStack, type StackOf } from "../callsite"
import type { Emit, NetworkEvent, Uninstall } from "../events"
import { MAX_RESPONSE_READ_BYTES } from "../limits"
import { createPatcher, installOrUndo } from "../patch"
import { safely } from "../safe"
import { isTextContentType, redactHeaders, redactUrl, sanitizeBody } from "../sanitize"
import { absoluteUrl, bodyPreview } from "./network"

export interface XhrHost {
  XMLHttpRequest: { prototype: XMLHttpRequest }
  location: { href: string }
}

interface RequestState {
  method: string
  url: string
  headers: Record<string, string>
}

function parseRawHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf(":")
    if (separator <= 0) continue
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim()
  }
  return headers
}

function responseTextOf(xhr: XMLHttpRequest): string | undefined {
  try {
    if (xhr.responseType === "" || xhr.responseType === "text") return xhr.responseText.slice(0, MAX_RESPONSE_READ_BYTES)
    if (xhr.responseType === "json") return JSON.stringify(xhr.response)?.slice(0, MAX_RESPONSE_READ_BYTES)
  } catch {
    // responseText throws for some response types in real browsers.
  }
  return undefined
}

export function installXhrHook(host: XhrHost, emit: Emit, now: () => number, stackOf: StackOf = currentStack): Uninstall {
  const prototype = host.XMLHttpRequest.prototype
  const originalOpen = prototype.open
  const originalSend = prototype.send
  const originalSetRequestHeader = prototype.setRequestHeader
  const states = new WeakMap<XMLHttpRequest, RequestState>()
  const patcher = createPatcher()

  const open = function (this: XMLHttpRequest, ...args: unknown[]) {
    safely(() => {
      states.set(this, {
        method: String(args[0]).toUpperCase(),
        url: redactUrl(absoluteUrl(String(args[1]), host.location.href)),
        headers: {},
      })
    })
    return Reflect.apply(originalOpen, this, args)
  } as typeof prototype.open

  const setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    safely(() => {
      const state = states.get(this)
      if (state) state.headers[name.toLowerCase()] = value
    })
    return originalSetRequestHeader.call(this, name, value)
  }

  const send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    safely(() => {
      const state = states.get(this)
      if (!state) return
      const started = now()
      const requestHeaders = redactHeaders(state.headers)
      const requestBody = bodyPreview(body, state.headers["content-type"])
      const initiator = callSite(stackOf())
      // Recorded now, so a request still waiting when the report is taken is in it; completed in place later.
      const event: NetworkEvent = {
        kind: "network",
        t: started,
        method: state.method,
        url: state.url,
        ...(requestHeaders && Object.keys(requestHeaders).length > 0 ? { requestHeaders } : {}),
        ...(requestBody !== undefined ? { requestBody } : {}),
        ...(initiator ? { initiator } : {}),
        pending: true,
      }
      emit(event)

      this.addEventListener("loadend", () =>
        safely(() => {
          delete event.pending
          event.durationMs = now() - started
          if (this.status === 0) {
            event.failed = "Network error or request aborted"
          } else {
            event.status = this.status
            const headers = parseRawHeaders(this.getAllResponseHeaders())
            const responseHeaders = redactHeaders(headers)
            if (responseHeaders) event.responseHeaders = responseHeaders
            const contentType = headers["content-type"]
            const text = isTextContentType(contentType) ? responseTextOf(this) : undefined
            if (text !== undefined) event.responseBody = sanitizeBody(text, contentType)
          }
        }),
        // One listener per send: a reused request object must not report earlier requests again.
        { once: true },
      )
    })
    return originalSend.call(this, body)
  }

  installOrUndo(() => {
    patcher.replace(prototype, "open", open)
    patcher.replace(prototype, "setRequestHeader", setRequestHeader)
    patcher.replace(prototype, "send", send)
  }, patcher.restore)
  return patcher.restore
}
