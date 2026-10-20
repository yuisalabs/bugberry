import { describe, expect, mock, test } from "bun:test"
import { answerConsent, fetchOAuthClient, loginTarget, oauthResumeUrl, redirectHost, scopeLines } from "../src/lib/oauth"

const SIGNED = "?response_type=code&client_id=abc&scope=openid+bugberry%3Aread&exp=1&sig=xyz"

describe("oauthResumeUrl", () => {
  test.each([
    [SIGNED, `/api/auth/oauth2/authorize${SIGNED}`],
    ["?client_id=abc", null],
    ["?sig=xyz", null],
    ["", null],
    ["?next=/app", null],
  ])("%s", (search, expected) => {
    expect(oauthResumeUrl(search)).toBe(expected)
  })
})

describe("loginTarget", () => {
  test("login sends people back to authorize after sign-in", () => {
    expect(loginTarget(SIGNED, undefined)).toBe(`/api/auth/oauth2/authorize${SIGNED}`)
    expect(loginTarget("?next=%2Fapp%2Fr%2F1", "/app/r/1")).toBe("/app/r/1")
    expect(loginTarget("", "https://evil.test")).toBe("/app")
  })
})

describe("scopeLines", () => {
  test("explains the BugBerry scopes and skips the technical ones", () => {
    expect(scopeLines("openid profile offline_access bugberry:read bugberry:write")).toEqual([
      "Read reports, comments and debugger data in your workspaces",
      "Comment, change status, priority and assignee, and send reports to trackers",
    ])
    expect(scopeLines("openid bugberry:read")).toEqual(["Read reports, comments and debugger data in your workspaces"])
  })
})

describe("consent calls", () => {
  test("fetchOAuthClient reads the public client", async () => {
    const fetch = mock(async () => Response.json({ client_id: "abc", client_name: "Claude Code", client_uri: "https://claude.ai" }))
    expect(await fetchOAuthClient("abc", { fetch, assign: mock() })).toEqual({ name: "Claude Code", uri: "https://claude.ai" })
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("/api/auth/oauth2/public-client?client_id=abc")
  })

  test("fetchOAuthClient cleans the name the app chose", async () => {
    const fetch = mock(async () => Response.json({ client_name: "Claude\nCode​", client_uri: null }))
    expect((await fetchOAuthClient("abc", { fetch, assign: mock() })).name).toBe("Claude Code")
  })

  test("answerConsent posts the signed query and returns where to go", async () => {
    const fetch = mock(async () => Response.json({ redirect: true, url: "http://localhost:9999/cb?code=1" }))
    expect(await answerConsent(true, SIGNED, { fetch, assign: mock() })).toBe("http://localhost:9999/cb?code=1")
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("/api/auth/oauth2/consent")
    expect(JSON.parse(String(init.body))).toEqual({ accept: true, oauth_query: SIGNED.slice(1) })
  })

  test("answerConsent explains a refusal", async () => {
    const fetch = mock(async () => Response.json({ error_description: "expired" }, { status: 400 }))
    await expect(answerConsent(false, SIGNED, { fetch, assign: mock() })).rejects.toThrow("This request has expired. Start again from your AI app.")
  })
})

describe("redirectHost", () => {
  test("the host the app's redirect URI points at", () => {
    expect(redirectHost("?redirect_uri=https%3A%2F%2Fevil.example%2Fcb&client_id=a")).toBe("evil.example")
    expect(redirectHost("?redirect_uri=http%3A%2F%2Flocalhost%3A9999%2Fcallback")).toBe("localhost:9999")
    expect(redirectHost("?redirect_uri=com.example.app%3A%2Fcb")).toBe("com.example.app:/cb")
    expect(redirectHost("?client_id=a")).toBeNull()
  })
})
