import { beforeEach, describe, expect, test } from "bun:test"
import type { CaptureEvent, NetworkEvent } from "../src/events"
import { installXhrHook, type XhrHost } from "../src/hooks/xhr"
import { REDACTED } from "../src/sanitize"

/** Just enough of XMLHttpRequest for the hook: the test drives the response. */
class FakeXhr extends EventTarget {
  status = 0
  responseType: XMLHttpRequestResponseType = ""
  responseText = ""
  response: unknown = ""
  sent: unknown = null
  private rawHeaders = ""

  open(_method: string, _url: string | URL) {}
  setRequestHeader(_name: string, _value: string) {}
  getAllResponseHeaders() {
    return this.rawHeaders
  }
  send(body?: unknown) {
    this.sent = body
  }

  respond(status: number, headers: Record<string, string>, body: string) {
    this.status = status
    this.rawHeaders = Object.entries(headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n")
    this.responseText = body
    this.response = this.responseType === "json" ? JSON.parse(body) : body
    this.dispatchEvent(new Event("loadend"))
  }
}

let clock: number
let events: CaptureEvent[]
let uninstall: () => void
let stack: string | undefined
const originalOpen = FakeXhr.prototype.open

beforeEach(() => {
  uninstall?.()
  clock = 2000
  events = []
  stack = undefined
  const host = { XMLHttpRequest: FakeXhr, location: { href: "https://app.kantor.test/page" } } as unknown as XhrHost
  uninstall = installXhrHook(host, (event) => events.push(event), () => clock, () => stack)
})

const network = () => events.filter((event): event is NetworkEvent => event.kind === "network")

describe("installing and removing the XHR hook", () => {
  test("a method that cannot be replaced undoes the methods already replaced", () => {
    class LockedXhr extends FakeXhr {}
    Object.defineProperty(LockedXhr.prototype, "send", { value: FakeXhr.prototype.send, writable: false })
    const host = { XMLHttpRequest: LockedXhr, location: { href: "https://app.kantor.test/" } } as unknown as XhrHost
    expect(() => installXhrHook(host, () => {}, () => 1)).toThrow()
    expect(LockedXhr.prototype.open).toBe(FakeXhr.prototype.open)
    expect(LockedXhr.prototype.setRequestHeader).toBe(FakeXhr.prototype.setRequestHeader)
  })

  test("uninstall leaves a wrapper the page added later in place", () => {
    class PageXhr extends FakeXhr {}
    const host = { XMLHttpRequest: PageXhr, location: { href: "https://app.kantor.test/" } } as unknown as XhrHost
    const remove = installXhrHook(host, () => {}, () => 1)
    const ours = PageXhr.prototype.open
    const pageWrapper = function (this: FakeXhr, method: string, url: string | URL) {
      return ours.call(this, method, url)
    }
    PageXhr.prototype.open = pageWrapper
    remove()
    expect(PageXhr.prototype.open).toBe(pageWrapper)
  })
})

describe("the code that made an XHR", () => {
  test("is recorded as the initiator", () => {
    stack = ["Error", "    at x (chrome-extension://abc/capture.js:1:1)", "    at load (https://shop.test/js/legacy.js:12:3)"].join("\n")
    const xhr = new FakeXhr() as unknown as XMLHttpRequest
    xhr.open("GET", "/api/old")
    xhr.send()
    expect(network()[0]?.initiator).toBe("legacy.js:12")
  })
})

describe("an XHR that has not answered yet", () => {
  test("is visible right away as pending, then completed in place", () => {
    const xhr = new FakeXhr()
    xhr.open("get", "/api/slow")
    xhr.send()
    expect(network()).toEqual([
      { kind: "network", t: 2000, method: "GET", url: "https://app.kantor.test/api/slow", pending: true },
    ])
    clock = 2050
    xhr.respond(200, { "content-type": "text/plain" }, "ok")
    expect(network()).toHaveLength(1)
    expect(network()[0]).toMatchObject({ status: 200, durationMs: 50, responseBody: "ok" })
    expect(network()[0]?.pending).toBeUndefined()
  })
})

describe("installXhrHook", () => {
  test("records a completed request with secrets removed", () => {
    const xhr = new FakeXhr()
    xhr.open("post", "/api/login?token=abc")
    xhr.setRequestHeader("Content-Type", "application/json")
    xhr.setRequestHeader("Authorization", "Bearer x")
    xhr.send(JSON.stringify({ email: "a@b.c", password: "hunter2" }))
    clock = 2040
    xhr.respond(401, { "content-type": "application/json", "set-cookie": "s=1" }, '{"error":"bad","token":"t"}')

    expect(xhr.sent).toBe(JSON.stringify({ email: "a@b.c", password: "hunter2" }))
    expect(network()[0]).toMatchObject({
      t: 2000,
      method: "POST",
      status: 401,
      durationMs: 40,
      requestHeaders: { "content-type": "application/json", authorization: REDACTED },
      requestBody: '{"email":"a@b.c","password":"[redacted]"}',
      responseHeaders: { "content-type": "application/json", "set-cookie": REDACTED },
      responseBody: '{"error":"bad","token":"[redacted]"}',
    })
    expect(network()[0]?.url).toStartWith("https://app.kantor.test/api/login?token=")
    expect(network()[0]?.url).not.toContain("abc")
  })

  test("reads JSON responses and skips binary ones", () => {
    const json = new FakeXhr()
    json.responseType = "json"
    json.open("GET", "https://a.test/data")
    json.send()
    json.respond(200, { "content-type": "application/json" }, '{"ok":true}')

    const image = new FakeXhr()
    image.responseType = "blob"
    image.open("GET", "https://a.test/logo.png")
    image.send()
    image.respond(200, { "content-type": "image/png" }, "")

    expect(network().map((event) => event.responseBody)).toEqual(['{"ok":true}', undefined])
  })

  test("marks requests that ended without a status as failed", () => {
    const xhr = new FakeXhr()
    xhr.open("GET", "https://down.test/")
    xhr.send()
    xhr.dispatchEvent(new Event("loadend"))
    expect(network()[0]).toMatchObject({ failed: "Network error or request aborted" })
    expect(network()[0]?.status).toBeUndefined()
  })

  test("uninstall restores the prototype methods", () => {
    uninstall()
    expect(FakeXhr.prototype.open).toBe(originalOpen)
  })
})

describe("installXhrHook with a reused request object", () => {
  test("each send produces exactly one event with its own URL", () => {
    const xhr = new FakeXhr()
    xhr.open("GET", "https://a.test/poll?n=1")
    xhr.send()
    xhr.respond(200, { "content-type": "text/plain" }, "one")
    xhr.open("GET", "https://a.test/poll?n=2")
    xhr.send()
    xhr.respond(200, { "content-type": "text/plain" }, "two")
    expect(network().map((event) => [event.url, event.responseBody])).toEqual([
      ["https://a.test/poll?n=1", "one"],
      ["https://a.test/poll?n=2", "two"],
    ])
  })
})
