import { RiCloseLine, RiFileCopyLine, RiPlayFill } from "@remixicon/react"
import { Fragment, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Tab, TabList, Tabs } from "@bugberry/ui/tabs"
import { Tooltip, TooltipTrigger } from "@bugberry/ui/tooltip"
import type { ViewNetwork, ViewTiming } from "@bugberry/debugger-view"
import { formatDuration, formatOffset } from "../../lib/format"
import { curlFor, type NetworkRow, prettyBody, requestPath, requestState, sizeLabel, statusLabel } from "@bugberry/debugger-view"
import type { Playback } from "../../lib/timeline"
import { toast } from "../../lib/toast"

type Section = "headers" | "payload" | "response" | "timing"

const SECTIONS: Array<[Section, string]> = [
  ["headers", "Headers"],
  ["payload", "Payload"],
  ["response", "Response"],
  ["timing", "Timing"],
]

const TIMING_LABELS: Array<[keyof ViewTiming, string]> = [
  ["queueMs", "Queueing"],
  ["dnsMs", "DNS"],
  ["connectMs", "Connection"],
  ["tlsMs", "TLS"],
  ["ttfbMs", "Waiting for server (TTFB)"],
  ["downloadMs", "Download"],
]

function headerValue(headers: ReadonlyArray<[string, string]>, name: string): string | null {
  return headers.find(([key]) => key.toLowerCase() === name)?.[1] ?? null
}

/** What "Copy as cURL" needs, also for a file the page loaded without our fetch/XHR record. */
function asRequest(row: NetworkRow): ViewNetwork {
  return (
    row.request ?? {
      kind: "network",
      t: row.t,
      method: row.method,
      url: row.url,
      status: row.status,
      durationMs: row.durationMs,
      requestHeaders: [],
      responseHeaders: [],
      requestBody: null,
      responseBody: null,
      failed: null,
      pending: false,
      initiator: null,
    }
  )
}

/**
 * One row of the Network tab, Chrome DevTools style: headers, payload, response and timing, with copy and jump.
 * The address and the section tabs stay at the top while the rest scrolls under them.
 */
export function RequestDetail({
  row,
  base,
  playback,
  onClose,
}: {
  row: NetworkRow
  base: number | null
  playback: Playback | null
  onClose(): void
}) {
  const request = row.request
  const state = request ? requestState(request) : "ok"
  const timing = row.resource?.timing ?? null
  const sections = SECTIONS.filter(([id]) => id !== "timing" || timing)
  const [section, setSection] = useState<Section>(state === "failed" ? "response" : "headers")
  const offset = base === null ? null : row.t - base
  const contentType = request ? headerValue(request.responseHeaders, "content-type")?.split(";")[0] : null
  // Facts without data are left out rather than shown as a dash.
  const facts: Array<[string, string]> = [
    ["Time", row.durationMs === null ? "" : formatDuration(row.durationMs)],
    ["Size", sizeLabel(row)],
    ["Type", contentType ?? row.type],
    ["At", offset === null ? "" : formatOffset(offset)],
    ["DOMContentLoaded", row.page?.domContentLoadedMs == null ? "" : `${row.page.domContentLoadedMs} ms`],
    ["Load", row.page?.loadMs == null ? "" : `${row.page.loadMs} ms`],
  ]
  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curlFor(asRequest(row)))
      toast({ title: "Copied as cURL" })
    } catch {
      toast({ title: "Couldn't copy", tone: "error" })
    }
  }

  return (
    <div className="flex flex-col text-xs">
      <div className="sticky top-0 z-10 bg-(--detail-bg,var(--color-background))">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {/* Phones wrap the address (the detail has a sheet to itself there); beside the table it stays on one line. */}
          <p className="min-w-0 flex-1 font-mono font-medium break-words text-foreground md:truncate">
            {row.method} {requestPath(row.url)}
          </p>
          {request && (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 font-mono ${state === "failed" ? "bg-danger-subtle text-danger-subtle-foreground" : state === "canceled" ? "bg-warning-subtle text-warning-subtle-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {statusLabel(request.status)}
            </span>
          )}
          <Button intent="plain" size="sq-xs" aria-label="Close request" onPress={onClose}>
            <RiCloseLine aria-hidden />
          </Button>
        </div>
        <Tabs selectedKey={section} onSelectionChange={(key) => setSection(key as Section)} className="gap-0 self-stretch">
          {/*
            The first tab is pulled left by its own padding so its label lines up with the text below; a smaller
            padding keeps its hover and selected box clear of the panel's left edge, as the DevTools tabs above are.
          */}
          <TabList aria-label="Request" className="px-3">
            {sections.map(([id, label]) => (
              <Tab key={id} id={id} className="text-xs/6 [--tab-gutter-x:--spacing(1.5)]">
                {label}
              </Tab>
            ))}
          </TabList>
        </Tabs>
      </div>
      <dl className="grid grid-cols-3 gap-2 border-b border-border px-3 py-2">
        {facts
          .filter(([, value]) => value !== "")
          .map(([label, value]) => (
            <Fact key={label} label={label} value={value} />
          ))}
      </dl>
      <div className="flex flex-col gap-3 px-3 py-3">
        {request?.failed && <p className="text-danger-subtle-foreground">Network error: {request.failed}</p>}
        {section === "headers" && (
          <>
            <p className="break-all font-mono text-muted-foreground">{row.url}</p>
            {request?.initiator && <p className="text-muted-foreground">Initiator: {request.initiator}</p>}
            {request && <HeaderList title="Request headers" headers={request.requestHeaders} />}
            {request && <HeaderList title="Response headers" headers={request.responseHeaders} />}
          </>
        )}
        {section === "payload" && (
          <Code
            label="payload"
            text={request?.requestBody ?? null}
            empty={request ? "This request sent no body." : "BugBerry records bodies for fetch and XHR requests only."}
          />
        )}
        {section === "response" && (
          <>
            <Code
              label="response"
              text={request?.responseBody ?? null}
              empty={request ? "No response body was recorded." : "BugBerry records bodies for fetch and XHR requests only."}
            />
            {request && <HeaderList title="Response headers" headers={request.responseHeaders} />}
          </>
        )}
        {section === "timing" && timing && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            {TIMING_LABELS.map(([key, label]) => (
              <Fragment key={key}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono text-foreground">{timing[key]} ms</dd>
              </Fragment>
            ))}
          </dl>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border px-3 py-2">
        <Button size="sm" intent="outline" onPress={() => void copyCurl()}>
          <RiFileCopyLine aria-hidden className="size-4" />
          Copy as cURL
        </Button>
        {playback && offset !== null && (
          <Button size="sm" intent="outline" onPress={() => playback.seek(offset)}>
            <RiPlayFill aria-hidden className="size-4" />
            Jump to {formatOffset(offset)}
          </Button>
        )}
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-foreground">{value}</dd>
    </div>
  )
}

function HeaderList({ title, headers }: { title: string; headers: ReadonlyArray<[string, string]> }) {
  if (headers.length === 0) return null
  return (
    <div>
      <p className="font-semibold text-foreground">{title}</p>
      <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 font-mono">
        {headers.map(([name, value], index) => (
          <Fragment key={`${name}-${index}`}>
            <dt className="text-muted-foreground">{name}</dt>
            <dd className="break-all text-foreground">{value}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  )
}

/** A body with line numbers, JSON pretty-printed, and a Copy button for what is shown. */
function Code({ label, text, empty }: { label: "payload" | "response"; text: string | null; empty: string }) {
  if (text === null || text === "") return <p className="text-muted-foreground">{empty}</p>
  const shown = prettyBody(text)
  const lines = shown.split("\n")
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown)
      toast({ title: label === "payload" ? "Payload copied" : "Response copied" })
    } catch {
      toast({ title: "Couldn't copy", tone: "error" })
    }
  }
  return (
    // The button sits outside the scrolling box, so it stays in the corner however far the body is scrolled.
    // The box is never shorter than the button, so a one-line body like `[]` still holds it.
    <div className="relative">
      <pre className="max-h-80 min-h-11 overflow-auto rounded-md border border-border bg-muted/50 py-2 pr-9 font-mono">
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity besides their position
          <div key={index} className="flex">
            <span aria-hidden className="w-8 shrink-0 pr-2 text-right text-muted-foreground select-none">
              {index + 1}
            </span>
            <span className="whitespace-pre-wrap break-all pr-2 text-foreground">{line}</span>
          </div>
        ))}
      </pre>
      <TooltipTrigger delay={300}>
        <Button
          intent="outline"
          size="sq-xs"
          aria-label={`Copy ${label}`}
          onPress={() => void copy()}
          className="absolute top-1.5 right-1.5 bg-background shadow-xs"
        >
          <RiFileCopyLine aria-hidden />
        </Button>
        <Tooltip inverse placement="left">{`Copy ${label}`}</Tooltip>
      </TooltipTrigger>
    </div>
  )
}
