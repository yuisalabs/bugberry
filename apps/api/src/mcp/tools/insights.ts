import {
  type DebuggerView,
  environmentRows,
  eventBase,
  flaggedIssues,
  formatBytes,
  isFailedRequest,
  shortSource,
  type ViewAction,
  type ViewNetwork,
  type ViewResource,
} from "@bugberry/debugger-view"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { type McpContext, runTool } from "../context"
import { requireDebuggerView } from "../debugger"
import { clip, offsetLabel, textResult } from "../format"
import { resolveReportRef } from "../refs"
import { noteAgentRead } from "../activity"
import { reportArgs } from "./args"
import { actionText, requestLine } from "./events"

const ERROR_AFTER_ACTION_MS = 2000
const FAILED_AFTER_SUBMIT_MS = 5000
const BACK_AND_FORTH_MS = 10_000
const TOP = 10
const HOTSPOT_EXAMPLES = 3

export interface Signal {
  kind: "rage-click" | "error-after-action" | "failed-after-submit" | "back-and-forth"
  /** Milliseconds from the start of the recording. */
  atMs: number
  text: string
  related: string[]
}

/** Moments the person was likely stuck or annoyed, each with what happened around it. */
export function frustrationSignals(view: DebuggerView): Signal[] {
  const base = eventBase(view) ?? view.events[0]?.t ?? 0
  const signals: Signal[] = []
  const actions = view.events.filter((event): event is ViewAction => event.kind === "action")
  const pressed = actions.filter((action) => action.type === "click" || action.type === "input" || action.type === "submit")
  const lastBefore = (t: number, windowMs: number, from: ViewAction[]) =>
    [...from].reverse().find((action) => action.t <= t && t - action.t <= windowMs)

  for (const event of view.events) {
    if (event.kind === "action" && event.type === "rage-click") {
      signals.push({ kind: "rage-click", atMs: event.t - base, text: actionText(event), related: [] })
    } else if (event.kind === "error" || (event.kind === "console" && event.level === "error")) {
      const action = lastBefore(event.t, ERROR_AFTER_ACTION_MS, pressed)
      if (!action) continue
      const message = event.kind === "error" ? event.message : event.text
      signals.push({
        kind: "error-after-action",
        atMs: event.t - base,
        text: `${clip(message, 300)} right after: ${actionText(action)}`,
        related: [`${offsetLabel(action.t - base)} ${actionText(action)}`],
      })
    } else if (event.kind === "network" && isFailedRequest(event)) {
      const action = lastBefore(
        event.t,
        FAILED_AFTER_SUBMIT_MS,
        actions.filter((item) => item.type === "submit" || item.type === "click"),
      )
      if (!action) continue
      signals.push({
        kind: "failed-after-submit",
        atMs: event.t - base,
        text: `${requestLine(event)} after: ${actionText(action)}`,
        related: [`${offsetLabel(action.t - base)} ${actionText(action)}`],
      })
    }
  }

  const visits: Array<{ url: string; t: number }> = []
  for (const action of actions) {
    if (action.type !== "navigate" || !action.url) continue
    const previous = visits.at(-2)
    if (previous && previous.url === action.url && action.t - previous.t <= BACK_AND_FORTH_MS) {
      signals.push({
        kind: "back-and-forth",
        atMs: action.t - base,
        text: `Went back to ${action.url} within ${Math.round((action.t - previous.t) / 1000)}s`,
        related: visits.slice(-2).map((visit) => `${offsetLabel(visit.t - base)} ${visit.url}`),
      })
    }
    visits.push({ url: action.url, t: action.t })
  }
  return signals.sort((a, b) => a.atMs - b.atMs)
}

export interface Hotspot {
  /** "checkout.js:120" */
  location: string
  count: number
  firstAtMs: number
  examples: string[]
  /** The script's full URL, when the source had one. */
  scriptUrl: string | null
}

const scriptUrlOf = (source: string) => {
  const match = source.match(/^(https?:\/\/[^\s]+?):\d+(?::\d+)?$/)
  return match?.[1] ?? null
}

/** Where in the page's code things went wrong: errors, warnings and failed requests grouped by file:line. */
export function codeHotspots(view: DebuggerView): Hotspot[] {
  const base = eventBase(view) ?? view.events[0]?.t ?? 0
  const spots = new Map<string, Hotspot>()
  const add = (source: string | null, t: number, example: string) => {
    const location = shortSource(source)
    if (!source || !location) return
    const spot = spots.get(location)
    if (spot) {
      spot.count += 1
      spot.firstAtMs = Math.min(spot.firstAtMs, t - base)
      if (spot.examples.length < HOTSPOT_EXAMPLES && !spot.examples.includes(example)) spot.examples.push(example)
      spot.scriptUrl ??= scriptUrlOf(source)
    } else {
      spots.set(location, { location, count: 1, firstAtMs: t - base, examples: [example], scriptUrl: scriptUrlOf(source) })
    }
  }
  for (const event of view.events) {
    if (event.kind === "error") add(event.source, event.t, clip(event.message, 200))
    else if (event.kind === "console" && (event.level === "error" || event.level === "warn")) add(event.source, event.t, clip(event.text, 200))
    else if (event.kind === "network" && isFailedRequest(event)) add(event.initiator, event.t, clip(requestLine(event), 200))
  }
  return [...spots.values()].sort((a, b) => b.count - a.count || a.firstAtMs - b.firstAtMs)
}

const ms = (value: number | null) => (value === null ? "?" : `${Math.round(value)} ms`)

function performanceText(view: DebuggerView, device: { browser: string; os: string; viewport: string }): string {
  const pages = view.events.filter((event) => event.kind === "page")
  const resources = view.events.filter((event): event is ViewResource => event.kind === "resource")
  const requests = view.events.filter((event): event is ViewNetwork => event.kind === "network" && event.durationMs !== null)
  const slowest = [...resources].filter((item) => item.durationMs !== null).sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
  const largest = [...resources].filter((item) => item.transferSize).sort((a, b) => (b.transferSize ?? 0) - (a.transferSize ?? 0))
  const cached = resources.filter((item) => item.cache !== null).length
  const breakdown = (item: ViewResource) =>
    item.timing
      ? ` (dns ${item.timing.dnsMs} ms, connect ${item.timing.connectMs} ms, tls ${item.timing.tlsMs} ms, waiting ${item.timing.ttfbMs} ms, download ${item.timing.downloadMs} ms)`
      : ""
  const connection = environmentRows(view, device).find((row) => row.label === "Network speed")
  return [
    "Page loads:",
    ...(pages.length
      ? pages.map(
          (page) =>
            `- ${page.url}: DOMContentLoaded ${ms(page.domContentLoadedMs)}, load ${ms(page.loadMs)}` +
            (page.transferSize ? `, ${formatBytes(page.transferSize)} transferred` : ""),
        )
      : ["- none recorded"]),
    "",
    "Slowest files:",
    ...(slowest.length ? slowest.slice(0, TOP).map((item) => `- ${ms(item.durationMs)} ${clip(item.url, 300)}${breakdown(item)}`) : ["- none recorded"]),
    "",
    "Largest transfers:",
    ...(largest.length
      ? largest.slice(0, TOP).map((item) => `- ${formatBytes(item.transferSize ?? 0)} ${clip(item.url, 300)}`)
      : ["- none recorded"]),
    "",
    `Served from cache: ${cached} of ${resources.length} files`,
    "",
    "Slowest API requests:",
    ...(requests.length
      ? [...requests]
          .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
          .slice(0, 5)
          .map((request) => `- ${requestLine(request)}`)
      : ["- none recorded"]),
    "",
    `Connection: ${connection?.value ?? "unknown"}`,
  ].join("\n")
}

export function registerInsightTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "getFrustrationSignals",
    {
      title: "Get frustration signals",
      description:
        "What BugBerry flagged (uncaught errors, 5xx, requests without an answer, rage clicks), then moments the person was " +
        "likely stuck: rage clicks, errors right after an action, failed requests right after a click or submit, going back and forth.",
      inputSchema: reportArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const resolved = await resolveReportRef(ctx, args.report, args.workspace)
        await noteAgentRead(ctx, resolved, "frustration")
        const view = await requireDebuggerView(ctx, resolved)
        const video = resolved.row.captureType === "video" ? { startedAt: view.recordingStartedAt, durationMs: resolved.row.durationMs } : null
        const flagged = flaggedIssues(view, video)
        const signals = frustrationSignals(view)
        const text = [
          "BugBerry flagged:",
          ...(flagged.length
            ? flagged.map(
                (issue) =>
                  `- ${issue.time.kind === "video" ? `${offsetLabel(issue.time.offsetMs)} ` : ""}${issue.text}${issue.source ? ` (${issue.source})` : ""}`,
              )
            : ["- nothing"]),
          "",
          "Signals:",
          ...(signals.length
            ? signals.map(
                (signal) =>
                  `- ${offsetLabel(signal.atMs)} ${signal.kind}: ${signal.text}` +
                  signal.related.map((line) => `\n    ${line}`).join(""),
              )
            : ["- none"]),
        ].join("\n")
        return textResult(text, { flagged: flagged.map((issue) => ({ text: issue.text, source: issue.source, count: issue.count })), signals })
      }),
  )

  server.registerTool(
    "getPerformance",
    {
      title: "Get performance data",
      description: "Page load times, the slowest and largest files with timing breakdowns, cache hits, the slowest API requests and the person's connection.",
      inputSchema: reportArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const resolved = await resolveReportRef(ctx, args.report, args.workspace)
        await noteAgentRead(ctx, resolved, "performance")
        const view = await requireDebuggerView(ctx, resolved)
        return textResult(performanceText(view, resolved.row.device))
      }),
  )

  server.registerTool(
    "getCodeHotspots",
    {
      title: "Get code hotspots",
      description:
        "The files and lines in the page's code where errors, warnings and failed requests came from, most frequent first, " +
        "with example messages. Search the codebase for these files to find the cause.",
      inputSchema: reportArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const resolved = await resolveReportRef(ctx, args.report, args.workspace)
        await noteAgentRead(ctx, resolved, "code")
        const hotspots = codeHotspots(await requireDebuggerView(ctx, resolved))
        if (hotspots.length === 0) return textResult("No errors, warnings or failed requests point at a file in the page's code.")
        const text = [
          "Search the codebase for these files (minified bundles may need source maps):",
          ...hotspots.map(
            (spot) =>
              `- ${spot.location} ×${spot.count}, first at ${offsetLabel(spot.firstAtMs)}${spot.scriptUrl ? `, script ${spot.scriptUrl}` : ""}` +
              spot.examples.map((example) => `\n    ${example}`).join(""),
          ),
        ].join("\n")
        return textResult(text, { hotspots })
      }),
  )
}
