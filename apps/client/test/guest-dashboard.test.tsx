import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ReportFieldsText } from "../src/features/reports/detail/ReportFields"
import { CommentsSection } from "../src/features/reports/comments/CommentsSection"
import { commentFixture } from "./fixtures"
import { ReportFilters } from "../src/features/reports/list/ReportFilters"
import { FiltersSheetContent } from "../src/features/reports/list/MobileReportFilters"

describe("a guest's report page", () => {
  test("status, priority and assignee are text, with no menus", () => {
    render(<ReportFieldsText report={{ status: "in_progress", priority: "high", assignee: { id: "u2", name: "Budi", image: null } }} />)
    expect(screen.getByText("In progress")).toBeTruthy()
    expect(screen.getByText("High")).toBeTruthy()
    expect(screen.getByText("Budi")).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })

  test("nobody assigned reads Unassigned", () => {
    render(<ReportFieldsText report={{ status: "open", priority: "none", assignee: null }} />)
    expect(screen.getByText("Unassigned")).toBeTruthy()
  })
})

describe("a guest's discussion", () => {
  const props = {
    threads: [{ ...commentFixture(), replies: [] }],
    activity: null,
    people: [],
    me: { id: "g1", role: "guest" as const, name: "Guest" },
    busy: false,
    showActivity: false,
    onShowActivity: mock(),
    onAdd: mock(async () => {}),
    onEdit: mock(async () => {}),
    onDelete: mock(),
    onReact: mock(),
  }

  test("comments, and no way to show activity lines", () => {
    render(<CommentsSection {...props} activityAvailable={false} />)
    expect(screen.getByRole("textbox", { name: "New comment" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "All activity" })).toBeNull()
  })

  test("members keep the switch", () => {
    render(<CommentsSection {...props} me={{ ...props.me, role: "member" }} />)
    expect(screen.getByRole("button", { name: "All activity" })).toBeTruthy()
  })
})

test("the composer offers guests of the project, marked Guest", () => {
  const people = [
    { id: "u1", name: "Ana", email: "ana@kantor.test" },
    { id: "g1", name: "Gita", guest: true },
  ]
  render(
    <CommentsSection
      threads={[]}
      activity={null}
      people={people}
      me={{ id: "u3", role: "member", name: "Citra" }}
      busy={false}
      showActivity={false}
      onShowActivity={mock()}
      onAdd={mock(async () => {})}
      onEdit={mock(async () => {})}
      onDelete={mock()}
      onReact={mock()}
    />,
  )
  fireEvent.change(screen.getByRole("textbox", { name: "New comment" }), { target: { value: "cek @gi" } })
  const list = screen.getByRole("listbox", { name: "Mention someone" })
  expect(list.textContent).toContain("Gita")
  expect(list.textContent).toContain("Guest")
})

const guestProjects = [{ id: "p1", name: "Storefront", slug: "storefront", workspaceId: "w1", urlPatterns: [] as string[], logoUrl: null, createdAt: new Date(), guestCount: 0 }]

test("a guest's project filter has no No project, which they never see a report of", () => {
  render(<ReportFilters search={{}} members={[]} showPeople={false} projects={guestProjects} onChange={mock()} />)
  fireEvent.click(screen.getByRole("button", { name: /Project/ }))
  expect(screen.getByRole("menuitemradio", { name: "Storefront" })).toBeTruthy()
  expect(screen.queryByRole("menuitemradio", { name: "No project" }) !== null).toBe(false)
})

test("on a phone, a guest's project filter has no No project either", () => {
  render(<FiltersSheetContent search={{}} members={[]} showPeople={false} projects={guestProjects} onChange={mock()} onDone={mock()} />)
  expect(screen.getByText("Storefront")).toBeTruthy()
  expect(screen.queryByText("No project") !== null).toBe(false)
})

test("a guest's list has no assignee or reporter filter", () => {
  render(<ReportFilters search={{}} members={[]} showPeople={false} onChange={mock()} />)
  expect(screen.queryByRole("button", { name: "Reporter" })).toBeNull()
  fireEvent.click(screen.getByRole("button", { name: "More filters" }))
  expect(screen.queryByText("Who is assigned to fix the report")).toBeNull()
})
