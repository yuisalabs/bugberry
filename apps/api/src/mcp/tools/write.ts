import { MAX_FIX_URL_LENGTH, MAX_FIXES_PER_REPORT, MAX_LABELS_PER_REPORT, PRIORITIES, REPORT_STATUSES } from "@bugberry/shared"
import { findLabelsByNames, labelsOfReports, listLabels } from "../../modules/labels/repository"
import { setReportLabels } from "../../modules/labels/service"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { findProjectByRef } from "../../modules/projects/repository"
import { createCommentsService } from "../../modules/comments/service"
import { markAllNotificationsRead, markNotificationRead } from "../../modules/notifications/service"
import { resolveReport } from "../../modules/reports/fixes"
import { updateReport, type UpdateReportInput } from "../../modules/reports/service"
import { agentLabel, type McpContext, McpToolError, requireWrite, runTool } from "../context"
import { reportUrl, textResult } from "../format"
import { requireMemberAccess, resolveReportRef } from "../refs"
import { reportArgs } from "./args"

const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }

/** Existing labels by name, without regard to case; agents can't create labels, so an unknown name is refused. */
export async function labelsNamed(ctx: McpContext, workspaceId: string, names: string[]) {
  if (names.length === 0) return []
  const found = await findLabelsByNames(ctx.deps.db, workspaceId, names)
  const missing = names.find((name) => !found.some((label) => label.name.toLowerCase() === name.trim().toLowerCase()))
  if (missing !== undefined) {
    const all = await listLabels(ctx.deps.db, workspaceId)
    throw new McpToolError("label_not_found", `No label named "${missing}". Labels here: ${all.map((label) => label.name).join(", ") || "none"}.`)
  }
  return found
}

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
        "Change a report's status, priority, assignee, title, description, project or labels. Who can see the report cannot be changed here.",
      inputSchema: {
        ...reportArgs,
        status: z.enum(REPORT_STATUSES).optional(),
        priority: z.enum(PRIORITIES).optional(),
        assignee: z.string().max(100).optional().describe('"me", "none", or a member id from listMembers.'),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(5000).optional(),
        project: z.string().max(200).optional().describe('Project id or slug in the report\'s workspace, or "none".'),
        addLabels: z.array(z.string().max(40)).max(10).optional().describe("Names of existing labels (listLabels) to put on the report."),
        removeLabels: z.array(z.string().max(40)).max(10).optional().describe("Names of labels to take off the report."),
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
        const viaAgent = agentLabel(ctx.caller)
        const changesLabels = Boolean(args.addLabels?.length || args.removeLabels?.length)
        // Checked before any field changes, so a refused label change leaves the report as it was.
        const add = await labelsNamed(ctx, resolved.workspaceId, args.addLabels ?? [])
        const remove = await labelsNamed(ctx, resolved.workspaceId, args.removeLabels ?? [])
        const nextLabels = (current: string[]) =>
          [...new Set([...current, ...add.map((label) => label.id)])].filter((id) => !remove.some((label) => label.id === id))
        if (changesLabels) {
          const current = (await labelsOfReports(ctx.deps.db, [resolved.id])).get(resolved.id) ?? []
          if (nextLabels(current.map((label) => label.id)).length > MAX_LABELS_PER_REPORT) {
            throw new McpToolError("label_limit", `A report takes at most ${MAX_LABELS_PER_REPORT} labels`)
          }
        }
        let detail = Object.keys(input).length || !changesLabels ? await updateReport(ctx.deps, ctx.caller.user, resolved.id, input, { viaAgent }) : null
        if (changesLabels) detail = await setReportLabels(ctx.deps, ctx.caller.user, resolved.id, nextLabels, { viaAgent })
        if (!detail) throw new McpToolError("report_not_found", "Report not found")
        return textResult(
          `Updated BB-${detail.number}: ${detail.status}/${detail.priority}, assignee ${detail.assignee?.name ?? "nobody"}. ${reportUrl(appUrl, detail.id)}`,
        )
      }),
  )

  server.registerTool(
    "resolveReport",
    {
      title: "Resolve a report with its fix",
      description:
        "Mark a report resolved and record where it was fixed: links to the pull request, merge request or commit. " +
        "The reporter gets a notification and an email, once, unless they resolved it themselves. An optional note is posted as your comment. " +
        "Calling it again on a resolved report only adds links, and posts the note again if you give one.",
      inputSchema: {
        ...reportArgs,
        links: z
          .array(z.string().min(1).max(MAX_FIX_URL_LENGTH))
          .min(1)
          .max(MAX_FIXES_PER_REPORT)
          .describe("http(s) links to the PR, MR or commit that fixed it."),
        note: z.string().max(5000).optional().describe("A note for the reporter, posted as a comment."),
      },
      annotations: writeAnnotations,
    },
    (args) =>
      runTool(async () => {
        requireWrite(ctx)
        const resolved = await resolveReportRef(ctx, args.report, args.workspace)
        requireMemberAccess(resolved)
        const result = await resolveReport(
          ctx.deps,
          ctx.caller.user,
          resolved.id,
          { links: args.links, note: args.note },
          { viaAgent: agentLabel(ctx.caller) },
        )
        const told = result.notified
          ? "Reporter notified."
          : "Reporter not notified (their own report, a former member, or it was already resolved)."
        return textResult(
          `Resolved BB-${result.detail.number} with ${result.links.length} fix link(s): ${result.links.map((link) => link.label).join(", ")}. ${told} ${reportUrl(appUrl, resolved.id)}`,
          { status: result.detail.status, notified: result.notified, links: result.links.map(({ url, label }) => ({ url, label })) },
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
