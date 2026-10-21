import { describe, expect, test } from "bun:test"
import {
  CONNECTION_SETTING_KEYS,
  hasTarget,
  INTEGRATION_PROVIDERS,
  targetKey,
  targetLabel,
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
    expect(TRACKER_PROVIDERS).toEqual(["github", "activecollab", "gitlab", "linear", "jira", "plane"])
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

  test("a use's target has a key that ignores labels, and a short label", () => {
    expect(targetKey("github", { owner: "Kantor", repo: "Web", labels: ["bug"] })).toBe("kantor/web")
    expect(targetKey("github", { owner: "kantor", repo: "web", labels: [] })).toBe("kantor/web")
    expect(targetKey("jira", { projectKey: "BUG", issueType: "Bug", labels: [] })).toBe("bug/bug")
    expect(targetKey("activecollab", { projectId: 12, taskListId: 3 })).toBe("12/3")
    expect(targetKey("telegram", { chatId: "-100" })).toBe("-100")
    expect(targetKey("linear", { teamKey: "eng", labels: [] })).toBe("ENG")
    expect(targetKey("slack", {})).toBe("")
    expect(targetLabel("gitlab", { projectPath: "kantor/web", labels: [] })).toBe("kantor/web")
    expect(targetLabel("linear", { teamKey: "ENG", labels: [] })).toBe("Team ENG")
    expect(targetLabel("jira", { projectKey: "BUG", issueType: "Bug", labels: [] })).toBe("BUG · Bug")
    expect(targetLabel("activecollab", { projectId: 12, taskListId: 3 })).toBe("Project #12")
    expect(targetLabel("telegram", { chatId: "-100" })).toBe("Chat -100")
    expect(targetLabel("slack", {})).toBeNull()
    expect(hasTarget("telegram")).toBe(true)
    expect(hasTarget("activecollab")).toBe(true)
    expect(hasTarget("webhook")).toBe(false)
    expect(CONNECTION_SETTING_KEYS).toEqual(["baseUrl", "siteUrl", "email", "url", "workspaceSlug"])
  })

  test("Plane is a tracker whose work items read by their key", () => {
    expect(TRACKER_PROVIDERS).toContain("plane")
    expect(PROVIDER_LABELS.plane).toBe("Plane")
    expect(hasTarget("plane")).toBe(true)
    const target = { projectId: "B7E42A19-3C5D-4F80-9A26-8D1C0F4E7B53", projectName: "Website (WEB)", labels: ["bug"] }
    expect(targetKey("plane", target)).toBe("b7e42a19-3c5d-4f80-9a26-8d1c0f4e7b53")
    expect(targetLabel("plane", target)).toBe("Website (WEB)")
    expect(issueReference("plane", "WEB-142")).toBe("WEB-142")
    expect(
      integrationLabel("plane", { baseUrl: "https://api.plane.so", workspaceSlug: "kantor", ...target }),
    ).toBe("Website (WEB)")
  })

  test("issues are referred to the way each tracker does", () => {
    expect(issueReference("gitlab", "42")).toBe("#42")
    expect(issueReference(null, "42")).toBe("#42")
    expect(issueReference("linear", "ENG-142")).toBe("ENG-142")
  })
})
