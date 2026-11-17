import type { DebuggerSummary, DeviceInfo } from "@bugberry/shared"
import { sql } from "drizzle-orm"
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { createdAt, updatedAt } from "./columns"
import { activityKindEnum, captureTypeEnum, integrationProviderEnum, priorityEnum, reportStatusEnum, uploadStatusEnum, visibilityEnum } from "./enums"
import { user } from "./auth"
import { workspace } from "./workspaces"
import { project } from "./projects"
import { integration } from "./connections"
import { recordingRequest } from "./requests"

export const report = pgTable(
  "report",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "restrict" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "restrict" }),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    /** Counts up within the workspace, shown as BB-{number}. */
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: reportStatusEnum("status").notNull().default("open"),
    priority: priorityEnum("priority").notNull().default("none"),
    visibility: visibilityEnum("visibility").notNull().default("workspace"),
    /** The reporter's email domain when the report was made; "internal" shares with this domain. */
    reporterDomain: text("reporter_domain"),
    shareSlug: text("share_slug").notNull().unique(),
    captureType: captureTypeEnum("capture_type").notNull(),
    pageUrl: text("page_url").notNull(),
    pageTitle: text("page_title").notNull().default(""),
    device: jsonb("device").$type<DeviceInfo>().notNull(),
    durationMs: integer("duration_ms"),
    mediaKey: text("media_key").notNull(),
    mediaType: text("media_type").notNull(),
    /** Size in bytes declared by the client when the upload session was created. */
    mediaSize: integer("media_size").notNull(),
    /** The storage's id for media sent in parts, until finalize joins them; null for media sent in one PUT. */
    mediaUploadId: text("media_upload_id"),
    debuggerKey: text("debugger_key"),
    debuggerSize: integer("debugger_size"),
    /** Null when the report has no preview: older reports, or a thumbnail that failed to upload. */
    thumbnailKey: text("thumbnail_key"),
    thumbnailSize: integer("thumbnail_size"),
    /** Frame times in ms from the replay's start, one per reports/<id>/frames/NNN.jpg; null for other types and before finalize. */
    replayFrames: jsonb("replay_frames").$type<number[]>(),
    debuggerSummary: jsonb("debugger_summary").$type<DebuggerSummary>().notNull(),
    /**
     * Whether the debugger caught an error or a failed request. The driver stores `debugger_summary` as a JSON string
     * inside jsonb, so the string is unwrapped first; an object (written by hand or a later driver) is read as it is.
     */
    hasErrors: boolean("has_errors")
      .notNull()
      .generatedAlwaysAs(
        sql`coalesce(((case when jsonb_typeof(debugger_summary) = 'string' then (debugger_summary #>> '{}')::jsonb else debugger_summary end) ->> 'errors')::int, 0) > 0 or coalesce(((case when jsonb_typeof(debugger_summary) = 'string' then (debugger_summary #>> '{}')::jsonb else debugger_summary end) ->> 'failedRequests')::int, 0) > 0`,
      ),
    uploadStatus: uploadStatusEnum("upload_status").notNull().default("uploading"),
    uploadError: text("upload_error"),
    /** "City, Country" from the reporter's location, when they chose to include it. Never coordinates. */
    location: text("location"),
    /** The AI app that recorded it through the agent recorder ("Claude Code", "AI agent"); null for the extension. */
    viaAgent: text("via_agent"),
    /** The request link it came through; the report keeps its sender when the link is deleted. */
    recordingRequestId: text("recording_request_id").references(() => recordingRequest.id, { onDelete: "set null" }),
    /** Who sent it through a request link: not a user, only the name and email they typed. */
    senderName: text("sender_name"),
    senderEmail: text("sender_email"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("report_project_created_idx").on(table.projectId, table.createdAt),
    // The report list: each of its orders and its commonest filters, ending in the (created_at, id) it pages by.
    index("report_workspace_created_id_idx").on(table.workspaceId, table.createdAt, table.id),
    index("report_workspace_status_created_idx").on(table.workspaceId, table.status, table.createdAt, table.id),
    index("report_workspace_assignee_created_idx").on(table.workspaceId, table.assigneeId, table.createdAt, table.id),
    index("report_workspace_priority_created_idx").on(table.workspaceId, table.priority, table.createdAt, table.id),
    // Search is `ILIKE '%term%'`, which only a trigram index can serve.
    index("report_title_trgm_idx").using("gin", table.title.op("gin_trgm_ops")),
    index("report_page_url_trgm_idx").using("gin", table.pageUrl.op("gin_trgm_ops")),
    index("report_description_trgm_idx").using("gin", table.description.op("gin_trgm_ops")),
    index("report_upload_status_created_idx").on(table.uploadStatus, table.createdAt),
    uniqueIndex("report_workspace_number_idx").on(table.workspaceId, table.number),
    // The Getting started checklist asks what this person has captured.
    index("report_reporter_idx").on(table.reporterId, table.captureType, table.uploadStatus),
    index("report_recording_request_idx").on(table.recordingRequestId),
  ],
)

/**
 * A link an agent's recording is uploaded through, handed out by the MCP's createUpload: it reaches one report,
 * for its reporter, until it expires or the upload is finalized. Only the token's hash is kept.
 */
export const agentUpload = pgTable(
  "agent_upload",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    reportId: text("report_id")
      .notNull()
      .references(() => report.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("agent_upload_report_idx").on(table.reportId)],
)

/**
 * What happened to a report, for the comments feed: field changes, tracker sends and AI agents reading it.
 * `actorId` is the person (also when an agent acted for them, named in `viaAgent`); null for automatic sends.
 */
export const reportActivity = pgTable(
  "report_activity",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => report.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    viaAgent: text("via_agent"),
    kind: activityKindEnum("kind").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("report_activity_report_created_idx").on(table.reportId, table.createdAt),
    index("report_activity_actor_idx").on(table.actorId, table.kind),
  ],
)

/**
 * One row per (report, integration). States: sent (external_id set), failed (error set),
 * or being sent (both empty) — the row doubles as the lock that prevents duplicate issues.
 */
export const reportExternalLink = pgTable(
  "report_external_link",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => report.id, { onDelete: "cascade" }),
    /** Null once the use (or its connection) is gone; the link and its issue stay. */
    integrationId: text("integration_id").references(() => integration.id, { onDelete: "set null" }),
    /** Kept with the link so its issue still reads "GitHub #42" after the use is gone. */
    provider: integrationProviderEnum("provider"),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("report_external_link_report_integration_idx").on(table.reportId, table.integrationId)],
)
