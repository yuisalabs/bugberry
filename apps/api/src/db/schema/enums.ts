import { CAPTURE_TYPES, INTEGRATION_PROVIDERS, PRIORITIES, REPORT_STATUSES, UPLOAD_STATUSES, VISIBILITIES, WORKSPACE_ROLES } from "@bugberry/shared"
import { pgEnum } from "drizzle-orm/pg-core"

export const reportStatusEnum = pgEnum("report_status", REPORT_STATUSES)

export const priorityEnum = pgEnum("priority", PRIORITIES)

export const visibilityEnum = pgEnum("visibility", VISIBILITIES)

export const captureTypeEnum = pgEnum("capture_type", CAPTURE_TYPES)

export const uploadStatusEnum = pgEnum("upload_status", UPLOAD_STATUSES)

/** Every integration provider; the SQL name stays from when only trackers existed. */
export const integrationProviderEnum = pgEnum("tracker_provider", INTEGRATION_PROVIDERS)

export const workspaceRoleEnum = pgEnum("workspace_role", WORKSPACE_ROLES)

/** "full" works on every route (CLI tokens); "mcp" only on /api/mcp (made in the dashboard for AI agents). */
export const apiTokenKindEnum = pgEnum("api_token_kind", ["full", "mcp"])

/** Why someone has a bell notification: mentioned, or a reply in a thread they started or joined. */
export const notificationKindEnum = pgEnum("notification_kind", ["mention", "reply_to_you", "reply_in_thread"])

/** What a report activity line records; "created" comes from the report itself and has no row. */
export const ACTIVITY_KINDS = ["status", "priority", "assignee", "title", "tracker", "agent_read"] as const

export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export const activityKindEnum = pgEnum("activity_kind", ACTIVITY_KINDS)
