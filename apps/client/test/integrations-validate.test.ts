import { describe, expect, test } from "bun:test"
import { EMPTY_FIELDS, validateIntegration, validateSecret } from "../src/lib/integrations"

describe("validateIntegration for the new trackers", () => {
  test("GitLab: a clean address and a group/project path", () => {
    const fields = { ...EMPTY_FIELDS, baseUrl: "https://gitlab.com/", projectPath: "/kantor/web/", labels: "bug, bug" }
    expect(validateIntegration("gitlab", fields)).toEqual({
      ok: true,
      config: { baseUrl: "https://gitlab.com", projectPath: "kantor/web", labels: ["bug"] },
    })
    expect(validateIntegration("gitlab", { ...fields, projectPath: "web" })).toMatchObject({ ok: false })
    expect(validateIntegration("gitlab", { ...fields, baseUrl: "http://gitlab.kantor.test" })).toMatchObject({ ok: false })
  })

  test("Linear: the team key is upper-cased and must look like one", () => {
    expect(validateIntegration("linear", { ...EMPTY_FIELDS, teamKey: " eng " })).toEqual({ ok: true, config: { teamKey: "ENG", labels: [] } })
    expect(validateIntegration("linear", { ...EMPTY_FIELDS, teamKey: "1ENG" })).toMatchObject({ ok: false })
  })

  test("Jira: only a Jira Cloud site, a real email, a project key and an issue type", () => {
    const fields = {
      ...EMPTY_FIELDS,
      siteUrl: "https://Kantor.atlassian.net/",
      email: " dana@kantor.test ",
      projectKey: "bug",
      issueType: " Bug ",
    }
    expect(validateIntegration("jira", fields)).toEqual({
      ok: true,
      config: { siteUrl: "https://kantor.atlassian.net", email: "dana@kantor.test", projectKey: "BUG", issueType: "Bug", labels: [] },
    })
    expect(validateIntegration("jira", { ...fields, siteUrl: "https://jira.kantor.test" })).toMatchObject({ ok: false })
    expect(validateIntegration("jira", { ...fields, email: "dana" })).toMatchObject({ ok: false })
    expect(validateIntegration("jira", { ...fields, projectKey: "B" })).toMatchObject({ ok: false })
    expect(validateIntegration("jira", { ...fields, issueType: " " })).toMatchObject({ ok: false })
  })
})

describe("validateIntegration for notification channels", () => {
  test("Slack and Discord keep everything in the webhook URL", () => {
    expect(validateIntegration("slack", EMPTY_FIELDS)).toEqual({ ok: true, config: {} })
    expect(validateIntegration("discord", EMPTY_FIELDS)).toEqual({ ok: true, config: {} })
  })

  test("Telegram: a numeric chat id or a channel's @name", () => {
    expect(validateIntegration("telegram", { ...EMPTY_FIELDS, chatId: " -1001234 " })).toEqual({ ok: true, config: { chatId: "-1001234" } })
    expect(validateIntegration("telegram", { ...EMPTY_FIELDS, chatId: "@kantor_bugs" })).toMatchObject({ ok: true })
    expect(validateIntegration("telegram", { ...EMPTY_FIELDS, chatId: "kantor" })).toMatchObject({ ok: false })
  })

  test("Webhook: https, or http on this machine", () => {
    expect(validateIntegration("webhook", { ...EMPTY_FIELDS, url: " https://hooks.kantor.test/bugs " })).toEqual({
      ok: true,
      config: { url: "https://hooks.kantor.test/bugs" },
    })
    expect(validateIntegration("webhook", { ...EMPTY_FIELDS, url: "http://localhost:4000/hook" })).toMatchObject({ ok: true })
    expect(validateIntegration("webhook", { ...EMPTY_FIELDS, url: "http://hooks.kantor.test/bugs" })).toMatchObject({ ok: false })
    expect(validateIntegration("webhook", { ...EMPTY_FIELDS, url: "not a url" })).toMatchObject({ ok: false })
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
