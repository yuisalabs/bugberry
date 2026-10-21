import { describe, expect, test } from "bun:test"
import {
  INTEGRATION_PROVIDERS,
  integrationKind,
  integrationLabel,
  isTrackerProvider,
  issueReference,
  NOTIFIER_PROVIDERS,
  PROVIDER_LABELS,
  TRACKER_PROVIDERS,
} from "../src"

describe("integration helpers", () => {
  test("trackers and notifiers make up every provider, each with a label", () => {
    expect(TRACKER_PROVIDERS).toEqual(["github", "activecollab", "gitlab", "linear", "jira"])
    expect(NOTIFIER_PROVIDERS).toEqual(["slack", "discord", "telegram", "webhook"])
    expect(INTEGRATION_PROVIDERS).toEqual([...TRACKER_PROVIDERS, ...NOTIFIER_PROVIDERS])
    expect(Object.keys(PROVIDER_LABELS).sort()).toEqual([...INTEGRATION_PROVIDERS].sort())
    expect(isTrackerProvider("jira")).toBe(true)
    expect(isTrackerProvider("slack")).toBe(false)
    expect(integrationKind("telegram")).toBe("notifier")
  })

  test("labels integrations by provider", () => {
    expect(integrationLabel("github", { owner: "kantor", repo: "web", labels: [] })).toBe("kantor/web")
    expect(integrationLabel("activecollab", { baseUrl: "https://ac.kantor.test", projectId: 12, taskListId: 3 })).toBe(
      "Project #12",
    )
    expect(integrationLabel("jira", { siteUrl: "https://kantor.atlassian.net", email: "a@b.c", projectKey: "BUG", issueType: "Bug", labels: [] })).toBe(
      "BUG",
    )
    expect(integrationLabel("slack", {})).toBe("Slack channel")
    expect(integrationLabel("webhook", { url: "not a url" })).toBe("Webhook")
  })

  test("issues are referred to the way each tracker does", () => {
    expect(issueReference("gitlab", "42")).toBe("#42")
    expect(issueReference(null, "42")).toBe("#42")
    expect(issueReference("linear", "ENG-142")).toBe("ENG-142")
  })
})
