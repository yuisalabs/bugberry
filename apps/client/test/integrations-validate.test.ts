import { describe, expect, test } from "bun:test"
import { EMPTY_FIELDS, validateChatId, validateConnection, validateSecret } from "../src/lib/integrations"

describe("validateConnection", () => {
  test("GitHub and Linear keep nothing but the token", () => {
    expect(validateConnection("github", EMPTY_FIELDS)).toEqual({ ok: true, settings: {} })
    expect(validateConnection("linear", EMPTY_FIELDS)).toEqual({ ok: true, settings: {} })
  })

  test("GitLab and ActiveCollab need an https address, kept without a trailing slash", () => {
    expect(validateConnection("gitlab", { ...EMPTY_FIELDS, baseUrl: "https://gitlab.com/" })).toEqual({
      ok: true,
      settings: { baseUrl: "https://gitlab.com" },
    })
    expect(validateConnection("gitlab", { ...EMPTY_FIELDS, baseUrl: "http://gitlab.kantor.test" })).toMatchObject({ ok: false })
    expect(validateConnection("activecollab", { ...EMPTY_FIELDS, baseUrl: "https://ac.kantor.test/" })).toEqual({
      ok: true,
      settings: { baseUrl: "https://ac.kantor.test" },
    })
    expect(validateConnection("activecollab", { ...EMPTY_FIELDS, baseUrl: "https://ac.kantor.test/?x=1" })).toMatchObject({ ok: false })
  })

  test("Plane: an https address and the workspace slug", () => {
    expect(validateConnection("plane", { ...EMPTY_FIELDS, baseUrl: "https://api.plane.so/", workspaceSlug: " kantor " })).toEqual({
      ok: true,
      settings: { baseUrl: "https://api.plane.so", workspaceSlug: "kantor" },
    })
    expect(validateConnection("plane", { ...EMPTY_FIELDS, baseUrl: "https://api.plane.so", workspaceSlug: "kan tor" })).toMatchObject({ ok: false })
    expect(validateConnection("plane", { ...EMPTY_FIELDS, baseUrl: "http://plane.kantor.test", workspaceSlug: "kantor" })).toMatchObject({ ok: false })
  })

  test("Jira: only a Jira Cloud site, and a real email", () => {
    const fields = { ...EMPTY_FIELDS, siteUrl: "https://Kantor.atlassian.net/", email: " dana@kantor.test " }
    expect(validateConnection("jira", fields)).toEqual({
      ok: true,
      settings: { siteUrl: "https://kantor.atlassian.net", email: "dana@kantor.test" },
    })
    expect(validateConnection("jira", { ...fields, siteUrl: "https://jira.kantor.test" })).toMatchObject({ ok: false })
    expect(validateConnection("jira", { ...fields, email: "dana" })).toMatchObject({ ok: false })
  })

  test("Slack, Discord and Telegram keep everything in the secret", () => {
    for (const provider of ["slack", "discord", "telegram"] as const) {
      expect(validateConnection(provider, EMPTY_FIELDS)).toEqual({ ok: true, settings: {} })
    }
  })

  test("Webhook: https, or http on this machine", () => {
    expect(validateConnection("webhook", { ...EMPTY_FIELDS, url: " https://hooks.kantor.test/bugs " })).toEqual({
      ok: true,
      settings: { url: "https://hooks.kantor.test/bugs" },
    })
    expect(validateConnection("webhook", { ...EMPTY_FIELDS, url: "http://localhost:4000/hook" })).toMatchObject({ ok: true })
    expect(validateConnection("webhook", { ...EMPTY_FIELDS, url: "http://hooks.kantor.test/bugs" })).toMatchObject({ ok: false })
    expect(validateConnection("webhook", { ...EMPTY_FIELDS, url: "not a url" })).toMatchObject({ ok: false })
  })
})

describe("validateChatId", () => {
  test("a numeric chat id or a channel's @name", () => {
    expect(validateChatId(" -1001234 ")).toBe("-1001234")
    expect(validateChatId("@kantor_bugs")).toBe("@kantor_bugs")
    expect(validateChatId("kantor")).toBeNull()
  })
})

describe("validateSecret", () => {
  test("a Slack or Discord webhook URL must point at that service", () => {
    expect(validateSecret("slack", "https://hooks.slack.com/services/T0/B0/x")).toBeNull()
    expect(validateSecret("slack", "https://hooks.kantor.test/services/x")).toMatch(/Slack/)
    expect(validateSecret("discord", "https://discordapp.com/api/webhooks/1/a")).toBeNull()
    expect(validateSecret("discord", "https://discord.com/channels/1")).toMatch(/Discord/)
    expect(validateSecret("discord", "not a url")).toMatch(/Discord/)
  })

  test("other providers take any token", () => {
    expect(validateSecret("github", "ghp_x")).toBeNull()
    expect(validateSecret("telegram", "123:abc")).toBeNull()
  })
})
