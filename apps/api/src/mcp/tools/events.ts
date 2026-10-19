import type { ConsoleLevel } from "@bugberry/capture"
import {
  ACTION_TYPES,
  actionSentence,
  CONSOLE_LEVELS,
  consoleEntries,
  type DebuggerView,
  eventBase,
  isFailedRequest,
  isMaskedValue,
  type ViewAction,
  type ViewNetwork,
} from "@bugberry/debugger-view"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { type McpContext, runTool } from "../context"
import { requireDebuggerView } from "../debugger"
import { clip, moreLine, offsetLabel, paginate, textResult } from "../format"
import { resolveReportRef } from "../refs"
import { pageArgs, reportArgs } from "./args"

const SLOW_REQUEST_MS = 1000
const TIMELINE_KINDS = ["action", "navigation", "console", "error", "network", "note", "pause"] as const
type TimelineKind = (typeof TIMELINE_KINDS)[number]

interface TimelineEntry {
  t: number
  kind: TimelineKind
  text: string
}

/** "Typed into input#email (hidden value)": the dashboard's sentence, without the dots that stand for a hidden value. */
export function actionText(action: ViewAction): string {
  if (action.type === "input" && isMaskedValue(action.value)) return `Typed into ${action.target ?? "a field"} (hidden value)`
  const sentence = actionSentence(action)
  return sentence.frustration ? `${sentence.text} (rage click)` : sentence.text
}

/** "POST https://shop.test/api/orders → 500 (300 ms) initiator checkout.js:88". */
export function requestLine(request: ViewNetwork): string {
  const outcome = request.pending ? "pending" : request.failed ? `failed: ${request.failed}` : String(request.status ?? "?")
  const duration = request.durationMs !== null ? ` (${Math.round(request.durationMs)} ms)` : ""
  const initiator = request.initiator ? ` initiator ${request.initiator}` : ""
  return `${request.method} ${clip(request.url, 300)} → ${outcome}${duration}${initiator}`
}

/** Everything that happened, in time order, as one list of entries. */
export function timelineEntries(view: DebuggerView, includeAll: boolean): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  for (const event of view.events) {
    switch (event.kind) {
      case "action":
        entries.push({ t: event.t, kind: event.type === "navigate" ? "navigation" : "action", text: actionText(event) })
        break
      case "page": {
        const timing = [
          event.domContentLoadedMs !== null ? `DOMContentLoaded ${Math.round(event.domContentLoadedMs)} ms` : null,
          event.loadMs !== null ? `load ${Math.round(event.loadMs)} ms` : null,
        ].filter(Boolean)
        const how = event.via === "load" ? "Page load" : event.via === "reload" ? "Page reload" : "Back/forward to"
        entries.push({ t: event.t, kind: "navigation", text: `${how} ${event.url}${timing.length ? ` (${timing.join(", ")})` : ""}` })
        break
      }
      case "console":
        if (includeAll || event.level === "warn" || event.level === "error") {
          entries.push({ t: event.t, kind: "console", text: `[${event.level}] ${clip(event.text, 500)}${event.source ? ` (${event.source})` : ""}` })
        }
        break
      case "error":
        entries.push({ t: event.t, kind: "error", text: `${clip(event.message, 500)}${event.source ? ` (${event.source})` : ""}` })
        break
      case "network":
        if (includeAll || isFailedRequest(event) || (event.durationMs ?? 0) >= SLOW_REQUEST_MS) {
          entries.push({ t: event.t, kind: "network", text: requestLine(event) })
        }
        break
    }
  }
  const base = eventBase(view)
  if (base !== null) {
    for (const note of view.notes) entries.push({ t: base + note.atMs, kind: "note", text: `Note ${note.n}: ${note.text} (${note.author})` })
    for (const pause of view.pauses) {
      entries.push({ t: base + pause.atMs, kind: "pause", text: `Recording paused for ${(pause.ms / 1000).toFixed(1)}s` })
    }
  }
  return entries.sort((a, b) => a.t - b.t)
}

const offsetOf = (view: DebuggerView) => {
  const base = eventBase(view) ?? view.events[0]?.t ?? 0
  return (t: number) => offsetLabel(t - base)
}

export function registerEventTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "getTimeline",
    {
      title: "Get the report timeline",
      description:
        "What happened, in order: user actions, page loads and navigations, console warnings and errors, uncaught errors, " +
        "failed or slow requests (1 s or more), the reporter's notes and recording pauses. The best way to see cause and effect.",
      inputSchema: {
        ...reportArgs,
        kinds: z.array(z.enum(TIMELINE_KINDS)).optional().describe("Only these kinds of entries."),
        fromSec: z.number().optional().describe("Only entries at or after this many seconds into the recording."),
        toSec: z.number().optional().describe("Only entries at or before this many seconds into the recording."),
        includeAll: z.boolean().optional().describe("Also include every console level and every request, not only problems."),
        ...pageArgs,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const view = await requireDebuggerView(ctx, await resolveReportRef(ctx, args.report, args.workspace))
        const base = eventBase(view) ?? view.events[0]?.t ?? 0
        const offset = offsetOf(view)
        const entries = timelineEntries(view, args.includeAll ?? false).filter(
          (entry) =>
            (!args.kinds || args.kinds.includes(entry.kind)) &&
            (args.fromSec === undefined || entry.t - base >= args.fromSec * 1000) &&
            (args.toSec === undefined || entry.t - base <= args.toSec * 1000),
        )
        const page = paginate(entries, args.limit, args.cursor)
        if (page.items.length === 0) return textResult("Nothing in the timeline matches.")
        const text = [
          ...page.items.map((entry) => `${offset(entry.t)}  ${entry.kind.toUpperCase().padEnd(10)}  ${entry.text}`),
          ...moreLine(page),
        ].join("\n")
        return textResult(text, {
          entries: page.items.map((entry) => ({ atMs: entry.t - base, kind: entry.kind, text: entry.text })),
          nextCursor: page.nextCursor,
        })
      }),
  )

  server.registerTool(
    "getConsoleLogs",
    {
      title: "Get console logs",
      description:
        "Console messages and uncaught errors with their level, time, source file:line and stack trace. Filter by level or text.",
      inputSchema: {
        ...reportArgs,
        levels: z.array(z.enum(CONSOLE_LEVELS as unknown as [ConsoleLevel, ...ConsoleLevel[]])).optional().describe("Only these levels."),
        search: z.string().max(200).optional().describe("Only messages containing this text (case-insensitive)."),
        ...pageArgs,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const view = await requireDebuggerView(ctx, await resolveReportRef(ctx, args.report, args.workspace))
        const offset = offsetOf(view)
        const search = args.search?.trim().toLowerCase()
        const entries = consoleEntries(view.events).filter(
          (entry) =>
            (!args.levels || args.levels.includes(entry.level)) &&
            (!search || entry.text.toLowerCase().includes(search) || (entry.stack ?? "").toLowerCase().includes(search)),
        )
        const page = paginate(entries, args.limit, args.cursor)
        if (page.items.length === 0) return textResult("No console messages match.")
        const text = [
          ...page.items.map((entry) => {
            const head = `${offset(entry.t)} [${entry.level}] ${clip(entry.text)}${entry.source ? ` (${entry.source})` : ""}`
            const stack = entry.stack && entry.stack !== entry.text ? `\n    ${clip(entry.stack).replaceAll("\n", "\n    ")}` : ""
            return head + stack
          }),
          ...moreLine(page),
        ].join("\n")
        return textResult(text)
      }),
  )

  server.registerTool(
    "getUserActions",
    {
      title: "Get user actions",
      description: "What the person did, in plain sentences: clicks, typing (hidden values stay hidden), submits, navigations, scrolls, rage clicks.",
      inputSchema: {
        ...reportArgs,
        types: z.array(z.enum(ACTION_TYPES)).optional().describe("Only these action types."),
        ...pageArgs,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const view = await requireDebuggerView(ctx, await resolveReportRef(ctx, args.report, args.workspace))
        const offset = offsetOf(view)
        const actions = view.events.filter(
          (event): event is ViewAction => event.kind === "action" && (!args.types || args.types.includes(event.type as never)),
        )
        const page = paginate(actions, args.limit, args.cursor)
        if (page.items.length === 0) return textResult("No user actions match.")
        return textResult([...page.items.map((action) => `${offset(action.t)} ${actionText(action)}`), ...moreLine(page)].join("\n"))
      }),
  )
}
