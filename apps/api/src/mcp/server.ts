import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import packageJson from "../../package.json"
import type { McpContext } from "./context"

const INSTRUCTIONS =
  "BugBerry holds bug reports recorded in the browser: a screenshot or video plus console logs, network requests, " +
  "user actions and performance data. Start with getReport (it accepts a report link or a number like BB-123), " +
  "then follow its next steps. getCodeHotspots names the files and lines in the page's code that failed."

/** A fresh MCP server for one request, with every tool bound to that request's caller. */
export function createMcpServer(_ctx: McpContext): McpServer {
  const server = new McpServer({ name: "bugberry", version: packageJson.version }, { instructions: INSTRUCTIONS })
  return server
}
