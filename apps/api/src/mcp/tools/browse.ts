import { CAPTURE_TYPES, listedCount, MAX_PER_PAGE, PRIORITIES, REPORT_STATUSES } from "@bugberry/shared"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { listNotifications } from "../../modules/notifications/service"
import { listLabels } from "../../modules/labels/repository"
import { NO_ASSIGNEE, NO_PROJECT } from "../../modules/reports/model"
import { countReportsByStatus, type ListReportsInput, listReports, type ReportListItem } from "../../modules/reports/service"
import { findProjectByRef, listProjectSummaries } from "../../modules/projects/repository"
import { resolveWorkspace } from "../../modules/workspaces/access"
import { listMemberContacts, listMemberNames, listWorkspaceRoles } from "../../modules/workspaces/repository"
import { type McpContext, McpToolError, runTool } from "../context"
import { reportUrl, textResult } from "../format"
import { resolveReportRef, workspaceFor } from "../refs"
import { reportSummary } from "./report-read"
import { labelsNamed } from "./write"

const SEARCH_DEFAULT = 20

const workspaceArg = z.string().max(200).optional().describe("Workspace id or slug; defaults to your current workspace.")

/**
 * How many reports the filters hold, or null when counting fails. The count reads every match and can run into
 * MCP's statement timeout where the page of reports does not, and those reports are still worth sending.
 */
async function matchCount(ctx: McpContext, filters: ListReportsInput): Promise<number | null> {
  try {
    return listedCount(await countReportsByStatus(ctx.deps, ctx.caller.user, filters), filters.status)
  } catch (error) {
    console.error("MCP searchReports could not count its matches", error)
    return null
  }
}

/** A project named by id or slug inside the workspace, or "none". */
async function projectFilter(ctx: McpContext, workspaceId: string, value: string | undefined): Promise<string | undefined> {
  if (!value || value === NO_PROJECT) return value
  const projectId = await findProjectByRef(ctx.deps.db, workspaceId, value)
  if (!projectId) throw new McpToolError("project_not_found", "Project not found in this workspace")
  return projectId
}

const person = (ctx: McpContext, value: string | undefined) => (value === "me" ? ctx.caller.user.id : value)

function reportLine(appUrl: string, item: ReportListItem, assignees: Map<string, string>): string {
  const summary = item.debuggerSummary
  const assignee = item.assigneeId ? (assignees.get(item.assigneeId) ?? "former member") : "unassigned"
  return [
    `BB-${item.number}`,
    item.title,
    `${item.status}/${item.priority}`,
    assignee,
    `${summary.errors} errors, ${summary.failedRequests} failed requests`,
    item.createdAt.toISOString().slice(0, 10),
    reportUrl(appUrl, item.id),
  ].join(" · ") + (item.labels.length ? ` [${item.labels.map((label) => label.name).join(", ")}]` : "")
}

/** Label names as ids for the list's filter; names matching no label find nothing rather than everything. */
/** The ids for a search by label names; a name no label has is refused, so the agent never reads a quietly wider search. */
async function labelFilter(ctx: McpContext, workspaceId: string, names: string[] | undefined): Promise<string[] | undefined> {
  if (!names?.length) return undefined
  return (await labelsNamed(ctx, workspaceId, names)).map((label) => label.id)
}

async function memberNames(ctx: McpContext, workspaceId: string): Promise<Map<string, string>> {
  const rows = await listMemberNames(ctx.deps.db, workspaceId)
  return new Map(rows.map((row) => [row.id, row.name]))
}

const NOTIFICATION_VERBS = {
  mention: "mentioned you",
  reply_to_you: "replied to your comment",
  reply_in_thread: "replied in a thread you're in",
  resolved: "resolved",
  recording_received: "sent the recording you asked for:",
} as const

export function registerBrowseTools(server: McpServer, ctx: McpContext): void {
  const { config } = ctx.deps

  server.registerTool(
    "searchReports",
    {
      title: "Search bug reports",
      description:
        "Find reports in a workspace by text (title, description, page URL, comments), status, priority, project, assignee, " +
        "reporter, type, date or whether they caught errors. Newest first unless sorted otherwise.",
      inputSchema: {
        workspace: workspaceArg,
        query: z.string().max(200).optional().describe("Text to look for."),
        status: z.array(z.enum(REPORT_STATUSES)).optional(),
        priority: z.array(z.enum(PRIORITIES)).optional(),
        project: z.string().max(200).optional().describe('Project id or slug, or "none" for reports without a project.'),
        assignee: z.string().max(100).optional().describe('"me", "none", or a member id from listMembers.'),
        reporter: z.string().max(100).optional().describe('"me" or a member id.'),
        captureType: z.enum(CAPTURE_TYPES).optional(),
        createdAfter: z.string().datetime({ offset: true }).optional().describe("ISO date-time."),
        createdBefore: z.string().datetime({ offset: true }).optional().describe("ISO date-time."),
        hasErrors: z.boolean().optional().describe("Only reports that caught errors or failed requests."),
        labels: z.array(z.string().max(40)).max(20).optional().describe("Label names from listLabels; finds reports carrying any of them. A name no label has is refused."),
        sort: z.enum(["newest", "oldest", "priority"]).optional(),
        limit: z.number().int().min(1).max(MAX_PER_PAGE).optional().describe(`How many reports (default ${SEARCH_DEFAULT}, max ${MAX_PER_PAGE}).`),
        cursor: z.string().max(400).optional().describe("From the last line of the page before, to get the next one."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const workspaceId = await workspaceFor(ctx, args.workspace)
        const filters = {
          workspaceId,
          q: args.query,
          status: args.status,
          priority: args.priority,
          projectId: await projectFilter(ctx, workspaceId, args.project),
          assigneeId: args.assignee === "none" ? NO_ASSIGNEE : person(ctx, args.assignee),
          reporterId: person(ctx, args.reporter),
          captureType: args.captureType,
          createdAfter: args.createdAfter,
          createdBefore: args.createdBefore,
          hasErrors: args.hasErrors,
          labelId: await labelFilter(ctx, workspaceId, args.labels),
          sort: args.sort,
        }
        const result = await listReports(ctx.deps, ctx.caller.user, { ...filters, perPage: args.limit ?? SEARCH_DEFAULT, cursor: args.cursor })
        if (result.items.length === 0) return textResult(args.cursor ? "No more reports." : "No reports match.", { reports: [] })
        const names = await memberNames(ctx, workspaceId)
        // Only the first page asks for the count; the pages after it would get the same answer.
        const total = args.cursor ? null : await matchCount(ctx, filters)
        const text = [
          ...(total === null ? [] : [`${total} report${total === 1 ? "" : "s"} found.`]),
          ...result.items.map((item) => reportLine(config.appUrl, item, names)),
          ...(result.nextCursor ? [`More available. Call again with cursor="${result.nextCursor}"`] : []),
        ].join("\n")
        return textResult(text, {
          ...(total === null ? {} : { total }),
          reports: result.items.map((item) => ({
            id: item.id,
            number: item.number,
            title: item.title,
            status: item.status,
            priority: item.priority,
            url: reportUrl(config.appUrl, item.id),
          })),
        })
      }),
  )

  server.registerTool(
    "listWorkspaces",
    {
      title: "List your workspaces",
      description: "Your workspaces with id, slug, name and your role; the current one is used when a tool is not told which.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      runTool(async () => {
        const current = await resolveWorkspace(ctx.deps.db, ctx.caller.user).catch(() => null)
        const rows = await listWorkspaceRoles(ctx.deps.db, ctx.caller.user.id)
        if (rows.length === 0) return textResult("You are not in any workspace yet.")
        return textResult(
          rows.map((row) => `${row.id} · ${row.slug ?? ""} · ${row.name} · ${row.role}${row.id === current ? " (current)" : ""}`).join("\n"),
          { workspaces: rows.map((row) => ({ ...row, current: row.id === current })) },
        )
      }),
  )

  server.registerTool(
    "listProjects",
    {
      title: "List projects",
      description: "The workspace's projects with id, slug, name and the page URL patterns that route reports to them.",
      inputSchema: { workspace: workspaceArg },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const workspaceId = await workspaceFor(ctx, args.workspace)
        const rows = await listProjectSummaries(ctx.deps.db, workspaceId)
        if (rows.length === 0) return textResult("This workspace has no projects.")
        return textResult(rows.map((row) => `${row.id} · ${row.slug} · ${row.name} · ${row.urlPatterns.join(", ") || "no URL patterns"}`).join("\n"), {
          projects: rows,
        })
      }),
  )

  server.registerTool(
    "listMembers",
    {
      title: "List workspace members",
      description: "Members with id, name, email and role. Use an id to assign a report, or to mention someone in a comment as @[user:<id>].",
      inputSchema: { workspace: workspaceArg },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const workspaceId = await workspaceFor(ctx, args.workspace)
        const rows = await listMemberContacts(ctx.deps.db, workspaceId)
        return textResult(
          [...rows.map((row) => `${row.id} · ${row.name} <${row.email}> · ${row.role}`), "", "Mention someone in a comment with @[user:<id>]."].join("\n"),
          { members: rows },
        )
      }),
  )

  server.registerTool(
    "listLabels",
    {
      title: "List labels",
      description: "The workspace's labels with name, color and how many reports carry each. Filter searchReports by them, or set them with updateReport.",
      inputSchema: { workspace: workspaceArg },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const workspaceId = await workspaceFor(ctx, args.workspace)
        const rows = await listLabels(ctx.deps.db, workspaceId)
        if (rows.length === 0) return textResult("This workspace has no labels.", { labels: [] })
        return textResult(
          rows.map((row) => `${row.name} · ${row.color} · ${row.reportCount} report${row.reportCount === 1 ? "" : "s"}`).join("\n"),
          { labels: rows },
        )
      }),
  )

  server.registerTool(
    "getNotifications",
    {
      title: "Get your notifications",
      description:
        "Comments where someone mentioned you or replied in your threads, and your reports someone resolved, newest first " +
        "(unread only by default), with the notification id for markNotificationsRead.",
      inputSchema: {
        unreadOnly: z.boolean().optional().describe("Only unread ones (default true)."),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const { items, unreadCount } = await listNotifications(ctx.deps, ctx.caller.user, {
          unreadOnly: args.unreadOnly ?? true,
          limit: args.limit,
        })
        if (items.length === 0) return textResult(`No notifications. ${unreadCount} unread.`)
        const lines = items.map((item) => {
          const actor = `${item.actor?.name ?? item.senderName ?? "Someone"}${item.viaAgent ? ` (via ${item.viaAgent})` : ""}`
          const where = item.kind === "resolved" || item.kind === "recording_received" ? "" : " in"
          const link = reportUrl(config.appUrl, item.report.id)
          return [
            `[${item.id}]${item.read ? "" : " (unread)"} ${actor} ${NOTIFICATION_VERBS[item.kind]}${where} BB-${item.report.number} · ${item.report.title}`,
            `    ${item.snippet}`,
            `    ${item.commentId ? `${link}#comment-${item.commentId}` : link}`,
          ].join("\n")
        })
        return textResult([`${unreadCount} unread.`, ...lines].join("\n"))
      }),
  )

  // ChatGPT's connectors and deep research only call two tools with these exact shapes.
  server.registerTool(
    "search",
    {
      title: "Search reports (ChatGPT)",
      description: "Search bug reports in your current workspace. Returns ids for fetch.",
      inputSchema: { query: z.string().max(200).describe("Text to look for.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const result = await listReports(ctx.deps, ctx.caller.user, { q: args.query, perPage: MAX_PER_PAGE })
        const structured = {
          results: result.items.map((item) => ({ id: item.id, title: `BB-${item.number} · ${item.title}`, url: reportUrl(config.appUrl, item.id) })),
        }
        return textResult(JSON.stringify(structured), structured)
      }),
  )

  server.registerTool(
    "fetch",
    {
      title: "Fetch a report (ChatGPT)",
      description: "The full text of one report by the id that search returned.",
      inputSchema: { id: z.string().max(500).describe("A report id from search.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const resolved = await resolveReportRef(ctx, args.id)
        const { text, structured } = await reportSummary(ctx, resolved)
        const document = {
          id: resolved.id,
          title: `BB-${structured.number} · ${structured.title}`,
          text,
          url: structured.url,
          metadata: { status: structured.status, priority: structured.priority },
        }
        return textResult(JSON.stringify(document), document)
      }),
  )
}
