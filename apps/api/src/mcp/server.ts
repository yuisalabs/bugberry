import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import packageJson from "../../package.json"
import type { McpContext } from "./context"
import { registerPrompts } from "./prompts"
import { registerBrowseTools } from "./tools/browse"
import { registerEventTools } from "./tools/events"
import { registerInsightTools } from "./tools/insights"
import { registerNetworkTools } from "./tools/network"
import { registerRecordingTools } from "./tools/recording"
import { registerReportReadTools } from "./tools/report-read"
import { registerTrackerTools } from "./tools/trackers"
import { registerUploadTools } from "./tools/upload"
import { registerWriteTools } from "./tools/write"

const INSTRUCTIONS =
  "BugBerry holds bug reports recorded in the browser: a screenshot or video plus console logs, network requests, " +
  "user actions and performance data. Start with getReport (it accepts a report link or a number like BB-123), " +
  "then follow its next steps. getCodeHotspots names the files and lines in the page's code that failed. " +
  "For a video report, getRecording gives the video and the moments worth a frame, to cut with ffmpeg and look at. " +
  "To file a recording made with the BugBerry recorder (@bugberry/recorder), call createUpload after its stopRecording."

/** A fresh MCP server for one request, with every tool bound to that request's caller. */
export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({ name: "bugberry", version: packageJson.version }, { instructions: INSTRUCTIONS })
  registerReportReadTools(server, ctx)
  registerRecordingTools(server, ctx)
  registerEventTools(server, ctx)
  registerNetworkTools(server, ctx)
  registerInsightTools(server, ctx)
  registerBrowseTools(server, ctx)
  registerWriteTools(server, ctx)
  registerTrackerTools(server, ctx)
  registerUploadTools(server, ctx)
  registerPrompts(server)
  return server
}
