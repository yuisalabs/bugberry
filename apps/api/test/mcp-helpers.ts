import type { DebuggerPayload } from "@bugberry/capture"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { CurrentUser } from "../src/auth/plugin"
import type { McpCaller, McpContext } from "../src/mcp/context"
import { createDebuggerCache } from "../src/mcp/debugger"
import { createRateLimiter } from "../src/lib/rate-limit"
import { debuggerKeyFor } from "../src/storage/keys"
import type { LocalStorageDriver } from "../src/storage/local"
import type { setupTestApp } from "./helpers"

type TestCtx = Awaited<ReturnType<typeof setupTestApp>>

/** Writes a gzipped debugger payload where a report with this id keeps it; returns the storage key. */
export async function putDebugger(ctx: TestCtx, reportId: string, payload: unknown): Promise<string> {
  const key = debuggerKeyFor(reportId)
  const json = typeof payload === "string" ? payload : JSON.stringify(payload)
  await (ctx.storage as LocalStorageDriver).writeObject(key, Bun.gzipSync(json))
  return key
}

/** An McpContext for calling tool helpers directly, as a personal-token caller with both scopes. */
export function testMcpContext(
  ctx: TestCtx,
  user: CurrentUser,
  overrides: Partial<Omit<McpContext, "caller">> & { caller?: Partial<McpCaller> } = {},
): McpContext {
  const { caller, ...rest } = overrides
  return {
    deps: ctx,
    cache: createDebuggerCache(),
    screenshotLimiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }),
    ...rest,
    caller: { user, scopes: new Set(["bugberry:read", "bugberry:write"]), via: { kind: "token" }, ...caller },
  } as McpContext
}

export const T0 = 1_000_000

/**
 * A 30-second checkout recording: the Pay click fails with a 500, two errors follow, the person
 * rage-clicks and leaves for the cart. Tasks 9–12 assert against it.
 */
export function samplePayload(): DebuggerPayload {
  const at = (ms: number) => T0 + ms
  return {
    version: 1,
    capturedAt: at(30_000),
    recordingStartedAt: T0,
    incomplete: [],
    environment: {
      browserVersion: "Chrome 141.0.1",
      osVersion: "Windows 11",
      language: "id-ID",
      timeZone: "Asia/Jakarta",
      pixelRatio: 2,
      connection: { effectiveType: "4g", downlinkMbps: 10, rttMs: 50 },
    },
    notes: [{ n: 1, atMs: 6000, text: "Clicked pay twice", author: "Ana" }],
    pauses: [{ atMs: 10_000, ms: 3000 }],
    events: [
      { kind: "page", t: at(0), url: "https://shop.test/checkout", via: "load", domContentLoadedMs: 800, loadMs: 1500, transferSize: 12_000 },
      {
        kind: "resource",
        t: at(100),
        url: "https://shop.test/js/app.js",
        initiatorType: "script",
        durationMs: 3000,
        transferSize: 900_000,
        decodedSize: 2_000_000,
        timing: { queueMs: 5, dnsMs: 20, connectMs: 30, tlsMs: 40, ttfbMs: 900, downloadMs: 2000 },
      },
      { kind: "network", t: at(1000), method: "GET", url: "https://shop.test/api/cart", status: 200, durationMs: 40 },
      { kind: "action", t: at(4000), type: "input", target: "input#email", value: "••••••" },
      { kind: "action", t: at(5000), type: "click", target: 'button "Pay now"' },
      {
        kind: "network",
        t: at(5200),
        method: "POST",
        url: "https://shop.test/api/orders",
        status: 500,
        durationMs: 300,
        requestHeaders: { "content-type": "application/json" },
        responseHeaders: { "content-type": "application/json" },
        requestBody: '{"items":[1]}',
        responseBody: '{"error":"stock"}',
        initiator: "checkout.js:88",
      },
      { kind: "console", t: at(5300), level: "error", args: ["Order failed"], source: "checkout.js:91" },
      {
        kind: "error",
        t: at(5400),
        message: "TypeError: x is undefined",
        stack: "TypeError: x is undefined\n    at pay (https://shop.test/js/checkout.js:120:4)",
        source: "https://shop.test/js/checkout.js:120:4",
      },
      { kind: "action", t: at(7000), type: "rage-click", target: 'button "Pay now"' },
      { kind: "action", t: at(20_000), type: "navigate", url: "https://shop.test/cart", via: "history" },
    ],
  }
}

type Handler = { handle(request: Request): Promise<Response> }

/** An MCP client talking to the app in-process, with the given auth headers. */
export async function mcpClient(app: Handler, headers: Record<string, string>): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
    fetch: (url, init) => app.handle(new Request(url, init)),
    requestInit: { headers },
  })
  const client = new Client({ name: "bugberry-test", version: "1.0.0" })
  await client.connect(transport)
  return client
}

export interface ToolOutcome {
  text: string
  structured: unknown
  isError: boolean
  images: Array<{ mimeType: string; data: string }>
}

/** Calls a tool and flattens its result for assertions. */
export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
  const result = await client.callTool({ name, arguments: args })
  const content = (result.content ?? []) as Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  return {
    text: content
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n"),
    structured: result.structuredContent,
    isError: result.isError === true,
    images: content
      .filter((item) => item.type === "image")
      .map((item) => ({ mimeType: item.mimeType ?? "", data: item.data ?? "" })),
  }
}
