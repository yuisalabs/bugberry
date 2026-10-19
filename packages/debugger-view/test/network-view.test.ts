import { describe, expect, test } from "bun:test"
import type { ViewNetwork } from "../src/debugger-events"
import { curlFor, networkSummary, requestDomain, requestName, requestState, statusLabel } from "../src/network-view"

const request = (overrides: Partial<ViewNetwork> = {}): ViewNetwork => ({
  kind: "network",
  t: 1000,
  method: "GET",
  url: "https://shop.northwind.co/api/orders?id=7",
  status: 200,
  durationMs: 40,
  requestHeaders: [],
  responseHeaders: [],
  requestBody: null,
  responseBody: null,
  failed: null,
  pending: false,
  initiator: null,
  ...overrides,
})

describe("requestName and requestDomain", () => {
  test("a full URL: the last path segment with its query, and the host", () => {
    expect(requestName("https://shop.northwind.co/api/orders?id=7")).toBe("orders?id=7")
    expect(requestDomain("https://shop.northwind.co/api/orders?id=7")).toBe("shop.northwind.co")
  })

  test("a URL ending in a slash or with no path names the host", () => {
    expect(requestName("https://shop.northwind.co/")).toBe("shop.northwind.co")
    expect(requestName("https://shop.northwind.co/checkout/")).toBe("checkout")
  })

  test("a bare path keeps its last segment and has no domain", () => {
    expect(requestName("/api/cart")).toBe("cart")
    expect(requestDomain("/api/cart")).toBe("")
  })

  test("a URL that does not parse is shown as it is", () => {
    expect(requestName("not a url")).toBe("not a url")
    expect(requestDomain("not a url")).toBe("")
  })
})

describe("requestState", () => {
  test("ok, failed and canceled", () => {
    expect(requestState(request())).toBe("ok")
    expect(requestState(request({ status: 500 }))).toBe("failed")
    expect(requestState(request({ status: null, failed: "TypeError: Failed to fetch" }))).toBe("canceled")
    expect(requestState(request({ status: null, pending: true }))).toBe("canceled")
  })

  test("a network error after a response is a failure", () => {
    expect(requestState(request({ status: 200, failed: "aborted" }))).toBe("failed")
  })
})

describe("networkSummary", () => {
  test("counts requests, failures and cancels", () => {
    const requests = [request(), request({ status: 404 }), request({ status: 503 }), request({ status: null, pending: true })]
    expect(networkSummary(requests)).toEqual({ total: 4, failed: 2, canceled: 1 })
  })
})

describe("statusLabel", () => {
  test("names common statuses", () => {
    expect(statusLabel(500)).toBe("500 Internal Server Error")
    expect(statusLabel(299)).toBe("299")
    expect(statusLabel(null)).toBe("(canceled)")
  })
})

describe("curlFor", () => {
  test("a method that is not plain letters is quoted, so a forged one cannot run a command", () => {
    expect(curlFor(request({ method: "GE`id`T", url: "https://a.test/x" }))).toBe("curl -X 'GE`id`T' 'https://a.test/x'")
  })

  test("a plain GET", () => {
    expect(curlFor(request({ url: "https://a.test/x" }))).toBe("curl -X GET 'https://a.test/x'")
  })

  test("headers and a body, with single quotes escaped", () => {
    const post = request({
      method: "POST",
      url: "https://a.test/it's",
      requestHeaders: [["content-type", "application/json"], ["x-note", "Dana's"]],
      requestBody: '{"name":"O\'Brien"}',
    })
    expect(curlFor(post)).toBe(
      String.raw`curl -X POST 'https://a.test/it'\''s' -H 'content-type: application/json' -H 'x-note: Dana'\''s' --data-raw '{"name":"O'\''Brien"}'`,
    )
  })
})
