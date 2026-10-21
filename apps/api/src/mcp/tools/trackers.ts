import { integrationLabel } from "@bugberry/shared"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { asc, eq } from "drizzle-orm"
import { z } from "zod"
import { integration } from "../../db/schema"
import { agentLabel, type McpContext, McpToolError, requireWrite, runTool } from "../context"
import { textResult } from "../format"
import { requireMemberAccess, resolveReportRef } from "../refs"
import { reportArgs } from "./args"

export const NO_PROJECT_TRACKERS =
  "This report has no project, so no trackers are set up. Move it to a project with updateReport first."

export function registerTrackerTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "listTrackers",
    {
      title: "List issue trackers",
      description: "The GitHub or ActiveCollab integrations of the report's project, and the issues this report was already sent to.",
      inputSchema: reportArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const resolved = await resolveReportRef(ctx, args.report, args.workspace)
        requireMemberAccess(resolved)
        if (!resolved.row.projectId) return textResult(NO_PROJECT_TRACKERS)
        const rows = await ctx.deps.db
          .select()
          .from(integration)
          .where(eq(integration.projectId, resolved.row.projectId))
          .orderBy(asc(integration.createdAt))
        if (rows.length === 0) return textResult("The report's project has no trackers set up.")
        const links = new Map((await ctx.dispatcher.linksFor(resolved.id)).map((link) => [link.integrationId, link]))
        const lines = rows.map((row) => {
          const link = links.get(row.id)
          const state = link?.externalUrl ? `sent: ${link.externalUrl}` : link?.error ? `failed: ${link.error}` : link ? "sending" : "Not sent yet"
          return `${row.id} · ${row.provider} · ${integrationLabel(row.provider, row.config)}${row.autoSend ? " · auto-send" : ""} · ${state}`
        })
        return textResult(lines.join("\n"))
      }),
  )

  server.registerTool(
    "sendToTracker",
    {
      title: "Send a report to a tracker",
      description: "Create an issue for the report in one of its project's trackers (id from listTrackers). Sending twice returns the same issue.",
      inputSchema: { ...reportArgs, integrationId: z.string().min(1).max(100) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        requireWrite(ctx)
        const resolved = await resolveReportRef(ctx, args.report, args.workspace)
        requireMemberAccess(resolved)
        if (!resolved.row.projectId) throw new McpToolError("report_has_no_project", NO_PROJECT_TRACKERS)
        const link = await ctx.dispatcher.send(resolved.id, args.integrationId, {
          actorId: ctx.caller.user.id,
          viaAgent: agentLabel(ctx.caller),
        })
        if (!link.externalUrl) throw new McpToolError("tracker_failed", `The tracker refused the issue: ${link.error ?? "unknown error"}`)
        return textResult(`Issue: ${link.externalUrl}`, { url: link.externalUrl })
      }),
  )
}
