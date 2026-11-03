import { describe, expect, mock, test } from "bun:test"
import type { DebuggerPayload } from "@bugberry/capture"
import { normalizePayload } from "@bugberry/debugger-view"
import type { ReplayPlayerProps } from "@bugberry/replay-player"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { useContext, useImperativeHandle } from "react"
import { ReportView } from "../src/features/reports/detail/ReportView"
import { ReportVideoContext } from "../src/features/reports/detail/video-context"
import { qk } from "../src/lib/query/keys"
import { reportFixture } from "./fixtures"

const T0 = 1_000_000
const payload: DebuggerPayload = {
  version: 1,
  capturedAt: T0 + 40_000,
  recordingStartedAt: T0,
  incomplete: [],
  events: [{ kind: "error", t: T0 + 3_000, message: "TypeError: x is undefined" }],
}

const seek = mock()
function StubReplayPlayer(props: ReplayPlayerProps) {
  useImperativeHandle(props.playerRef, () => ({ seek, play: () => {}, pause: () => {}, currentMs: () => 0 }))
  return <div data-testid="replay" />
}

/** Seeks through the context the way a comment's "0:35" does. */
function CommentTime() {
  const video = useContext(ReportVideoContext)
  return (
    <button type="button" onClick={() => video?.seek(35_000)}>
      Play from 0:35
    </button>
  )
}

function renderReplayReport() {
  const report = reportFixture({ captureType: "replay", durationMs: 40_000, mediaUrl: "https://files.test/m.gz", mediaType: "application/gzip" })
  const client = new QueryClient()
  client.setQueryData(qk.debugger(report.id), normalizePayload(payload))
  client.setQueryData(qk.replay(report.id), { events: [], frames: [], durationMs: 40_000 })
  render(
    <QueryClientProvider client={client}>
      <ReportView report={report} header={null} title={<h1>Title</h1>} refreshReport={async () => undefined} replayPlayer={StubReplayPlayer}>
        <CommentTime />
      </ReportView>
    </QueryClientProvider>,
  )
}

describe("ReportView with a replay", () => {
  test("a flagged issue and a console row seek the replay", async () => {
    seek.mockClear()
    renderReplayReport()
    await screen.findByTestId("replay")
    fireEvent.click(screen.getByRole("button", { name: "Jump to 0:03" }))
    expect(seek).toHaveBeenLastCalledWith(3_000)
    fireEvent.click(screen.getByRole("tab", { name: /Console/ }))
    fireEvent.click(screen.getByRole("button", { name: "Play video from 0:03" }))
    expect(seek).toHaveBeenCalledTimes(2)
    expect(seek).toHaveBeenLastCalledWith(3_000)
  })

  test("a time in a comment seeks the replay", async () => {
    seek.mockClear()
    renderReplayReport()
    await screen.findByTestId("replay")
    fireEvent.click(screen.getByRole("tab", { name: /Details/ }))
    fireEvent.click(screen.getByRole("button", { name: "Play from 0:35" }))
    expect(seek).toHaveBeenLastCalledWith(35_000)
  })
})
