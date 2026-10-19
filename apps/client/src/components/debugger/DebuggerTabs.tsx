import { RiTerminalBoxLine } from "@remixicon/react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Tab, TabList, TabPanel, Tabs } from "@bugberry/ui/tabs"
import type { ReportDetail } from "../../lib/api"
import { type DebuggerView, eventBase } from "../../lib/debugger-events"
import type { Playback } from "../../lib/timeline"
import { Loading } from "../ui"
import { ActionsTab } from "./ActionsTab"
import { ConsoleTab } from "./ConsoleTab"
import { InfoTab } from "./InfoTab"
import { NetworkTab } from "./NetworkTab"
import { FOLLOW_SCROLL_ATTRIBUTE } from "./useFollow"

export type DebuggerState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; view: DebuggerView }

export type TabId = "actions" | "console" | "network" | "info"

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
  const panel = useRef<HTMLDivElement>(null)
  // A request opened from outside opens once; coming back to the Network tab later shows the table.
  const openedNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!focus) return
    setTab(focus.tab)
    // On narrow screens the panel sits below the report; bring it into view.
    panel.current?.scrollIntoView?.({ block: "nearest" })
  }, [focus?.nonce])
  const tabs: Array<{ id: TabId; label: string; badge: ReactNode }> = [
    { id: "info", label: "Info", badge: null },
    { id: "actions", label: "Actions", badge: null },
    { id: "console", label: "Console", badge: <CountBadge count={summary.errors} /> },
    { id: "network", label: "Network", badge: <CountBadge count={summary.failedRequests} /> },
  ]

  return (
    <div ref={panel} className="flex min-w-0 flex-col bg-background xl:h-full">
      <h2 className="flex items-center gap-2 px-4 pt-3 pb-2 font-heading text-sm font-semibold text-foreground">
        <span aria-hidden className="grid size-5 place-items-center rounded-md bg-primary-subtle text-primary">
          <RiTerminalBoxLine className="size-3.5" />
        </span>
        DevTools
      </h2>
      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => setTab(key as TabId)}
        className="min-w-0 gap-0 self-stretch xl:min-h-0 xl:flex-1"
      >
        <TabList aria-label="Debugger data" className="px-4">
          {tabs.map(({ id, label, badge }) => (
            <Tab key={id} id={id}>
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
            className={`max-h-[70vh] xl:max-h-none xl:min-h-0 xl:flex-1 ${id === "network" ? "flex flex-col overflow-hidden" : "overflow-y-auto"}`}
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
  if (state.status === "loading") return <Loading label="Loading debugger data…" />
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
