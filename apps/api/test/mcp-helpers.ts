import type { DebuggerPayload } from "@bugberry/capture"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { CurrentUser } from "../src/plugins/auth"
import type { McpCaller, McpContext } from "../src/mcp/context"
import { createDebuggerCache } from "../src/mcp/debugger"
import { createRateLimiter } from "../src/lib/rate-limit"
import { createDispatcher } from "../src/lib/trackers/dispatch"
import { createTrackerFactory } from "../src/lib/trackers/providers"
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
    dispatcher: createDispatcher({ ...ctx, trackers: createTrackerFactory() }),
    ...rest,
    caller: { user, scopes: new Set(["bugberry:read", "bugberry:write"]), via: { kind: "token" }, ...caller },
  } as McpContext
}

/** A client wired straight to createMcpServer, for callers the HTTP route can't make yet (read-only scopes). */
export async function directClient(mcpCtx: McpContext): Promise<Client> {
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js")
  const { createMcpServer } = await import("../src/mcp/server")
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createMcpServer(mcpCtx).connect(serverSide)
  const client = new Client({ name: "bugberry-test", version: "1.0.0" })
  await client.connect(clientSide)
  return client
}

const b64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes as ArrayBuffer).toString("base64url")

export interface OAuthGrant {
  clientId: string
  accessToken: string
  refreshToken: string | null
}

/**
 * Runs the whole OAuth flow in-process the way an AI app does: dynamic registration, authorize with
 * PKCE as the signed-in person, consent, then the code exchange.
 */
export async function grantOAuth(
  ctx: TestCtx,
  userId: string,
  opts: { scopes?: string[]; clientName?: string } = {},
): Promise<OAuthGrant> {
  const base = ctx.config.appUrl
  const redirectUri = "http://localhost:9999/cb"
  const call = (path: string, init: RequestInit = {}) => ctx.app.handle(new Request(`${base}${path}`, init))
  const register = await call("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: opts.clientName ?? "Claude Code", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }),
  })
  const { client_id: clientId } = (await register.json()) as { client_id: string }

  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  const { sessionHeaders } = await import("./helpers")
  const cookie = await sessionHeaders(ctx, userId)
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: (opts.scopes ?? ["openid", "offline_access", "bugberry:read", "bugberry:write"]).join(" "),
    state: "state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${base}/api/mcp`,
  })
  const authorize = await call(`/api/auth/oauth2/authorize?${params}`, { headers: cookie, redirect: "manual" })
  const consentUrl = new URL(authorize.headers.get("location") ?? "", base)
  if (consentUrl.pathname !== "/oauth/consent") throw new Error(`authorize went to ${consentUrl}`)
  const consent = await call("/api/auth/oauth2/consent", {
    method: "POST",
    headers: { ...cookie, "content-type": "application/json", origin: base },
    body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
  })
  const { url } = (await consent.json()) as { url: string }
  const code = new URL(url).searchParams.get("code") ?? ""
  const token = await call("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource: `${base}/api/mcp`,
    }),
  })
  const tokens = (await token.json()) as { access_token: string; refresh_token?: string }
  return { clientId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? null }
}

/** Trades a refresh token for new tokens; the HTTP status says whether the grant still stands. */
export function refreshOAuth(ctx: TestCtx, grant: OAuthGrant): Promise<Response> {
  return ctx.app.handle(
    new Request(`${ctx.config.appUrl}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: grant.refreshToken ?? "",
        client_id: grant.clientId,
        resource: `${ctx.config.appUrl}/api/mcp`,
      }),
    }),
  )
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
