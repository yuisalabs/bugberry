import { PRIORITIES, REPORT_STATUSES } from "@bugberry/shared"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { findProjectByRef } from "../../modules/projects/repository"
import { createCommentsService } from "../../modules/comments/service"
import { markAllNotificationsRead, markNotificationRead } from "../../modules/notifications/service"
import { updateReport, type UpdateReportInput } from "../../modules/reports/service"
import { agentLabel, type McpContext, McpToolError, requireWrite, runTool } from "../context"
import { reportUrl, textResult } from "../format"
import { requireMemberAccess, resolveReportRef } from "../refs"
import { reportArgs } from "./args"

const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }

export function registerWriteTools(server: McpServer, ctx: McpContext): void {
  const comments = createCommentsService(ctx.deps)
  const { appUrl } = ctx.deps.config

  server.registerTool(
    "addComment",
    {
      title: "Comment on a report",
      description:
        "Post a comment on a report as you; BugBerry shows it with a 'via AI' badge. Plain text or Markdown. " +
        "Pass replyTo (a comment id from getComments) to answer that comment in its thread. " +
        "To mention someone, write @[user:<id>] with an id from listMembers; they get a notification and an email.",
      inputSchema: {
        ...reportArgs,
        body: z.string().min(1).max(5000).describe("The comment."),
        replyTo: z.string().min(1).max(100).optional().describe("A comment id from getComments to reply to."),
      },
      annotations: writeAnnotations,
    },
    (args) =>
      runTool(async () => {
        requireWrite(ctx)
        const resolved = await resolveReportRef(ctx, args.report, args.workspace)
        requireMemberAccess(resolved)
        const created = await comments.create(ctx.caller.user, resolved.id, args.body, {
          viaAgent: agentLabel(ctx.caller),
          replyTo: args.replyTo,
        })
        return textResult(`Comment added: ${reportUrl(appUrl, resolved.id)}#comment-${created.id}`, { id: created.id })
      }),
  )

  server.registerTool(
    "editComment",
    {
      title: "Edit a comment",
      description: "Rewrite one of your own comments (ids come from getComments).",
      inputSchema: { commentId: z.string().min(1).max(100), body: z.string().min(1).max(5000) },
      annotations: { ...writeAnnotations, idempotentHint: true },
    },
    (args) =>
      runTool(async () => {
        requireWrite(ctx)
        const edited = await comments.edit(ctx.caller.user, args.commentId, args.body)
        return textResult(`Comment ${edited.id} updated.`)
      }),
  )

  server.registerTool(
    "deleteComment",
    {
      title: "Delete a comment",
      description: "Permanently delete a comment: your own, or anyone's if you are a workspace admin. Ask the user first.",
      inputSchema: { commentId: z.string().min(1).max(100) },
      annotations: { ...writeAnnotations, destructiveHint: true, idempotentHint: true },
    },
    (args) =>
      runTool(async () => {
        requireWrite(ctx)
        await comments.remove(ctx.caller.user, args.commentId)
        return textResult(`Comment ${args.commentId} deleted.`)
      }),
  )

  server.registerTool(
    "updateReport",
    {
      title: "Update a report",
      description:
        "Change a report's status, priority, assignee, title, description or project. Who can see the report cannot be changed here.",
      inputSchema: {
        ...reportArgs,
        status: z.enum(REPORT_STATUSES).optional(),
        priority: z.enum(PRIORITIES).optional(),
        assignee: z.string().max(100).optional().describe('"me", "none", or a member id from listMembers.'),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(5000).optional(),
        project: z.string().max(200).optional().describe('Project id or slug in the report\'s workspace, or "none".'),
      },
      annotations: { ...writeAnnotations, idempotentHint: true },
    },
    (args) =>
      runTool(async () => {
        requireWrite(ctx)
        const resolved = await resolveReportRef(ctx, args.report, args.workspace)
        requireMemberAccess(resolved)
        const input: UpdateReportInput = {}
        if (args.status !== undefined) input.status = args.status
        if (args.priority !== undefined) input.priority = args.priority
        if (args.title !== undefined) input.title = args.title
        if (args.description !== undefined) input.description = args.description
        if (args.assignee !== undefined) {
          input.assigneeId = args.assignee === "none" ? null : args.assignee === "me" ? ctx.caller.user.id : args.assignee
        }
        if (args.project !== undefined) {
          if (args.project === "none") input.projectId = null
          else {
            const projectId = await findProjectByRef(ctx.deps.db, resolved.workspaceId, args.project)
            if (!projectId) throw new McpToolError("project_not_found", "Project not found in this workspace")
            input.projectId = projectId
          }
        }
        const detail = await updateReport(ctx.deps, ctx.caller.user, resolved.id, input, { viaAgent: agentLabel(ctx.caller) })
        return textResult(
          `Updated BB-${detail.number}: ${detail.status}/${detail.priority}, assignee ${detail.assignee?.name ?? "nobody"}. ${reportUrl(appUrl, detail.id)}`,
        )
      }),
  )

  server.registerTool(
    "markNotificationsRead",
    {
      title: "Mark notifications read",
      description: "Mark one notification (id from getNotifications) or all of them as read.",
      inputSchema: { id: z.string().max(100).optional(), all: z.boolean().optional() },
      annotations: { ...writeAnnotations, idempotentHint: true },
    },
    (args) =>
      runTool(async () => {
        requireWrite(ctx)
        if (Boolean(args.id) === Boolean(args.all)) throw new McpToolError("bad_request", "Give either id or all: true")
        if (args.all) await markAllNotificationsRead(ctx.deps, ctx.caller.user)
        else await markNotificationRead(ctx.deps, ctx.caller.user, args.id ?? "")
        return textResult(args.all ? "All notifications marked read." : `Notification ${args.id} marked read.`)
      }),
  )
}
