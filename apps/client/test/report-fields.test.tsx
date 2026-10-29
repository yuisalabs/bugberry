import { describe, expect, mock, test } from "bun:test"
import { render, screen } from "@testing-library/react"
import { ReportFields } from "../src/features/reports/detail/ReportFields"
import { choose } from "./fields"
import type { Member } from "../src/features/workspaces/queries"

const budi = { id: "u2", name: "Budi", image: null }
const members: Member[] = [
  { id: "u1", name: "Ana", email: "ana@kantor.test", image: null, role: "admin", owner: false, joinedAt: new Date("2026-09-12T00:00:00Z") },
  { id: "u2", name: "Budi", email: "budi@kantor.test", image: null, role: "member", owner: false, joinedAt: new Date("2026-09-12T00:00:00Z") },
]
const report = (assignee: typeof budi | null) => ({ status: "open" as const, priority: "high" as const, assignee })
const select = (name: string) => screen.getByLabelText(name) as HTMLButtonElement

describe("ReportFields", () => {
  test("status and priority save as soon as they change", () => {
    const onChange = mock()
    render(<ReportFields report={report(null)} members={members} onChange={onChange} />)
    choose("Status", "Resolved")
    expect(onChange).toHaveBeenLastCalledWith({ status: "resolved" })
    choose("Priority", "Low")
    expect(onChange).toHaveBeenLastCalledWith({ priority: "low" })
  })

  test("while members load the assignee shows and cannot be changed", () => {
    render(<ReportFields report={report(budi)} members={undefined} onChange={() => {}} />)
    expect(select("Assignee").disabled).toBe(true)
    expect(select("Assignee").textContent).toContain("Budi")
  })

  test("choosing a member or nobody reports the choice", () => {
    const onChange = mock()
    render(<ReportFields report={report(budi)} members={members} onChange={onChange} />)
    choose("Assignee", "Ana")
    expect(onChange).toHaveBeenLastCalledWith({ assigneeId: "u1" })
    choose("Assignee", "Unassigned")
    expect(onChange).toHaveBeenLastCalledWith({ assigneeId: null })
  })

  test("an assignee who left the workspace is still shown", () => {
    const gone = { id: "u9", name: "Cici", image: null }
    render(<ReportFields report={report(gone)} members={members} onChange={() => {}} />)
    expect(select("Assignee").textContent).toContain("Cici")
  })
})
