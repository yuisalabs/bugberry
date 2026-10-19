import { describe, expect, test } from "bun:test"
import { integrationLabel, PROVIDER_LABELS, TRACKER_PROVIDERS } from "../src"

describe("tracker helpers", () => {
  test("labels integrations by provider", () => {
    expect(TRACKER_PROVIDERS).toEqual(["github", "activecollab"])
    expect(PROVIDER_LABELS).toEqual({ github: "GitHub", activecollab: "ActiveCollab" })
    expect(integrationLabel("github", { owner: "kantor", repo: "web", labels: [] })).toBe("kantor/web")
    expect(integrationLabel("activecollab", { baseUrl: "https://ac.kantor.test", projectId: 12, taskListId: 3 })).toBe(
      "Project #12",
    )
  })
})
