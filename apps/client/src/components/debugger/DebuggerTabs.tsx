import {
  RiArrowRightSLine,
  RiCursorLine,
  RiGlobalLine,
  RiInformationLine,
  RiTerminalBoxLine,
  type RemixiconComponentType,
} from "@remixicon/react"
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
  // Always opens on Overview; a flagged issue (focus) still jumps straight to its tab.
  const [tab, setTab] = useState<TabId>("info")
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
  const tabs: Array<{ id: TabId; label: string; icon: RemixiconComponentType; badge: ReactNode }> = [
    { id: "info", label: "Overview", icon: RiInformationLine, badge: null },
    { id: "actions", label: "Activity", icon: RiCursorLine, badge: null },
    { id: "console", label: "Console", icon: RiTerminalBoxLine, badge: <CountBadge count={summary.errors} /> },
    { id: "network", label: "Network", icon: RiGlobalLine, badge: <CountBadge count={summary.failedRequests} /> },
  ]
  const totals: Record<TabId, { count: number; noun: string } | null> = {
    info: null,
    actions: { count: summary.actions, noun: "actions" },
    console: { count: summary.logs, noun: "console messages" },
    network: { count: summary.requests, noun: "requests" },
  }
  const total = totals[tab]

  return (
    <div ref={panel} className="@container flex min-w-0 flex-col bg-background pt-3 xl:h-full">
      {/* The report sidebar's DevTools tab already names the panel; the heading stays for screen readers. */}
      <h2 className="sr-only">DevTools</h2>
      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => setTab(key as TabId)}
        className="min-w-0 gap-0 self-stretch xl:min-h-0 xl:flex-1"
      >
        <TabList
          aria-label="Debugger data"
          // The same underlined row on every screen: the panel always sits inside the report sidebar's card now.
          className="px-4"
        >
          {tabs.map(({ id, label, icon: Icon, badge }) => (
            <Tab
              key={id}
              id={id}
              // Each tab takes an equal share, so the row fills the sidebar's width. In a narrow sidebar the icons give
              // way and the tabs sit closer, so all four names still fit.
              className="min-w-0 flex-1 justify-center whitespace-nowrap @max-[30rem]:mx-0 @max-[30rem]:px-1.5 @max-[30rem]:*:[svg]:hidden"
            >
              <Icon aria-hidden className="size-4 shrink-0" />
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
            className={`${expanded ? "max-h-[70vh]" : id === "network" ? "max-h-96" : "max-h-80"} xl:max-h-none xl:min-h-0 xl:flex-1 ${id === "network" ? "flex flex-col overflow-hidden" : "overflow-y-auto"}`}
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
