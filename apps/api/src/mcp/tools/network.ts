import { curlFor, type DebuggerView, eventBase, isFailedRequest, MAX_TEXT, prettyBody, type ViewNetwork } from "@bugberry/debugger-view"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { type McpContext, McpToolError, runTool } from "../context"
import { requireDebuggerView } from "../debugger"
import { clip, moreLine, offsetLabel, paginate, textResult } from "../format"
import { resolveReportRef } from "../refs"
import { pageArgs, reportArgs } from "./args"
import { requestLine } from "./events"

const STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx", "error"] as const
type StatusClass = (typeof STATUS_CLASSES)[number]

/** Every request in the report, numbered #1… in time order; the number is what getNetworkRequest takes. */
export function numberedRequests(view: DebuggerView): Array<{ n: number; request: ViewNetwork }> {
  return view.events
    .filter((event): event is ViewNetwork => event.kind === "network")
    .map((request, index) => ({ n: index + 1, request }))
}

function statusClass(request: ViewNetwork): StatusClass | null {
  if (request.failed !== null) return "error"
  if (request.status === null) return null
  const hundreds = Math.floor(request.status / 100)
  return hundreds >= 2 && hundreds <= 5 ? (`${hundreds}xx` as StatusClass) : null
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ""
  }
}

const headerLines = (title: string, headers: Array<[string, string]>, max: number) =>
  headers.length === 0 ? [] : [`${title}:`, ...headers.map(([name, value]) => `  ${name}: ${clip(value, max)}`)]

/** Lists keep bodies as recorded (compact); the single-request view pretty-prints JSON. */
const bodyLine = (title: string, body: string | null, max: number, pretty = false) =>
  body === null ? [] : [`${title}: ${clip(pretty ? prettyBody(body) : body, max)}`]

export function registerNetworkTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "getNetworkRequests",
    {
      title: "Get network requests",
      description:
        "The page's fetch, XHR and WebSocket requests with status, duration and the code that started them (initiator file:line). " +
        "Bodies are included for failed requests by default. Use the #number with getNetworkRequest for full details.",
      inputSchema: {
        ...reportArgs,
        failedOnly: z.boolean().optional().describe("Only failed requests (network errors and 4xx/5xx)."),
        status: z.array(z.enum(STATUS_CLASSES)).optional().describe('Only these status classes; "error" means no response.'),
        method: z.string().max(20).optional().describe("Only this HTTP method."),
        host: z.string().max(253).optional().describe("Only requests to this host."),
        urlContains: z.string().max(500).optional().describe("Only URLs containing this text."),
        minDurationMs: z.number().min(0).optional().describe("Only requests that took at least this long."),
        includeBodies: z.enum(["failed", "all", "none"]).optional().describe('Which requests show headers and bodies (default "failed").'),
        ...pageArgs,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const view = await requireDebuggerView(ctx, await resolveReportRef(ctx, args.report, args.workspace))
        const base = eventBase(view) ?? view.events[0]?.t ?? 0
        const method = args.method?.toUpperCase()
        const host = args.host?.toLowerCase()
        const urlPart = args.urlContains?.toLowerCase()
        const matches = numberedRequests(view).filter(({ request }) => {
          const klass = statusClass(request)
          return (
            (!args.failedOnly || isFailedRequest(request)) &&
            (!args.status || (klass !== null && args.status.includes(klass))) &&
            (!method || request.method.toUpperCase() === method) &&
            (!host || hostOf(request.url) === host) &&
            (!urlPart || request.url.toLowerCase().includes(urlPart)) &&
            (args.minDurationMs === undefined || (request.durationMs ?? 0) >= args.minDurationMs)
          )
        })
        const page = paginate(matches, args.limit, args.cursor)
        if (page.items.length === 0) return textResult("No requests match.")
        const bodies = args.includeBodies ?? "failed"
        const blocks = page.items.map(({ n, request }) => {
          const head = `#${n} ${offsetLabel(request.t - base)} ${requestLine(request)}`
          const detailed = bodies === "all" || (bodies === "failed" && isFailedRequest(request))
          if (!detailed) return head
          return [
            head,
            ...headerLines("Request headers", request.requestHeaders, 300).map((line) => `  ${line}`),
            ...bodyLine("Request body", request.requestBody, 2000).map((line) => `  ${line}`),
            ...headerLines("Response headers", request.responseHeaders, 300).map((line) => `  ${line}`),
            ...bodyLine("Response body", request.responseBody, 2000).map((line) => `  ${line}`),
          ].join("\n")
        })
        return textResult([...blocks, ...moreLine(page)].join("\n"))
      }),
  )

  server.registerTool(
    "getNetworkRequest",
    {
      title: "Get one network request",
      description: "Everything about one request by its #number from getNetworkRequests: headers, full bodies, timing, initiator and a curl command.",
      inputSchema: { ...reportArgs, index: z.number().int().min(1).describe("The request's #number from getNetworkRequests.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const view = await requireDebuggerView(ctx, await resolveReportRef(ctx, args.report, args.workspace))
        const found = numberedRequests(view).find(({ n }) => n === args.index)
        if (!found) throw new McpToolError("request_not_found", `No request #${args.index} in this report`)
        const { request } = found
        const base = eventBase(view) ?? view.events[0]?.t ?? 0
        const timing = view.events.find(
          (event) => event.kind === "resource" && event.url === request.url && Math.abs(event.t - request.t) < 5000 && event.timing,
        )
        const lines = [
          `#${found.n} ${request.method} ${request.url}`,
          `Time: ${offsetLabel(request.t - base)}`,
          `Result: ${request.pending ? "still pending when the report was taken" : request.failed ? `failed: ${request.failed}` : `HTTP ${request.status ?? "?"}`}`,
          ...(request.durationMs !== null ? [`Duration: ${Math.round(request.durationMs)} ms`] : []),
          ...(request.initiator ? [`Initiator: ${request.initiator}`] : []),
          ...(timing?.kind === "resource" && timing.timing
            ? [
                `Timing: queue ${timing.timing.queueMs} ms, dns ${timing.timing.dnsMs} ms, connect ${timing.timing.connectMs} ms, ` +
                  `tls ${timing.timing.tlsMs} ms, waiting ${timing.timing.ttfbMs} ms, download ${timing.timing.downloadMs} ms`,
              ]
            : []),
          "",
          ...headerLines("Request headers", request.requestHeaders, MAX_TEXT),
          ...bodyLine("Request body", request.requestBody, MAX_TEXT, true),
          "",
          ...headerLines("Response headers", request.responseHeaders, MAX_TEXT),
          ...bodyLine("Response body", request.responseBody, MAX_TEXT, true),
          "",
          `Replay: ${curlFor(request)}`,
        ]
        return textResult(lines.join("\n"))
      }),
  )
}
