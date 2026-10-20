import { useQuery } from "@tanstack/react-query"
import { memo, useRef } from "react"
import type { ReportDetail } from "../../lib/api"
import { loadDebuggerWithRefresh } from "../../lib/debugger"
import type { Playback } from "../../lib/timeline"
import { type DebuggerFocus, type DebuggerState, DebuggerTabs } from "./DebuggerTabs"

/**
 * Downloads debugger.json.gz once per report. The query key leaves out the signed URL (it changes on
 * every detail refetch); the latest URL is read from a ref instead.
 */
export function useDebuggerView(report: ReportDetail, refreshReport: () => Promise<ReportDetail | undefined>) {
  const urlRef = useRef(report.debuggerUrl)
  urlRef.current = report.debuggerUrl

  const query = useQuery({
    queryKey: ["debugger", report.id],
    queryFn: () =>
      loadDebuggerWithRefresh(urlRef.current ?? "", async () => (await refreshReport())?.debuggerUrl ?? null),
    enabled: report.debuggerUrl !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  return query
}

/**
 * The event tabs beside the media. The report page and the video timeline share one download. Memoized: it
 * re-renders for a new video position or new data, not for the rest of the report page.
 */
export const DebuggerPanel = memo(function DebuggerPanel({
  report,
  refreshReport,
  playback = null,
  focus = null,
}: {
  report: ReportDetail
  refreshReport: () => Promise<ReportDetail | undefined>
  playback?: Playback | null
  focus?: DebuggerFocus | null
}) {
  const query = useDebuggerView(report, refreshReport)
  const state: DebuggerState =
    report.debuggerUrl === null
      ? { status: "none" }
      : query.isPending
        ? { status: "loading" }
        : query.isError
          ? { status: "error" }
          : { status: "ready", view: query.data }

  return <DebuggerTabs report={report} state={state} onRetry={() => void query.refetch()} playback={playback} focus={focus} />
})
