import { describe, expect, test } from "bun:test"
import { ApiError, type UnwrapText, unwrapWith } from "../src/api-error"

const fail = (status: number, value: unknown) => Promise.resolve({ data: null, error: { status, value } })
const caught = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error as ApiError)

describe("unwrapWith, with the dashboard's text", () => {
  const text: UnwrapText = {
    network: "BugBerry can't be reached. Check your connection and try again.",
    fallback: "The request failed. Try again.",
  }

  test("a request that never reached the server is a network error", async () => {
    const error = await caught(unwrapWith(text, Promise.reject(new TypeError("fetch failed"))))
    expect(error).toBeInstanceOf(ApiError)
    expect(error?.status).toBe(0)
    expect(error?.code).toBe("network")
    expect(error?.message).toBe(text.network)
  })

  test("a failed fetch Eden reports as a 503 carrying an Error is a network error too", async () => {
    const error = await caught(unwrapWith(text, fail(503, new Error("fetch failed"))))
    expect(error?.code).toBe("network")
    expect(error?.message).toBe(text.network)
  })

  test("an error answer keeps its status, code, message and whole body, and how long it took", async () => {
    const error = await caught(
      unwrapWith(text, fail(403, { code: "use_share_link", message: "Open this report through its share link", shareSlug: "x" })),
    )
    expect(error?.status).toBe(403)
    expect(error?.code).toBe("use_share_link")
    expect(error?.message).toBe("Open this report through its share link")
    expect(error?.body.shareSlug).toBe("x")
    expect(typeof error?.waitedMs).toBe("number")
  })

  test("an answer without code or message gets the fallback", async () => {
    const error = await caught(unwrapWith(text, fail(500, {})))
    expect(error?.code).toBe("error")
    expect(error?.message).toBe(text.fallback)
  })

  test("no data and no error is an empty answer", async () => {
    const error = await caught(unwrapWith(text, Promise.resolve({ data: null, error: null })))
    expect(error?.code).toBe("empty")
    expect(error?.message).toBe("The server sent an empty response")
  })

  test("data comes back as it is", async () => {
    expect(await unwrapWith(text, Promise.resolve({ data: { ok: true }, error: null }))).toEqual({ ok: true })
  })
})

describe("unwrapWith, with the extension's text", () => {
  const text: UnwrapText = {
    network: "Can't reach the BugBerry server",
    fallback: "The request to the server failed",
    messages: { unauthorized: "Your session ended. Sign in, then send again." },
  }

  test("a code with its own message uses it", async () => {
    const error = await caught(unwrapWith(text, fail(401, { code: "unauthorized", message: "Login required" })))
    expect(error?.message).toBe("Your session ended. Sign in, then send again.")
  })

  test("any other code keeps the server's message", async () => {
    const error = await caught(unwrapWith(text, fail(404, { code: "project_gone", message: "Gone" })))
    expect(error?.message).toBe("Gone")
  })

  test("a network error uses the extension's words", async () => {
    const error = await caught(unwrapWith(text, Promise.reject(new TypeError("x"))))
    expect(error?.message).toBe("Can't reach the BugBerry server")
  })

  test("network, rate limit, server and not-yet-visible upload errors may succeed on a later try", () => {
    expect(new ApiError(0, "network", "x").retryable).toBe(true)
    expect(new ApiError(429, "rate_limited", "x").retryable).toBe(true)
    expect(new ApiError(503, "maintenance", "x").retryable).toBe(true)
    expect(new ApiError(409, "upload_incomplete", "x").retryable).toBe(true)
    expect(new ApiError(404, "report_not_found", "x").retryable).toBe(false)
  })
})
