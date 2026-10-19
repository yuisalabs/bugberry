import { describe, expect, test } from "bun:test"
import { backTarget, sentIssues, sharePageTarget } from "../src/lib/report-page"

describe("sharePageTarget", () => {
  test("a member goes on to the full report", () => {
    expect(sharePageTarget({ id: "r1", viewerIsMember: true })).toEqual({ to: "/app/r/$reportId", params: { reportId: "r1" } })
  })

  test("a viewer stays on the share page", () => {
    expect(sharePageTarget({ id: "r1", viewerIsMember: false })).toBeNull()
  })
})

describe("backTarget", () => {
  const projects = [{ id: "p1", slug: "web" }]

  test("goes back to the report's project", () => {
    expect(backTarget({ projectId: "p1" }, projects)).toEqual({ to: "/app/p/$projectSlug", params: { projectSlug: "web" } })
  })

  test("goes to all reports without a project, or while projects load", () => {
    expect(backTarget({ projectId: null }, projects)).toEqual({ to: "/app" })
    expect(backTarget({ projectId: "p1" }, [])).toEqual({ to: "/app" })
  })
})

describe("sentIssues", () => {
  test("lists the issues that were created, with their tracker", () => {
    const data = {
      needsProject: false,
      integrations: [
        { id: "i1", provider: "github" as const, label: "acme/web", autoSend: false },
        { id: "i2", provider: "activecollab" as const, label: "Web", autoSend: false },
      ],
      links: [
        { integrationId: "i1", externalId: "142", externalUrl: "https://github.com/acme/web/issues/142", error: null, updatedAt: "" },
        { integrationId: "i2", externalId: null, externalUrl: null, error: "boom", updatedAt: "" },
      ],
    }
    expect(sentIssues(data as never)).toEqual([
      { provider: "github", externalId: "142", externalUrl: "https://github.com/acme/web/issues/142" },
    ])
    expect(sentIssues(undefined)).toEqual([])
  })

  test("an issue made through a tracker this project no longer has keeps its chip", () => {
    const data = {
      needsProject: true,
      integrations: [],
      links: [{ integrationId: "gone", externalId: "42", externalUrl: "https://github.com/acme/web/issues/42", error: null, updatedAt: "" }],
    }
    expect(sentIssues(data as never)).toEqual([
      { provider: null, externalId: "42", externalUrl: "https://github.com/acme/web/issues/42" },
    ])
  })
})
