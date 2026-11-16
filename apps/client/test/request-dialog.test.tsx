import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { DebuggerTabs } from "../src/features/reports/debugger/DebuggerTabs"
import { ReportMeta } from "../src/features/reports/detail/ReportMeta"
import { ReportCardBody } from "../src/features/reports/list/ReportCard"
import { RequestLinkListView } from "../src/features/requests/RequestLinkList"
import { MadeLink, RequestLinkForm } from "../src/features/requests/RequestRecordingDialog"
import { listItemFixture, reportFixture } from "./fixtures"

const NOW = new Date("2026-11-16T12:00:00Z").getTime()
const projects = [
  { id: "p1", name: "Storefront" },
  { id: "p2", name: "Admin" },
]

describe("asking for a recording", () => {
  test("the dialog makes a link for the page's project with 7 days and 5 recordings preselected", async () => {
    const createRequest = mock()
    render(<RequestLinkForm projects={projects} defaultProjectId="p1" busy={false} error={null} onCreate={createRequest} />)
    fireEvent.change(screen.getByLabelText("Note for them"), { target: { value: "The checkout bug, please" } })
    fireEvent.click(screen.getByRole("button", { name: "Create link" }))
    await waitFor(() => expect(createRequest).toHaveBeenCalled())
    expect(createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", expiresInDays: 7, maxUses: 5, note: "The checkout bug, please" }),
    )
  })

  test("the made link is shown once with Copy, and a line saying it can't be shown again", () => {
    render(<MadeLink url="https://bb.test/request/abc" onDone={mock()} />)
    expect((screen.getByLabelText("Link") as HTMLInputElement).value).toBe("https://bb.test/request/abc")
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy()
    expect(screen.getByText("Copy it now. For safety, BugBerry can't show this link again.")).toBeTruthy()
  })

  test("the list shows each link's use, state and reports, and revokes after asking", async () => {
    const onRevoke = mock()
    const base = {
      projectId: "p1",
      note: "The checkout bug",
      pageUrl: null,
      createdBy: { id: "u1", name: "Ana" },
      createdAt: new Date(NOW - 86_400_000),
      maxUses: 5,
    }
    render(
      <RequestLinkListView
        now={NOW}
        me="u1"
        isAdmin={false}
        projects={projects}
        items={[
          { ...base, id: "q1", expiresAt: new Date(NOW + 6 * 86_400_000), used: 2, status: "live", reports: [{ id: "r1", number: 12 }] },
          { ...base, id: "q2", expiresAt: new Date(NOW - 1000), used: 0, status: "expired", reports: [] },
          { ...base, id: "q3", createdBy: { id: "u2", name: "Budi" }, expiresAt: new Date(NOW + 86_400_000), used: 0, status: "live", reports: [] },
        ]}
        onRevoke={onRevoke}
      />,
    )
    expect(screen.getByText("2 of 5 used · expires in 6 days")).toBeTruthy()
    expect(screen.getByText("Expired")).toBeTruthy()
    expect(screen.getByRole("link", { name: "BB-12" }).getAttribute("href")).toBe("/app/r/r1")
    expect(screen.getAllByRole("button", { name: /^Revoke/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: /^Revoke/ }))
    fireEvent.click(await screen.findByRole("button", { name: "Revoke link" }))
    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith("q1"))
  })
})

describe("a recording that came through a link", () => {
  test("a card and the report page say who sent it", () => {
    const { unmount } = render(<ReportCardBody item={listItemFixture({ senderName: "Budi" })} now={NOW} />)
    expect(screen.getByText("Sent by Budi through a request link")).toBeTruthy()
    unmount()
    render(<ReportMeta report={reportFixture({ sender: { name: "Budi", email: "budi@client.test" } })} issues={[]} />)
    expect(screen.getByText("Sent by Budi through a request link")).toBeTruthy()
    expect(screen.getByText("budi@client.test")).toBeTruthy()
  })

  test("a request-link report explains its empty DevTools", () => {
    render(<DebuggerTabs report={reportFixture({ sender: { name: "Budi" } })} state={{ status: "none" }} onRetry={() => {}} />)
    fireEvent.click(screen.getByRole("tab", { name: /Activity/ }))
    expect(screen.getByText("No console or network data: this was recorded from a request link, without the extension.")).toBeTruthy()
  })
})
