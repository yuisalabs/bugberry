import type { CaptureType, DebuggerSummary } from "@bugberry/shared"
import { consoleEntries, environmentRows } from "@bugberry/debugger-view"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { and, count, eq } from "drizzle-orm"
import { comment, project, report, reportExternalLink, workspace } from "../../db/schema"
import { loadReportDetail } from "../../modules/reports/detail"
import { createCommentsService } from "../../modules/comments/service"
import { renderMentions } from "../../modules/comments/mentions"
import { type McpContext, McpToolError, RATE_LIMITED, runTool } from "../context"
import { loadDebuggerData, NO_DEBUGGER, UNREADABLE_DEBUGGER } from "../debugger"
import { clip, offsetLabel, reportUrl, textResult } from "../format"
import { requireMemberAccess, resolveReportRef, type ResolvedReport } from "../refs"
import { noteAgentRead } from "../activity"
import { reportArgs } from "./args"

const MAX_IMAGE_BYTES = 1024 * 1024
const LINK_SECONDS = 300
const TOP_ERRORS = 3

/** What to call next, from what the debugger caught; a video can also be looked at frame by frame. */
export function nextSteps(summary: DebuggerSummary, captureType: CaptureType = "screenshot"): string[] {
  const steps: string[] = []
  if (summary.errors > 0) steps.push('getConsoleLogs levels=["error"]', "getCodeHotspots")
  if (summary.failedRequests > 0) steps.push("getNetworkRequests failedOnly=true")
  if (summary.actions > 0) steps.push("getUserActions")
  steps.push("getTimeline")
  if (captureType === "video") steps.push("getRecording")
  return steps
}

const duration = (ms: number | null) => (ms === null ? null : `${Math.round(ms / 100) / 10}s`)

/** The report as text and data: getReport's answer, also used by ChatGPT's fetch. */
export async function reportSummary(ctx: McpContext, resolved: ResolvedReport) {
  const { deps } = ctx
  const member = resolved.access === "member"
  const detail = await loadReportDetail(deps, { id: resolved.id }, { forMember: member })
  if (!detail) throw new Error("report vanished")
  const data = await loadDebuggerData(ctx, resolved)
  const view = data === "unreadable" ? null : data
  // The project and the workspace in one read. Their slugs say where a member files a follow-up (a fix proof);
  // a share viewer can't file there, so isn't told.
  const [place] = await deps.db
    .select({ projectName: project.name, projectSlug: project.slug, workspaceSlug: workspace.slug })
    .from(workspace)
    .leftJoin(project, and(eq(project.id, detail.projectId ?? ""), eq(project.workspaceId, workspace.id)))
    .where(eq(workspace.id, resolved.workspaceId))
    .limit(1)
  const projectRow = place?.projectName ? { name: place.projectName } : undefined
  const projectSlug = member ? (place?.projectSlug ?? null) : null
  const workspaceSlug = member ? (place?.workspaceSlug ?? null) : null
  const trackers = member
    ? await deps.db
        .select({ url: reportExternalLink.externalUrl, error: reportExternalLink.error })
        .from(reportExternalLink)
        .where(eq(reportExternalLink.reportId, resolved.id))
    : []
  const [comments] = member
    ? await deps.db.select({ value: count() }).from(comment).where(eq(comment.reportId, resolved.id))
    : []
  const base = view ? (view.recordingStartedAt ?? view.capturedAt) : null
  const topErrors = view
    ? [...new Set(consoleEntries(view.events).filter((entry) => entry.level === "error").map((entry) => clip(entry.text, 500)))].slice(
        0,
        TOP_ERRORS,
      )
    : []
  const url = reportUrl(deps.config.appUrl, resolved.id)
  const summary = detail.debuggerSummary
  const steps = nextSteps(summary, detail.captureType)

  const lines = [
    `BB-${detail.number} · ${detail.title}`,
    `Status: ${detail.status} · Priority: ${detail.priority} · Project: ${projectRow?.name ?? "none"}`,
    `Reporter: ${detail.reporter.name}${detail.reporterEmail ? ` <${detail.reporterEmail}>` : ""} · Assignee: ${detail.assignee?.name ?? "nobody"}`,
    `Created: ${detail.createdAt.toISOString()} · Link: ${url}`,
    ...(member ? [`Project slug: ${projectSlug ?? "none"} · Workspace: ${workspaceSlug ?? "none"}`] : []),
    ...(member ? [] : ["Access: read-only through the report's share link (comments and changes need workspace membership)."]),
    "",
    `Page: ${detail.pageTitle ? `${detail.pageTitle} · ` : ""}${detail.pageUrl}`,
    `Capture: ${detail.captureType}${detail.durationMs !== null ? `, ${duration(detail.durationMs)}` : ""}`,
    ...(detail.description ? ["", "Description:", clip(detail.description)] : []),
    "",
    "Environment:",
    ...environmentRows(view, detail.device).map((row) => `- ${row.label}: ${row.value}`),
    ...(member && detail.location ? [`- Location: ${detail.location}`] : []),
    "",
    view
      ? `Debugger: ${summary.logs} logs, ${summary.errors} errors, ${summary.requests} requests (${summary.failedRequests} failed), ${summary.actions} user actions`
      : data === "unreadable"
        ? UNREADABLE_DEBUGGER
        : NO_DEBUGGER,
    ...(summary.incomplete.length > 0 ? [`Not captured (hooks that could not be installed): ${summary.incomplete.join(", ")}`] : []),
    ...(topErrors.length > 0 ? ["", "Top errors:", ...topErrors.map((text) => `- ${text}`)] : []),
    ...(view && view.notes.length > 0
      ? ["", "Reporter's notes:", ...view.notes.map((note) => `- ${offsetLabel(note.atMs)} ${note.text} (${note.author})`)]
      : []),
    ...(trackers.length > 0
      ? ["", "Trackers:", ...trackers.map((link) => `- ${link.url ?? `failed: ${link.error ?? "sending"}`}`)]
      : []),
    ...(member ? ["", `Comments: ${comments?.value ?? 0} (getComments)`] : []),
    "",
    `Next steps: ${steps.join(", ")}`,
  ]

  const structured = {
    id: detail.id,
    number: detail.number,
    title: detail.title,
    description: detail.description,
    status: detail.status,
    priority: detail.priority,
    project: projectRow?.name ?? null,
    projectSlug,
    workspace: workspaceSlug,
    access: resolved.access,
    url,
    pageUrl: detail.pageUrl,
    captureType: detail.captureType,
    durationMs: detail.durationMs,
    reporter: detail.reporter.name,
    reporterEmail: detail.reporterEmail ?? null,
    assignee: detail.assignee?.name ?? null,
    location: member ? (detail.location ?? null) : null,
    createdAt: detail.createdAt.toISOString(),
    environment: environmentRows(view, detail.device),
    debuggerSummary: summary,
    hasDebugger: view !== null,
    topErrors,
    notes: view?.notes ?? [],
    recordingStartedAt: base,
    trackers: trackers.map((link) => link.url).filter(Boolean),
    nextSteps: steps,
  }
  return { text: lines.join("\n"), structured }
}

export function registerReportReadTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "getReport",
    {
      title: "Get a bug report",
      description:
        "Start here. The report's title, status, page, environment, debugger counts, top errors, the reporter's notes " +
        "and which tools to call next. Accepts a BugBerry link or a number like BB-123.",
      inputSchema: reportArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ report: ref, workspace }) =>
      runTool(async () => {
        const resolved = await resolveReportRef(ctx, ref, workspace)
        await noteAgentRead(ctx, resolved, "report")
        const { text, structured } = await reportSummary(ctx, resolved)
        return textResult(text, structured)
      }),
  )

  server.registerTool(
    "getComments",
    {
      title: "Get report comments",
      description:
        "The team's discussion on a report: newest thread first, replies under their comment (oldest first), reactions, " +
        "and each comment's id (for editComment, deleteComment, and addComment's replyTo to answer it).",
      inputSchema: reportArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ report: ref, workspace }) =>
      runTool(async () => {
        const resolved = await resolveReportRef(ctx, ref, workspace)
        requireMemberAccess(resolved)
        await noteAgentRead(ctx, resolved, "comments")
        const threads = await createCommentsService(ctx.deps).list(ctx.caller.user, resolved.id)
        if (threads.length === 0) return textResult("No comments yet.", { comments: [] })
        type Shown = (typeof threads)[number]["replies"][number]
        const bodyOf = (item: Shown) => renderMentions(item.body, new Map(item.mentions.map((person) => [person.id, person.name])))
        /** One comment as text; a reply is indented under its thread with "↳". */
        const render = (item: Shown, reply: boolean) => {
          const indent = reply ? "  " : ""
          const mark = reply ? "↳ " : ""
          if (item.deleted) return `${indent}${mark}[${item.id}] (deleted comment)`
          const via = item.viaAgent ? ` (via ${item.viaAgent})` : ""
          const reactions = item.reactions.map((reaction) => `${reaction.emoji} ${reaction.count}`).join("  ")
          const text = clip(bodyOf(item)).replaceAll("\n", `\n${indent}`)
          return `${indent}${mark}[${item.id}] ${item.author?.name}${via} · ${item.createdAt.toISOString()}\n${indent}${text}${reactions ? `\n${indent}${reactions}` : ""}`
        }
        const lines = threads.map((thread) => [render(thread, false), ...thread.replies.map((reply) => render(reply, true))].join("\n"))
        const structured = (item: Shown) => ({
          id: item.id,
          author: item.deleted ? null : (item.author?.name ?? null),
          viaAgent: item.viaAgent,
          createdAt: item.createdAt.toISOString(),
          deleted: item.deleted,
          body: item.deleted ? "" : bodyOf(item),
          reactions: item.reactions.map((reaction) => ({ emoji: reaction.emoji, count: reaction.count })),
        })
        return textResult(lines.join("\n\n"), {
          comments: threads.map((thread) => ({ ...structured(thread), replies: thread.replies.map(structured) })),
        })
      }),
  )

  server.registerTool(
    "getScreenshot",
    {
      title: "Get the report's screenshot",
      description:
        "The screenshot of a screenshot report, or the thumbnail of a video report, as an image. Large files come back as a short-lived link.",
      inputSchema: reportArgs,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ report: ref, workspace }) =>
      runTool(async () => {
        if (!ctx.screenshotLimiter.consume(ctx.caller.user.id)) throw new McpToolError("rate_limited", RATE_LIMITED)
        const resolved = await resolveReportRef(ctx, ref, workspace)
        await noteAgentRead(ctx, resolved, "screenshot")
        const { storage } = ctx.deps
        const row = resolved.row
        const url = reportUrl(ctx.deps.config.appUrl, resolved.id)
        const video = row.captureType === "video"
        const key = video ? row.thumbnailKey : row.mediaKey
        const mimeType = video ? "image/jpeg" : row.mediaType
        const videoLine = video ? [`Watch the video in BugBerry: ${url}`] : []
        const info = key ? await storage.head(key) : null
        if (!key || !info) {
          return textResult([video ? "This video has no thumbnail." : "The screenshot file is missing.", ...videoLine].join("\n"))
        }
        if (info.size > MAX_IMAGE_BYTES) {
          const link = await storage.getReadUrl(key, { contentType: mimeType, expiresInSeconds: LINK_SECONDS })
          return textResult(
            [`The image is too large to send (${Math.round(info.size / 1024)} KB). Open it here within 5 minutes: ${link}`, ...videoLine].join("\n"),
          )
        }
        const blob = await storage.read(key)
        if (!blob) return textResult("The screenshot file is missing.")
        const data = Buffer.from(await blob.arrayBuffer()).toString("base64")
        return {
          content: [
            { type: "image", data, mimeType },
            { type: "text", text: [video ? "Thumbnail of the recording." : "Screenshot of the report.", ...videoLine].join("\n") },
          ],
        }
      }),
  )
}
