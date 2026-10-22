import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RiFileListLine, RiHashtag, RiTerminalBoxLine } from "@remixicon/react"
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components"
import { Avatar } from "@bugberry/ui/avatar"
import type { ReportDetail } from "../lib/api"
import { clampDevtoolsWidth, type DevtoolsLayout, devtoolsColumn, readDevtools, saveDevtools } from "../lib/devtools-layout"
import { formatDateTime } from "../lib/format"
import { initialsOf } from "../lib/people"
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
import { playAt, ReportVideoContext } from "./report/video-context"
import { VideoReporter, VideoShareActions } from "./VideoOverlay"

export type SidebarTab = "details" | "devtools"

const tabStyle =
  "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground outline-hidden transition hover:text-foreground data-focus-visible:ring-2 data-focus-visible:ring-ring selected:bg-background selected:font-semibold selected:text-foreground selected:shadow-xs selected:[&_svg]:text-primary"

/** A row of the sidebar's Properties that only shows a value: Reporter, Project, Created. */
function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">{children}</span>
    </div>
  )
}

/**
 * The report page and the share page: the recording and what it is about on the left, and a sidebar on the right
 * from 1280 px up (below the report on smaller screens) with two tabs: Details (the properties and the comments) and
 * DevTools, which it opens on. The sidebar can be hidden, and its left edge dragged to make it wider or narrower;
 * this browser remembers both.
 */
export function ReportView({
  report,
  header,
  fields,
  title,
  issues = [],
  refreshReport,
  startAtSeconds,
  project = null,
  footer,
  children,
}: {
  report: ReportDetail
  header: ReactNode
  /** Status, priority and assignee, one per row; the share page has none. */
  fields?: ReactNode
  title: ReactNode
  issues?: SentIssue[]
  refreshReport: () => Promise<ReportDetail | undefined>
  /** Where the video starts, from a shared "at 0:03" link. */
  startAtSeconds?: number
  /** The report's project name, for the Properties. */
  project?: string | null
  /** The phone's bar pinned to the bottom (Copy link); from tablet width up it sits in the header instead. */
  footer?: ReactNode
  /** Under the Properties in the Details tab: the comments. */
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
  // The page always opens on DevTools; Details is a click away.
  const [tab, setTab] = useState<SidebarTab>("devtools")
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
  // A "0:52" in a comment seeks the video; only a video report with a known length offers it.
  const video = useMemo(
    () => {
      const durationMs = report.durationMs
      if (report.captureType !== "video" || durationMs === null) return null
      return { seek: (ms: number) => playAt(videoRef.current, ms, durationMs), durationMs }
    },
    [report.captureType, report.durationMs],
  )
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
    <div className={`flex min-h-screen flex-col bg-background ${footer ? "pb-24 md:pb-0" : ""}`}>
      <header className="flex items-center gap-2 px-4 py-3 sm:px-6 md:py-4">
        <div className="min-w-0 flex-1">{header}</div>
        <span className="hidden xl:block">
          <DevtoolsToggle open={devtools.open} onToggle={(open) => changeDevtools({ ...devtools, open })} />
        </span>
      </header>

      {/* The page sits on the same soft panel as the rest of the app. */}
      <div
        ref={grid}
        style={columns}
        className={`flex flex-1 flex-col gap-6 bg-sidebar px-4 py-5 sm:px-6 md:mx-6 md:rounded-t-[28px] md:border md:border-b-0 md:border-sidebar-border md:px-8 md:py-7 ${
          devtools.open ? "xl:grid xl:grid-cols-[minmax(0,1fr)_max(360px,var(--devtools-width))] xl:items-start" : ""
        }`}
      >
        <article className="flex min-w-0 flex-col gap-5">
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
          <section className="flex flex-col gap-3">
            <ReportMeta report={report} issues={issues} part="chips" />
            {/* The priority is in the sidebar's Properties, so the title stands alone. */}
            <div className="min-w-0">{title}</div>
            <ReportMeta report={report} issues={issues} part="byline" />
            {report.description && (
              <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{report.description}</p>
            )}
          </section>
          <FlaggedIssues
            issues={flagged}
            onJump={(offsetMs) => playback?.seek(offsetMs)}
            onOpen={(target) => {
              // The issue opens in DevTools, so the sidebar goes there first.
              setTab("devtools")
              setFocus({ ...target, nonce: Date.now() })
            }}
          />
        </article>

        <aside
          ref={aside}
          aria-label="Report sidebar"
          className={`relative flex min-w-0 flex-col overflow-hidden rounded-3xl border border-border bg-background xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)] ${
            devtools.open ? "" : "xl:hidden"
          }`}
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
          <Tabs
            selectedKey={tab}
            onSelectionChange={(key) => setTab(key === "devtools" ? "devtools" : "details")}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="p-3 pb-0">
              <TabList aria-label="Sidebar" className="flex gap-1 rounded-2xl bg-muted p-1">
                <Tab id="details" className={tabStyle}>
                  <RiFileListLine aria-hidden className="size-4" />
                  Details
                </Tab>
                <Tab id="devtools" className={tabStyle}>
                  <RiTerminalBoxLine aria-hidden className="size-4" />
                  DevTools
                </Tab>
              </TabList>
            </div>
            <TabPanel id="details" className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pt-5 pb-3 outline-hidden">
              <section aria-labelledby="report-properties" className="flex flex-col gap-2.5">
                {/* The same heading as Comments below it, so the sidebar reads as one list of parts. */}
                <h2 id="report-properties" className="font-heading text-base font-semibold text-foreground">
                  Properties
                </h2>
                {fields}
                <PropertyRow label="Reporter">
                  <Avatar
                    src={report.reporter.image}
                    initials={initialsOf(report.reporter.name)}
                    alt=""
                    size="xs"
                    className="shrink-0 bg-primary text-primary-foreground"
                  />
                  <span className="truncate">{report.reporter.name}</span>
                </PropertyRow>
                {project && (
                  <PropertyRow label="Project">
                    <RiHashtag aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{project}</span>
                  </PropertyRow>
                )}
                <PropertyRow label="Created">{formatDateTime(report.createdAt)}</PropertyRow>
              </section>
              {children && (
                <div className="flex flex-1 flex-col">
                  <ReportVideoContext.Provider value={video}>{children}</ReportVideoContext.Provider>
                </div>
              )}
            </TabPanel>
            <TabPanel id="devtools" className="min-h-0 flex-1 overflow-hidden outline-hidden">
              <DebuggerPanel report={report} refreshReport={refresh} playback={playback} focus={focus} />
            </TabPanel>
          </Tabs>
        </aside>
      </div>
      {footer && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background px-4 py-3 md:hidden">{footer}</div>
      )}
    </div>
  )
}
