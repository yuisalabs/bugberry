import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReportDetail } from "../lib/api"
import { clampDevtoolsWidth, type DevtoolsLayout, devtoolsColumn, readDevtools, saveDevtools } from "../lib/devtools-layout"
import { PRIORITY_LABELS, PRIORITY_STYLES } from "../lib/labels"
import { flaggedIssues } from "@bugberry/debugger-view"
import type { SentIssue } from "../lib/report-page"
import { type Playback, seekSeconds } from "../lib/timeline"
import { timelineMarkers } from "../lib/timeline-markers"
import { DebuggerPanel, useDebuggerView } from "./debugger/DebuggerPanel"
import { DevtoolsResizer, DevtoolsToggle } from "./DevtoolsLayout"
import type { DebuggerFocus } from "./debugger/DebuggerTabs"
import { MediaViewer } from "./MediaViewer"
import { FlaggedIssues } from "./report/FlaggedIssues"
import { ReportMeta } from "./report/ReportMeta"
import { Badge } from "./ui"
import { VideoReporter, VideoShareActions } from "./VideoOverlay"

/**
 * The report page and the share page: the recording and what it is about on the left, DevTools on
 * the right from 1280 px up (stacked below on smaller screens). There the panel can be hidden, and its
 * left edge dragged to make it wider or narrower; this browser remembers both.
 */
export function ReportView({
  report,
  header,
  fields,
  title,
  issues = [],
  refreshReport,
  startAtSeconds,
  children,
}: {
  report: ReportDetail
  header: ReactNode
  /** Status, priority and assignee; the share page has none. */
  fields?: ReactNode
  title: ReactNode
  issues?: SentIssue[]
  refreshReport: () => Promise<ReportDetail | undefined>
  /** Where the video starts, from a shared "at 0:03" link. */
  startAtSeconds?: number
  /** Below the report: the comments. */
  children?: ReactNode
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // The pages pass a new function on every render; the media and the panel get one that stays the same.
  const latestRefresh = useRef(refreshReport)
  latestRefresh.current = refreshReport
  const refresh = useCallback(() => latestRefresh.current(), [])
  const debuggerView = useDebuggerView(report, refresh)
  const markers = useMemo(() => (debuggerView.data ? timelineMarkers(debuggerView.data) : []), [debuggerView.data])
  const [currentMs, setCurrentMs] = useState<number | null>(null)
  const [focus, setFocus] = useState<DebuggerFocus | null>(null)
  const [devtools, setDevtools] = useState<DevtoolsLayout>(readDevtools)
  const aside = useRef<HTMLElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const changeDevtools = (next: DevtoolsLayout) => {
    setDevtools(next)
    saveDevtools(next)
  }
  const flagged = useMemo(() => {
    if (!debuggerView.data) return []
    const video =
      report.captureType === "video"
        ? { startedAt: debuggerView.data.recordingStartedAt, durationMs: report.durationMs }
        : null
    return flaggedIssues(debuggerView.data, video)
  }, [debuggerView.data, report.captureType, report.durationMs])
  const seek = useCallback(
    (offsetMs: number) => {
      const video = videoRef.current
      if (video) video.currentTime = seekSeconds(offsetMs, report.durationMs)
    },
    [report.durationMs],
  )
  // Only a new position makes a new value, so the panel re-renders for the video and nothing else.
  const playback: Playback | null = useMemo(
    () => (report.captureType === "video" ? { currentMs, seek } : null),
    [report.captureType, currentMs, seek],
  )
  const onExpired = useCallback(() => void latestRefresh.current(), [])
  const reporter = useMemo(() => <VideoReporter reporter={report.reporter} />, [report.reporter])
  const shareActions = useCallback(
    (seconds: number) => <VideoShareActions shareSlug={report.shareSlug} seconds={seconds} mediaUrl={report.mediaUrl} />,
    [report.shareSlug, report.mediaUrl],
  )

  useEffect(() => {
    const previous = document.title
    document.title = `BB-${report.number} · ${report.title} · BugBerry`
    return () => {
      document.title = previous
    }
  }, [report.number, report.title])

  // A width chosen on a wider window never crowds the report out on a narrower one.
  const columns = { "--devtools-width": devtoolsColumn(devtools.width) } as CSSProperties

  return (
    <div
      ref={grid}
      style={columns}
      className={`min-h-screen ${devtools.open ? "xl:grid xl:grid-cols-[minmax(0,1fr)_max(360px,var(--devtools-width))]" : ""}`}
    >
      <article className="flex min-w-0 flex-col gap-5 px-4 py-4 sm:px-6">
        <header className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{header}</div>
          <span className="hidden xl:block">
            <DevtoolsToggle open={devtools.open} onToggle={(open) => changeDevtools({ ...devtools, open })} />
          </span>
        </header>
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
          {fields}
          <MediaViewer
            report={report}
            onExpired={onExpired}
            videoRef={videoRef}
            onTime={setCurrentMs}
            markers={markers}
            startAtSeconds={startAtSeconds}
            topLeft={reporter}
            topRight={shareActions}
          />
          <section className="flex flex-col gap-2">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">{title}</div>
              {report.priority !== "none" && (
                <Badge className={`mt-1.5 shrink-0 ${PRIORITY_STYLES[report.priority]}`}>{PRIORITY_LABELS[report.priority]}</Badge>
              )}
            </div>
            {report.description && (
              <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{report.description}</p>
            )}
            <ReportMeta report={report} issues={issues} />
          </section>
          <FlaggedIssues
            issues={flagged}
            onJump={(offsetMs) => playback?.seek(offsetMs)}
            onOpen={(target) => setFocus({ ...target, nonce: Date.now() })}
          />
          {children}
        </div>
      </article>
      <aside
        ref={aside}
        aria-label="DevTools"
        className={`relative min-w-0 border-t border-border xl:sticky xl:top-0 xl:h-screen xl:border-t-0 xl:border-l ${devtools.open ? "" : "xl:hidden"}`}
      >
        <DevtoolsResizer
          width={devtools.width}
          measure={() => aside.current?.offsetWidth ?? 600}
          // While dragging only the column moves; React and storage hear about it once, on release.
          onDrag={(width) =>
            grid.current?.style.setProperty("--devtools-width", devtoolsColumn(clampDevtoolsWidth(width, window.innerWidth)))
          }
          onResize={(width) => changeDevtools({ ...devtools, width: clampDevtoolsWidth(width, window.innerWidth) })}
          onReset={() => changeDevtools({ ...devtools, width: null })}
        />
        <div className="h-full min-w-0 xl:overflow-hidden">
          <DebuggerPanel report={report} refreshReport={refresh} playback={playback} focus={focus} />
        </div>
      </aside>
    </div>
  )
}
