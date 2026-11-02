import { describe, expect, test } from "bun:test"
import { cleanFixUrl, fixLinkLabel } from "../src/fix-links"

describe("cleanFixUrl", () => {
  test("http(s) only, trimmed, at most 2000", () => {
    expect(cleanFixUrl(" https://github.com/o/r/pull/1 ")).toBe("https://github.com/o/r/pull/1")
    expect(cleanFixUrl("HTTPS://x.test/a")).toBe("https://x.test/a")
    expect(cleanFixUrl("javascript:alert(1)")).toBeNull()
    expect(cleanFixUrl("ftp://x.test")).toBeNull()
    expect(cleanFixUrl("not a url")).toBeNull()
    expect(cleanFixUrl(`https://x.test/${"a".repeat(2000)}`)).toBeNull()
  })
})

describe("fixLinkLabel", () => {
  test("providers", () => {
    expect(fixLinkLabel("https://github.com/shop/web/pull/42")).toEqual({ label: "PR #42 · shop/web", provider: "github" })
    expect(fixLinkLabel("https://github.com/shop/web/commit/0123456789abcdef")).toEqual({ label: "0123456 · shop/web", provider: "github" })
    expect(fixLinkLabel("https://gitlab.com/grp/sub/web/-/merge_requests/7")).toEqual({ label: "MR !7 · grp/sub/web", provider: "gitlab" })
    expect(fixLinkLabel("https://bitbucket.org/ws/repo/pull-requests/3")).toEqual({ label: "PR #3 · ws/repo", provider: "bitbucket" })
    expect(fixLinkLabel("https://ci.example.com/build/1234")).toEqual({ label: "ci.example.com/build/1234", provider: "other" })
    expect(fixLinkLabel(`https://x.test/${"a".repeat(80)}`).label).toHaveLength(60)
  })

  test("a GitHub link that isn't a PR or commit, or an unreadable one, still gets a label", () => {
    expect(fixLinkLabel("https://github.com/shop/web/tree/main")).toEqual({ label: "github.com/shop/web/tree/main", provider: "github" })
    expect(fixLinkLabel("nope")).toEqual({ label: "nope", provider: "other" })
  })
})
