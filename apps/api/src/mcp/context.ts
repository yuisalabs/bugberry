import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { AppDeps } from "../app"
import type { CurrentUser } from "../auth/plugin"
import { AppError } from "../lib/errors"
import type { RateLimiter } from "../lib/rate-limit"
import type { DebuggerCache } from "./debugger"

export type McpScope = "bugberry:read" | "bugberry:write"

/** Who is calling the MCP server, what they may do, and through which app. */
export interface McpCaller {
  user: CurrentUser
  scopes: ReadonlySet<McpScope>
  via: { kind: "token" } | { kind: "oauth"; clientId: string; clientName: string }
}

/** Everything a tool needs: the app's dependencies and the caller of this one request. */
export interface McpContext {
  deps: AppDeps
  caller: McpCaller
  /** Shared by every request of this app. */
  cache: DebuggerCache
  /** Images are heavier than text: a smaller allowance, shared by every request. */
  screenshotLimiter: RateLimiter
}

export const RATE_LIMITED = "Too many requests, try again in a minute"

/** A problem the agent should read as the tool's answer, not a crash. */
export class McpToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "McpToolError"
  }
}

export const READ_ONLY_MESSAGE = "This connection can only read. Reconnect BugBerry and allow changes to use this tool."

/** The name stored on comments an agent writes: the OAuth app's name, or "AI agent" for a personal token. */
export function agentLabel(caller: McpCaller): string {
  return caller.via.kind === "oauth" ? caller.via.clientName : "AI agent"
}

export function requireWrite(ctx: McpContext): void {
  if (!ctx.caller.scopes.has("bugberry:write")) throw new McpToolError("insufficient_scope", READ_ONLY_MESSAGE)
}

/** Runs a tool body; our own errors become an `isError` answer the agent can read. */
export async function runTool(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn()
  } catch (error) {
    // Missing debugger data is an answer, not a failure: the report simply has none.
    if (error instanceof McpToolError && error.code === "no_debugger") {
      return { content: [{ type: "text", text: error.message }] }
    }
    if (error instanceof McpToolError || error instanceof AppError) {
      return { isError: true, content: [{ type: "text", text: error.message }] }
    }
    throw error
  }
}
