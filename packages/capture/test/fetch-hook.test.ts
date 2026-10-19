import { describe, expect, test } from "bun:test"
import type { CaptureEvent, NetworkEvent } from "../src/events"
import { type FetchHost, installFetchHook } from "../src/hooks/fetch"
import { REDACTED } from "../src/sanitize"

const PAGE_STACK = ["Error", "    at x (chrome-extension://abc/capture.js:1:1)", "    at add (https://shop.test/cart.js:88:3)"].join("\n")

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(
  respond: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  stackOf?: () => string | undefined,
) {
  let clock = 1000
  const events: CaptureEvent[] = []
  const calls: Array<{ self: unknown; args: unknown[] }> = []
  const original = async function (this: unknown, ...args: unknown[]) {
    calls.push({ self: this, args })
    clock += 25
    return respond(args[0] as RequestInfo | URL, args[1] as RequestInit | undefined)
  } as typeof fetch
  const host: FetchHost = { fetch: original, location: { href: "https://app.kantor.test/orders/1" } }
  const uninstall = installFetchHook(host, (event) => events.push(event), () => clock, stackOf)
  const network = () => events.filter((event): event is NetworkEvent => event.kind === "network")
  return { host, original, events, calls, network, uninstall }
}

describe("the code that made a fetch", () => {
  test("is recorded as the initiator", async () => {
    const { host, network } = setup(async () => new Response("ok"), () => PAGE_STACK)
    await host.fetch("/api/cart")
    expect(network()[0]?.initiator).toBe("cart.js:88")
  })
})

describe("a fetch that has not answered yet", () => {
  test("is visible right away as pending, then completed in place", async () => {
    let answer: (response: Response) => void = () => {}
    const { host, network } = setup(() => new Promise((resolve) => (answer = resolve)))
    const request = host.fetch("/api/slow")
    await flush()
    expect(network()).toEqual([
      { kind: "network", t: 1000, method: "GET", url: "https://app.kantor.test/api/slow", pending: true },
    ])

    answer(new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }))
    await request
    const [event] = network()
    expect(event).toMatchObject({ status: 200, durationMs: 25 })
    expect(event?.pending).toBeUndefined()
    expect(network()).toHaveLength(1)
  })
})

describe("installFetchHook", () => {
  test("records request and response details with secrets removed", async () => {
    const { host, network } = setup(async () =>
      Response.json({ id: 1, accessToken: "abc" }, { status: 201, headers: { "set-cookie": "s=1" } }),
    )
    const response = await host.fetch("/api/orders?api_key=k&page=2", {
      method: "post",
      headers: { "content-type": "application/json", authorization: "Bearer secret" },
      body: JSON.stringify({ item: "pen", password: "hunter2" }),
    })
    expect(await response.json()).toEqual({ id: 1, accessToken: "abc" })
    await flush()

    const [event] = network()
    expect(event).toMatchObject({
      kind: "network",
      t: 1000,
      method: "POST",
      status: 201,
      durationMs: 25,
      requestHeaders: { "content-type": "application/json", authorization: REDACTED },
      requestBody: '{"item":"pen","password":"[redacted]"}',
      responseBody: '{"id":1,"accessToken":"[redacted]"}',
    })
    expect(event?.responseHeaders?.["set-cookie"]).toBe(REDACTED)
    expect(event?.url).toStartWith("https://app.kantor.test/api/orders?")
    expect(event?.url).not.toContain("api_key=k")
  })

  test("passes this, arguments and the very same Response through", async () => {
    const page = new Response("ok", { headers: { "content-type": "text/plain" } })
    const { host, calls } = setup(async () => page)
    const init = { method: "GET" }
    const result = await host.fetch.call(host, "https://a.test/x", init)
    expect(result).toBe(page)
    expect(calls[0]).toEqual({ self: host, args: ["https://a.test/x", init] })
  })

  test("takes method and URL from a Request object", async () => {
    const { host, network } = setup(async () => new Response(null, { status: 204 }))
    await host.fetch(new Request("https://a.test/items/9", { method: "DELETE" }))
    expect(network()[0]).toMatchObject({ method: "DELETE", url: "https://a.test/items/9", status: 204 })
  })

  test("records network failures and rethrows the page's own error", async () => {
    const failure = new TypeError("Failed to fetch")
    const { host, network } = setup(async () => {
      throw failure
    })
    await expect(host.fetch("https://down.test/")).rejects.toBe(failure)
    expect(network()[0]).toMatchObject({ failed: "TypeError: Failed to fetch", durationMs: 25 })
    expect(network()[0]?.status).toBeUndefined()
  })

  test("never reads streaming, binary or oversized responses", async () => {
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled += 1
          return new Promise(() => {}) // an event stream that never ends
        },
      },
      { highWaterMark: 0 }, // only pulled when someone actually reads it
    )
    const responses = [
      new Response(stream, { headers: { "content-type": "text/event-stream" } }),
      new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } }),
      new Response("{}", { headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024) } }),
    ]
    let index = 0
    const { host, network } = setup(async () => responses[index++] as Response)

    const sse = await host.fetch("https://a.test/events")
    await host.fetch("https://a.test/logo.png")
    await host.fetch("https://a.test/huge.json")
    await flush()

    expect(sse).toBe(responses[0] as Response)
    expect(sse.bodyUsed).toBe(false)
    expect(pulled).toBe(0)
    expect(network().map((event) => event.responseBody)).toEqual([undefined, undefined, undefined])
    expect(network().map((event) => event.status)).toEqual([200, 200, 200])
  })

  test("uninstall restores the original fetch", () => {
    const { host, original, uninstall } = setup(async () => new Response("x"))
    uninstall()
    expect(host.fetch).toBe(original)
  })

  test("refuses to install when fetch cannot be replaced", () => {
    const host = { location: { href: "https://a.test/" } } as FetchHost
    Object.defineProperty(host, "fetch", { value: async () => new Response(""), writable: false })
    expect(() => installFetchHook(host, () => {}, () => 0)).toThrow()
  })
})

describe("installFetchHook bounded reads", () => {
  test("stops reading an endless text stream after the read limit", async () => {
    let pulls = 0
    const chunk = new TextEncoder().encode(`${"a".repeat(64 * 1024 - 1)}\n`)
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(chunk)
      },
    })
    const page = new Response(endless, { headers: { "content-type": "text/plain" } })
    const { host, network } = setup(async () => page)
    const result = await host.fetch("https://a.test/llm-stream")
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(result).toBe(page)
    expect(pulls).toBeLessThan(40)
    expect(network()[0]?.responseBody?.length).toBeLessThan(10_400)
  })
})
