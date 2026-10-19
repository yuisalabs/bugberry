import { describe, expect, test } from "bun:test"
import {
  isSensitiveKey,
  isTextContentType,
  REDACTED,
  redactHeaders,
  redactUrl,
  sanitizeBody,
  truncate,
} from "../src/sanitize"

describe("isSensitiveKey", () => {
  test.each([
    ["password", true],
    ["newPassword", true],
    ["access_token", true],
    ["clientSecret", true],
    ["apiKey", true],
    ["api_key", true],
    ["X-API-KEY", true],
    ["Authorization", true],
    ["username", false],
    ["email", false],
  ])("%s → %p", (key, expected) => {
    expect(isSensitiveKey(key)).toBe(expected)
  })
})

describe("truncate", () => {
  test("keeps short text and marks cut text", () => {
    expect(truncate("abc", 5)).toBe("abc")
    expect(truncate("abcdefgh", 5)).toBe("abcde…[truncated 3 chars]")
  })
})

describe("redactHeaders", () => {
  test("lower-cases names and hides credentials", () => {
    expect(
      redactHeaders({ Authorization: "Bearer x", Cookie: "s=1", "X-Auth-Token": "t", Accept: "application/json" }),
    ).toEqual({
      authorization: REDACTED,
      cookie: REDACTED,
      "x-auth-token": REDACTED,
      accept: "application/json",
    })
  })

  test("accepts Headers and tuple lists, and ignores missing input", () => {
    expect(redactHeaders(new Headers({ "set-cookie": "a=b" }))).toEqual({ "set-cookie": REDACTED })
    expect(redactHeaders([["Proxy-Authorization", "x"]])).toEqual({ "proxy-authorization": REDACTED })
    expect(redactHeaders(undefined)).toBeUndefined()
  })
})

describe("redactUrl", () => {
  test("hides secret query parameters and leaves the rest", () => {
    const url = redactUrl("https://api.kantor.test/items?access_token=abc&page=2&api_key=k")
    expect(url).not.toContain("abc")
    expect(url).not.toContain("=k")
    expect(url).toContain("page=2")
    expect(new URL(url).searchParams.get("access_token")).toBe(REDACTED)
    // Readable in the dashboard, not percent-encoded as %5Bredacted%5D.
    expect(url).toContain("access_token=[redacted]")
  })

  test("returns URLs without secrets, and unparsable input, unchanged", () => {
    expect(redactUrl("https://a.test/x?page=1")).toBe("https://a.test/x?page=1")
    expect(redactUrl("not a url")).toBe("not a url")
  })
})

describe("isTextContentType", () => {
  test.each([
    ["application/json; charset=utf-8", true],
    ["application/problem+json", true],
    ["text/html", true],
    ["application/x-www-form-urlencoded", true],
    ["application/xml", true],
    ["text/event-stream", false],
    ["image/png", false],
    ["application/octet-stream", false],
    [null, false],
  ])("%s → %p", (contentType, expected) => {
    expect(isTextContentType(contentType)).toBe(expected)
  })
})

describe("sanitizeBody", () => {
  test("redacts sensitive JSON keys at any depth", () => {
    const body = JSON.stringify({ user: { email: "a@b.c", password: "hunter2" }, tokens: [{ refreshToken: "r" }] })
    const result = JSON.parse(sanitizeBody(body, "application/json"))
    expect(result).toEqual({ user: { email: "a@b.c", password: REDACTED }, tokens: REDACTED })
  })

  test("detects JSON sent as text/plain", () => {
    expect(sanitizeBody('{"secret":"s","a":1}', "text/plain;charset=UTF-8")).toBe('{"secret":"[redacted]","a":1}')
  })

  test("redacts form fields", () => {
    expect(sanitizeBody("user=ana&password=hunter2", "application/x-www-form-urlencoded")).toBe(
      "user=ana&password=[redacted]",
    )
  })

  test("leaves invalid JSON as text and truncates long bodies to 10 KB", () => {
    expect(sanitizeBody("{not json", "application/json")).toBe("{not json")
    const long = sanitizeBody("x".repeat(20_000), "text/plain")
    expect(long.startsWith("x".repeat(10_240))).toBe(true)
    expect(long).toContain("…[truncated 9760 chars]")
  })
})

describe("redactUrl beyond the query string", () => {
  test("hides tokens in the fragment, including hash-router queries", () => {
    const implicit = redactUrl("https://app.test/callback#access_token=abc&refresh_token=def&state=ok")
    expect(implicit).not.toContain("abc")
    expect(implicit).not.toContain("def")
    expect(implicit).toContain("state=ok")
    expect(redactUrl("https://app.test/#/callback?token=abc&tab=2")).not.toContain("abc")
  })

  test("hides signed-URL parameters, OAuth codes, API keys and user info", () => {
    const signed = redactUrl(
      "https://bucket.s3.test/f.png?X-Amz-Signature=s1&X-Amz-Credential=c1&code=oauth&key=g1&sig=s2&page=1",
    )
    for (const secret of ["s1", "c1", "oauth", "g1", "s2"]) expect(signed).not.toContain(`=${secret}`)
    expect(signed).toContain("page=1")
    expect(redactUrl("https://ana:hunter2@intranet.test/x")).not.toContain("hunter2")
  })
})

describe("sanitizeBody when strict parsing is not possible", () => {
  test("redacts sensitive pairs in NDJSON and prefixed JSON", () => {
    const ndjson = sanitizeBody('{"token":"aaa"}\n{"token":"bbb"}', "application/x-ndjson")
    expect(ndjson).not.toContain("aaa")
    expect(ndjson).not.toContain("bbb")
    const prefixed = sanitizeBody(")]}'\n{\"password\":\"ppp\",\"ok\":1}", "application/json")
    expect(prefixed).not.toContain("ppp")
    expect(prefixed).toContain('"ok":1')
  })

  test("redacts key=value secrets in plain text", () => {
    expect(sanitizeBody("user=ana token=abc123; mode=x", "text/plain")).not.toContain("abc123")
  })

  test("long bodies are cut before redaction and still redacted", () => {
    const body = `{"secret":"zzz","pad":"${"x".repeat(50_000)}"}`
    const result = sanitizeBody(body, "application/json")
    expect(result).not.toContain("zzz")
    expect(result.length).toBeLessThan(10_400)
  })
})

describe("isTextContentType for streams", () => {
  test("never treats streaming types as readable text", () => {
    expect(isTextContentType("application/x-ndjson")).toBe(false)
    expect(isTextContentType("application/stream+json")).toBe(false)
  })
})
