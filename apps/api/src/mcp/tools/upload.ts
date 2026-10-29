import { MAX_THUMBNAIL_BYTES, matchProject, PRIORITIES } from "@bugberry/shared"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { findProjectByRef, listProjectPatterns } from "../../modules/projects/repository"
import { createRateLimiter } from "../../lib/rate-limit"
import { agentUploadLink, issueAgentUpload } from "../../modules/reports/agent-uploads"
import { createReportUpload } from "../../modules/reports/upload-flow"
import { UPLOAD_SESSIONS_PER_MINUTE } from "../../modules/reports/uploads"
import { agentLabel, type McpContext, McpToolError, RATE_LIMITED, requireWrite, runTool } from "../context"
import { workspaceFor } from "../refs"
import { textResult } from "../format"

/** Shared by every request, like the dashboard's upload sessions: one agent can't flood a workspace. */
const limiter = createRateLimiter({ limit: UPLOAD_SESSIONS_PER_MINUTE, windowMs: 60_000 })

/** Exactly what the recorder's stopRecording returns as `recording`. */
const recordingArg = z
  .object({
    mediaSize: z.number().int().min(1),
    debuggerSize: z.number().int().min(1),
    thumbnailSize: z.number().int().min(1).max(MAX_THUMBNAIL_BYTES).optional(),
    durationMs: z.number().int().min(0).max(3_600_000),
    pageUrl: z.string().min(1).max(2048),
    pageTitle: z.string().max(500),
    device: z.object({ browser: z.string().max(100), os: z.string().max(100), viewport: z.string().max(50) }),
    debuggerSummary: z.object({
      logs: z.number().int().min(0),
      errors: z.number().int().min(0),
      requests: z.number().int().min(0),
      failedRequests: z.number().int().min(0),
      actions: z.number().int().min(0),
      incomplete: z.array(z.string().max(50)).max(20),
    }),
  })
  .describe("The `recording` object from the recorder's stopRecording, unchanged.")

export function registerUploadTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "createUpload",
    {
      title: "File a recording as a report",
      description:
        "After stopRecording on the BugBerry recorder: creates the report with your title and description, and gives " +
        "an upload link. Pass that link to the recorder's submitRecording to send the video and logs.",
      inputSchema: {
        title: z.string().min(1).max(200).describe("What is broken, in a few words."),
        description: z.string().max(5000).describe("What you did, what happened, and what you expected."),
        project: z.string().min(1).max(200).optional().describe("Project id or slug; left out, the page URL picks it."),
        workspace: z.string().max(200).optional().describe("Workspace id or slug; left out, your current workspace."),
        priority: z
          .enum(PRIORITIES)
          .optional()
          .describe(
            "How bad it is: critical when the flow can't be finished, high for errors and failed requests, medium for " +
              "broken UI, low for typos, unclear text, slowness. Left out, none.",
          ),
        recording: recordingArg,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        requireWrite(ctx)
        const user = ctx.caller.user
        if (!limiter.consume(user.id)) throw new McpToolError("rate_limited", RATE_LIMITED)
        const { db, config } = ctx.deps
        const workspaceId = await workspaceFor(ctx, args.workspace)
        let projectId: string | null
        if (args.project) {
          projectId = await findProjectByRef(db, workspaceId, args.project)
          if (!projectId) throw new McpToolError("project_not_found", "Project not found in this workspace")
        } else {
          const projects = await listProjectPatterns(db, workspaceId)
          projectId = matchProject(projects, args.recording.pageUrl)?.id ?? null
        }

        const { recording } = args
        const created = await createReportUpload(
          ctx.deps,
          user,
          {
            workspaceId,
            projectId,
            title: args.title,
            description: args.description,
            priority: args.priority,
            captureType: "video",
            multipart: true,
            mediaSize: recording.mediaSize,
            debuggerSize: recording.debuggerSize,
            thumbnailSize: recording.thumbnailSize,
            durationMs: recording.durationMs,
            pageUrl: recording.pageUrl,
            pageTitle: recording.pageTitle,
            device: recording.device,
            debuggerSummary: recording.debuggerSummary,
          },
          { viaAgent: agentLabel(ctx.caller) },
        )
        const { token, expiresAt } = await issueAgentUpload(db, created.reportId, user.id)
        const uploadLink = agentUploadLink(config.appUrl, token)
        return textResult(
          `Created BB-${created.number} (${created.reportUrl}). Now call submitRecording on the recorder with uploadLink: ${uploadLink}`,
          { reportId: created.reportId, number: created.number, reportUrl: created.reportUrl, uploadLink, expiresAt: expiresAt.toISOString() },
        )
      }),
  )
}
