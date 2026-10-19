import { describe, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { FlaggedIssues } from "../src/components/report/FlaggedIssues"
import { ReportView } from "../src/components/ReportView"
import type { FlaggedIssue } from "@bugberry/debugger-view"
import { reportFixture } from "./fixtures"

const issue = (index: number, overrides: Partial<FlaggedIssue> = {}): FlaggedIssue => ({
  key: `k${index}`,
  level: 2,
  text: `POST /api/orders/${index} → 500`,
  source: null,
  count: 1,
  time: { kind: "video", offsetMs: 52_000 },
  target: { tab: "network", rowKey: `n${index}` },
  ...overrides,
})

const box = (issues: FlaggedIssue[], onJump = mock(), onOpen = mock()) => {
  render(<FlaggedIssues issues={issues} onJump={onJump} onOpen={onOpen} />)
  return { onJump, onOpen }
}

describe("FlaggedIssues", () => {
  test("shows the top three and opens the rest", () => {
    box([1, 2, 3, 4, 5].map((index) => issue(index)))
    expect(screen.getByText("BugBerry flagged 5 issues")).toBeTruthy()
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }))
    expect(screen.getAllByRole("listitem")).toHaveLength(5)
    fireEvent.click(screen.getByRole("button", { name: "Show less" }))
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
  })

  test("Jump seeks the video and the sentence opens DevTools", () => {
    const { onJump, onOpen } = box([issue(1)])
    fireEvent.click(screen.getByRole("button", { name: "Jump to 0:52" }))
    expect(onJump).toHaveBeenCalledWith(52_000)
    fireEvent.click(screen.getByRole("button", { name: /POST \/api\/orders\/1/ }))
    expect(onOpen).toHaveBeenCalledWith({ tab: "network", rowKey: "n1" })
  })

  test("labels instead of Jump outside the video", () => {
    box([
      issue(1, { time: { kind: "before" } }),
      issue(2, { time: { kind: "after" } }),
      issue(3, { time: { kind: "none" } }),
    ])
    expect(screen.getByText("before recording")).toBeTruthy()
    expect(screen.getByText("after recording")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Jump to/ })).toBeNull()
  })

  test("one issue says issue, and an error shows where it came from", () => {
    box([issue(1, { level: 1, text: "Uncaught TypeError: x", source: "app.js:3", target: { tab: "console" } })])
    expect(screen.getByText("BugBerry flagged 1 issue")).toBeTruthy()
    expect(screen.getByText("app.js:3")).toBeTruthy()
  })

  test("hostile messages stay text", () => {
    box([issue(1, { text: "<img src=x onerror=alert(1)>" })])
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy()
    expect(document.querySelector("img")).toBeNull()
  })

  test("no data, no box", () => {
    const { container } = render(<FlaggedIssues issues={[]} onJump={mock()} onOpen={mock()} />)
    expect(container.innerHTML).toBe("")
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ReportView
          report={reportFixture({ debuggerUrl: null })}
          header={null}
          title={<h1>Title</h1>}
          refreshReport={async () => undefined}
        />
      </QueryClientProvider>,
    )
    expect(screen.queryByText(/BugBerry flagged/)).toBeNull()
  })
})
