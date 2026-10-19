import { describe, expect, test } from "bun:test"
import { reportUrl, safeHttpUrl, safeNext, shareUrl } from "../src/lib/urls"

describe("safeNext", () => {
  test("keeps same-site paths with their query and hash", () => {
    expect(safeNext("/p/web?status=%5B%22open%22%5D")).toBe("/p/web?status=%5B%22open%22%5D")
    expect(safeNext("/s/AbCdEf123456")).toBe("/s/AbCdEf123456")
    expect(safeNext("/app/r/x?y=1")).toBe("/app/r/x?y=1")
    expect(safeNext("/extension/connect?extId=abc#x")).toBe("/extension/connect?extId=abc#x")
  })

  test("falls back to the dashboard for anything that could leave the site or loop", () => {
    for (const value of [
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "evil.com",
      "",
      undefined,
      42,
      "/login?next=/p/x",
    ]) {
      expect(safeNext(value)).toBe("/app")
    }
  })
})

describe("safeHttpUrl", () => {
  test("only http and https become links", () => {
    expect(safeHttpUrl("https://app.kantor.test/a?b=1")).toBe("https://app.kantor.test/a?b=1")
    expect(safeHttpUrl("http://localhost:4400/")).toBe("http://localhost:4400/")
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull()
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull()
    expect(safeHttpUrl("not a url")).toBeNull()
  })
})

describe("share and report links", () => {
  test("are absolute URLs on the given origin", () => {
    expect(shareUrl("AbC123", "https://bugberry.kantor.test")).toBe("https://bugberry.kantor.test/s/AbC123")
    expect(reportUrl("r-1", "https://bugberry.kantor.test")).toBe("https://bugberry.kantor.test/app/r/r-1")
  })
})
