import { describe, expect, test } from "bun:test"
import { render, screen, within } from "@testing-library/react"
import { ReportTableBody } from "../src/components/ReportTable"
import { listItemFixture, NOW } from "./fixtures"

const members = [{ id: "u2", name: "Budi", email: "budi@kantor.test", image: null, role: "member" as const, owner: false, joinedAt: new Date("2026-09-12T00:00:00Z") }]
const projects = [{ id: "p1", name: "Checkout Web", slug: "checkout", workspaceId: "w1", urlPatterns: [] as string[], logoUrl: null, createdAt: new Date() }]

describe("ReportTableBody", () => {
  test("columns fold away before the title gets squeezed on laptop widths", () => {
    render(<ReportTableBody items={[listItemFixture()]} members={members} projects={projects} now={NOW} rowLink={(item) => item.title} />)
    const header = (name: string) => screen.getByRole("columnheader", { name }).className.split(/\s+/)
    for (const name of ["Report", "Status", "Created"]) expect(header(name)).not.toContain("hidden")
    expect(header("Reporter")).toContain("lg:table-cell")
    for (const name of ["Priority", "Assignee", "Project"]) expect(header(name)).toContain("xl:table-cell")
    // Intent's Table scrolls sideways inside its own box.
    expect(screen.getByRole("grid").closest(".overflow-x-auto")).toBeTruthy()
  })

  test("a list row", () => {
    render(
      <ReportTableBody
        items={[
          listItemFixture({ id: "a", number: 12, captureType: "video", durationMs: 37_000, projectId: null }),
          listItemFixture({ id: "b", number: 11, assigneeId: "u2", status: "resolved" }),
        ]}
        members={members}
        projects={projects}
        now={NOW}
        rowLink={(item) => <a href={`/app/r/${item.id}`}>{item.title}</a>}
      />,
    )
    const [first, second] = screen.getAllByRole("row").slice(1)
    const one = within(first as HTMLElement)
    expect(one.getByText(/BB-12/).textContent).toContain("0:37")
    expect(one.getByText("Open")).toBeTruthy()
    expect(one.getByText("High")).toBeTruthy()
    expect(one.getByText("Unassigned")).toBeTruthy()
    expect(one.getByText("No project")).toBeTruthy()
    expect(one.getByRole("link").getAttribute("href")).toBe("/app/r/a")
    const two = within(second as HTMLElement)
    expect(two.getByText("Resolved")).toBeTruthy()
    expect(two.getByText("Budi")).toBeTruthy()
    expect(two.getByText("Checkout Web")).toBeTruthy()
    expect(two.getByText(/BB-11 · Screenshot/)).toBeTruthy()
  })
})
