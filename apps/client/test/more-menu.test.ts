import { describe, expect, test } from "bun:test"
import type { ReportTrackers } from "../src/lib/api"
import { sendOutcome, trackerItems } from "../src/lib/more-menu"

const now = new Date("2026-10-16T08:00:00Z")
const integrations = [
  { id: "gh", provider: "github" as const, label: "kantor/web", autoSend: true },
  { id: "ac", provider: "activecollab" as const, label: "Project #12", autoSend: false },
]
const data = (links: ReportTrackers["links"]): ReportTrackers => ({ needsProject: false, integrations, links })
const link = (overrides: Partial<ReportTrackers["links"][number]>): ReportTrackers["links"][number] => ({
  integrationId: "gh",
  provider: "github",
  externalId: null,
  externalUrl: null,
  error: null,
  updatedAt: now,
  ...overrides,
})

describe("trackerItems", () => {
  test("offers to send to each tracker not used yet", () => {
    expect(trackerItems(data([]), now.getTime())).toEqual([
      { integrationId: "gh", label: "Send to GitHub · kantor/web", action: "send", href: null, note: null },
      { integrationId: "ac", label: "Send to ActiveCollab · Project #12", action: "send", href: null, note: null },
    ])
  })

  test("a send in progress cannot be started again", () => {
    const [item] = trackerItems(data([link({})]), now.getTime() + 10_000)
    expect(item).toMatchObject({ label: "Sending to GitHub…", action: "none" })
  })

  test("a send this page just started shows as running", () => {
    const [item] = trackerItems(data([link({ error: "Bad token" })]), now.getTime(), "gh")
    expect(item).toMatchObject({ label: "Sending to GitHub…", action: "none", note: null })
  })

  test("a failed send offers a retry with the error", () => {
    const [item] = trackerItems(data([link({ error: "Bad token" })]), now.getTime())
    expect(item).toMatchObject({ label: "Retry send to GitHub", action: "retry", note: "Bad token" })
  })

  test("a send that never finished offers a retry", () => {
    const [item] = trackerItems(data([link({})]), now.getTime() + 3 * 60_000)
    expect(item).toMatchObject({ label: "Retry send to GitHub", action: "retry", note: "The earlier send didn't finish." })
  })

  test("a created issue opens in its tracker, only through a safe link", () => {
    const [item] = trackerItems(
      data([link({ externalId: "142", externalUrl: "https://github.com/kantor/web/issues/142" })]),
      now.getTime(),
    )
    expect(item).toEqual({
      integrationId: "gh",
      label: "Open in GitHub #142",
      action: "open",
      href: "https://github.com/kantor/web/issues/142",
      note: null,
    })
    const [unsafe] = trackerItems(data([link({ externalId: "142", externalUrl: "javascript:alert(1)" })]), now.getTime())
    expect(unsafe).toMatchObject({ action: "open", href: null })
  })

  test("issues created before the report moved projects still open", () => {
    const earlier = link({ integrationId: "gone", externalId: "42", externalUrl: "https://github.com/kantor/web/issues/42" })
    const items = trackerItems({ needsProject: true, integrations: [], links: [earlier] }, now.getTime())
    expect(items).toEqual([
      {
        integrationId: "gone",
        label: "Open issue #42",
        action: "open",
        href: "https://github.com/kantor/web/issues/42",
        note: "From an integration this project no longer has",
      },
    ])
  })

  test("an earlier Linear or Jira issue reads by its key, also once its integration is gone", () => {
    const earlier = link({ integrationId: null, provider: "linear", externalId: "ENG-142", externalUrl: "https://linear.app/kantor/issue/ENG-142" })
    const [item] = trackerItems({ needsProject: false, integrations: [], links: [earlier] }, now.getTime())
    expect(item?.label).toBe("Open issue ENG-142")
  })
})

describe("sendOutcome", () => {
  test("a created issue says where it went, with a way to open it", () => {
    expect(sendOutcome(link({ externalId: "12", externalUrl: "https://github.com/kantor/web/issues/12" }))).toEqual({
      title: "Sent to GitHub",
      description: "Created issue #12",
      tone: "success",
      href: "https://github.com/kantor/web/issues/12",
    })
    expect(sendOutcome(link({ provider: "linear", externalId: "ENG-4", externalUrl: "https://linear.app/x/ENG-4" })).description).toBe(
      "Created issue ENG-4",
    )
  })

  test("an issue link that isn't http(s) is not offered", () => {
    expect(sendOutcome(link({ externalId: "12", externalUrl: "javascript:alert(1)" })).href).toBeNull()
  })

  test("a failed send says so, with the tracker's reason", () => {
    expect(sendOutcome(link({ provider: "activecollab", error: "Project not found" }))).toEqual({
      title: "Couldn't send to ActiveCollab",
      description: "Project not found",
      tone: "error",
      href: null,
    })
  })

  test("a tracker no longer known is named plainly", () => {
    expect(sendOutcome(link({ provider: null, error: "Bad token" })).title).toBe("Couldn't send to the tracker")
  })
})
