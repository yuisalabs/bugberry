import type { Priority, ReportStatus } from "@bugberry/shared"
import { describe, expect, test } from "bun:test"
import { backLink, backTarget, sentIssues, sharePageTarget, withPatch } from "../src/features/reports/detail/report-page"

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

describe("backLink", () => {
  const projects = [
    { id: "p1", slug: "web", name: "Quinella AI" },
    { id: "p2", slug: "docs", name: "Docs" },
  ]

  test("opened from a project, it leads back there and says the project's name", () => {
    const back = backLink({ projectId: "p1" }, projects, { projectSlug: "web" })
    expect(back.link).toEqual({ to: "/app/p/$projectSlug", params: { projectSlug: "web" } })
    expect(back.label).toBe("Quinella AI")
  })

  test("opened from All reports, it goes back to All reports even when the report has a project", () => {
    expect(backLink({ projectId: "p1" }, projects, "all")).toMatchObject({ link: { to: "/app" }, label: "All reports" })
  })

  test("opened from elsewhere (the bell, a link), it follows the report's project, named", () => {
    expect(backLink({ projectId: "p2" }, projects)).toMatchObject({ label: "Docs", project: { slug: "docs" } })
    expect(backLink({ projectId: null }, projects)).toMatchObject({ label: "All reports", project: null })
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

describe("withPatch", () => {
  const ana: { id: string; name: string; image: string | null } = { id: "u1", name: "Ana", image: null }
  const budi = { id: "u2", name: "Budi", image: "https://img.test/budi.png" }
  const report: { title: string; status: ReportStatus; priority: Priority; assignee: typeof ana | null; projectId: string } = {
    title: "Pay fails",
    status: "open",
    priority: "medium",
    assignee: ana,
    projectId: "p1",
  }
  const members = [ana, { ...budi, email: "budi@kantor.test" }]

  test("status, priority and title show at once; the rest stays", () => {
    expect(withPatch(report, { status: "resolved" }, members)).toEqual({ ...report, status: "resolved" })
    expect(withPatch(report, { priority: "high", title: "Pay fails on Safari" }, members)).toEqual({
      ...report,
      priority: "high",
      title: "Pay fails on Safari",
    })
  })

  test("the assignee becomes the member chosen, or nobody", () => {
    expect(withPatch(report, { assigneeId: "u2" }, members).assignee).toEqual(budi)
    expect(withPatch(report, { assigneeId: null }, members).assignee).toBeNull()
  })

  test("an assignee not in the list keeps the current one until the server answers", () => {
    expect(withPatch(report, { assigneeId: "u9" }, members).assignee).toEqual(ana)
    expect(withPatch(report, { assigneeId: "u2" }, undefined).assignee).toEqual(ana)
  })
})
