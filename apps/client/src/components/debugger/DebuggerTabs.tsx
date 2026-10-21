import { RiArrowRightSLine, RiTerminalBoxLine } from "@remixicon/react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Tab, TabList, TabPanel, Tabs } from "@bugberry/ui/tabs"
import type { ReportDetail } from "../../lib/api"
import { type DebuggerView, eventBase } from "@bugberry/debugger-view"
import type { Playback } from "../../lib/timeline"
import { EventRowsSkeleton } from "../Skeletons"
import { ActionsTab } from "./ActionsTab"
import { ConsoleTab } from "./ConsoleTab"
import { InfoTab } from "./InfoTab"
import { NetworkTab } from "./NetworkTab"
import { FOLLOW_SCROLL_ATTRIBUTE } from "./useVirtualRows"

export type DebuggerState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; view: DebuggerView }

export type TabId = "actions" | "console" | "network" | "info"

/** Below 1280 px a tab shows this many rows' worth at first; "View all" opens the rest. */
const PREVIEW_ROWS = 4

/** Something outside the panel asks it to show a tab, or one request's detail; a new nonce asks again. */
export interface DebuggerFocus {
  tab: "console" | "actions" | "network"
  rowKey?: string
  nonce: number
}

function CountBadge({ count }: { count: number }) {
  if (count === 0) return null
  return <span className="ml-1.5 rounded-full bg-danger-subtle px-1.5 text-[11px] font-medium text-danger-subtle-foreground">{count}</span>
}

export function DebuggerTabs({
  report,
  state,
  onRetry,
  playback = null,
  focus = null,
}: {
  report: ReportDetail
  state: DebuggerState
  onRetry: () => void
  playback?: Playback | null
  focus?: DebuggerFocus | null
}) {
  const summary = report.debuggerSummary
  const [tab, setTab] = useState<TabId>(summary.errors > 0 ? "console" : "actions")
  // Below 1280 px the panel sits in the page: a short preview until "View all" (wider, it fills its column).
  const [expanded, setExpanded] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  // A request opened from outside opens once; coming back to the Network tab later shows the table.
  const openedNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!focus) return
    setTab(focus.tab)
    setExpanded(true)
    // On narrow screens the panel sits below the report; bring it into view.
    panel.current?.scrollIntoView?.({ block: "nearest" })
  }, [focus?.nonce])
  const tabs: Array<{ id: TabId; label: string; badge: ReactNode }> = [
    { id: "info", label: "Info", badge: null },
    { id: "actions", label: "Actions", badge: null },
    { id: "console", label: "Console", badge: <CountBadge count={summary.errors} /> },
    { id: "network", label: "Network", badge: <CountBadge count={summary.failedRequests} /> },
  ]
  const totals: Record<TabId, { count: number; noun: string } | null> = {
    info: null,
    actions: { count: summary.actions, noun: "actions" },
    console: { count: summary.logs, noun: "console messages" },
    network: { count: summary.requests, noun: "requests" },
  }
  const total = totals[tab]

  return (
    <div ref={panel} className="flex min-w-0 flex-col bg-background xl:h-full">
      <h2 className="flex items-center gap-2 pb-3 font-heading text-xl font-bold text-foreground xl:px-4 xl:pt-3 xl:pb-2 xl:text-sm xl:font-semibold">
        <span aria-hidden className="hidden size-5 place-items-center rounded-md bg-primary-subtle text-primary xl:grid">
          <RiTerminalBoxLine className="size-3.5" />
        </span>
        {/* In the page it is what the extension captured; beside the report, the familiar DevTools. */}
        <span className="xl:hidden">Captured data</span>
        <span className="hidden xl:inline">DevTools</span>
      </h2>
      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => setTab(key as TabId)}
        className="min-w-0 gap-0 self-stretch xl:min-h-0 xl:flex-1"
      >
        <TabList
          aria-label="Debugger data"
          className="xl:px-4 max-xl:rounded-xl max-xl:border-0 max-xl:bg-muted max-xl:p-1 max-xl:**:data-[slot=selected-indicator]:hidden"
        >
          {tabs.map(({ id, label, badge }) => (
            <Tab
              key={id}
              id={id}
              className="max-xl:flex-1 max-xl:justify-center max-xl:first:ms-0 max-xl:last:me-0 max-xl:selected:bg-background max-xl:selected:text-foreground max-xl:selected:shadow-sm max-xl:selected:hover:bg-background max-xl:selected:hover:text-foreground"
            >
              {label}
              {badge}
            </Tab>
          ))}
        </TabList>
        {tabs.map(({ id }) => (
          <TabPanel
            key={id}
            id={id}
            {...{ [FOLLOW_SCROLL_ATTRIBUTE]: "" }}
            // Network's preview is taller: its filters take the top of it.
            className={`${expanded ? "max-h-[70vh]" : id === "network" ? "max-h-96" : "max-h-80"} max-xl:mt-3 max-xl:rounded-xl max-xl:border max-xl:border-border xl:max-h-none xl:min-h-0 xl:flex-1 ${id === "network" ? "flex flex-col overflow-hidden" : "overflow-y-auto"}`}
          >
            {id === "info" ? (
              <InfoTab report={report} view={state.status === "ready" ? state.view : null} playback={playback} />
            ) : (
              <EventsPanel
                tab={id}
                state={state}
                onRetry={onRetry}
                playback={playback}
                durationMs={report.durationMs}
                openRequest={
                  focus?.tab === "network" && focus.rowKey && openedNonce.current !== focus.nonce
                    ? { key: focus.rowKey, nonce: focus.nonce }
                    : null
                }
                onOpenedRequest={(nonce) => {
                  openedNonce.current = nonce
                }}
              />
            )}
          </TabPanel>
        ))}
      </Tabs>
      {state.status === "ready" && total && total.count > PREVIEW_ROWS && (
        <Button
          intent="plain"
          size="sm"
          onPress={() => setExpanded((value) => !value)}
          className="mt-1 justify-between self-stretch text-primary xl:hidden"
        >
          {expanded ? "Show less" : `View all ${total.count} ${total.noun}`}
          <RiArrowRightSLine aria-hidden className={expanded ? "-rotate-90" : undefined} />
        </Button>
      )}
    </div>
  )
}

function EventsPanel({
  tab,
  state,
  onRetry,
  playback,
  durationMs,
  openRequest,
  onOpenedRequest,
}: {
  tab: Exclude<TabId, "info">
  state: DebuggerState
  onRetry: () => void
  playback: Playback | null
  durationMs: number | null
  openRequest: { key: string; nonce: number } | null
  onOpenedRequest(nonce: number): void
}) {
  if (state.status === "none") {
    return <p className="p-4 text-sm text-muted-foreground">This report has no console, network or action data.</p>
  }
  if (state.status === "loading") return <EventRowsSkeleton />
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-2 p-4 text-sm">
        <p className="text-danger-subtle-foreground">Couldn't load the debugger data.</p>
        <Button size="sm" intent="outline" onPress={onRetry}>
          Try again
        </Button>
      </div>
    )
  }
  const base = eventBase(state.view)
  if (tab === "actions") return <ActionsTab events={state.view.events} base={base} playback={playback} />
  if (tab === "console") {
    const startedAt = state.view.recordingStartedAt
    const recording = startedAt === null ? undefined : { startedAt, durationMs }
    return <ConsoleTab events={state.view.events} base={base} playback={playback} recording={recording} />
  }
  return <NetworkTab events={state.view.events} base={base} playback={playback} openKey={openRequest} onOpened={onOpenedRequest} />
}
