import { CAPTURE_TYPES, MAX_PER_PAGE, MAX_THUMBNAIL_BYTES, PRIORITIES, REPORT_STATUSES, VISIBILITIES } from "@bugberry/shared"
import { t } from "elysia"
import { oneOf } from "../../lib/schema"

export const deviceSchema = t.Object({
  browser: t.String({ maxLength: 200 }),
  os: t.String({ maxLength: 200 }),
  viewport: t.String({ maxLength: 50 }),
})

export const debuggerSummarySchema = t.Object({
  logs: t.Integer({ minimum: 0 }),
  errors: t.Integer({ minimum: 0 }),
  requests: t.Integer({ minimum: 0 }),
  failedRequests: t.Integer({ minimum: 0 }),
  actions: t.Integer({ minimum: 0 }),
  incomplete: t.Array(t.String({ maxLength: 50 }), { maxItems: 20 }),
})

/** `projectId=none` in the report list: only reports without a project. */
export const NO_PROJECT = "none"
/** `assigneeId=none` in the report list: only reports nobody is assigned to. */
export const NO_ASSIGNEE = "none"

export const createUploadBody = t.Object({
  /** Omitted: the reporter's current workspace. */
  workspaceId: t.Optional(t.String({ minLength: 1 })),
  /** Omitted or null: the report belongs to no project. */
  projectId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
  /** Omitted or blank: "Bugshoot by …" or "Bugcord by …", after the reporter. */
  title: t.Optional(t.String({ maxLength: 200 })),
  description: t.Optional(t.String({ maxLength: 5000 })),
  priority: t.Optional(oneOf(PRIORITIES)),
  visibility: t.Optional(oneOf(VISIBILITIES)),
  captureType: oneOf(CAPTURE_TYPES),
  /** Exact byte size of the media file the client is about to upload. */
  mediaSize: t.Integer({ minimum: 1 }),
  /** Exact byte size of debugger.json.gz; omit when there is no debugger payload. */
  debuggerSize: t.Optional(t.Integer({ minimum: 1 })),
  /** Exact byte size of thumbnail.jpg; omit when the client made no thumbnail. */
  thumbnailSize: t.Optional(t.Integer({ minimum: 1, maximum: MAX_THUMBNAIL_BYTES })),
  pageUrl: t.String({ minLength: 1, maxLength: 2048 }),
  pageTitle: t.Optional(t.String({ maxLength: 500 })),
  device: deviceSchema,
  durationMs: t.Optional(t.Integer({ minimum: 0, maximum: 3_600_000 })),
  debuggerSummary: debuggerSummarySchema,
})

export type CreateUploadBody = typeof createUploadBody.static

/** Rounded GPS coordinates; turned into a city name at once and never stored. */
export const reportLocationBody = t.Object({
  latitude: t.Number({ minimum: -90, maximum: 90 }),
  longitude: t.Number({ minimum: -180, maximum: 180 }),
})

export const listReportsQuery = t.Object({
  /** Omitted: the caller's current workspace. */
  workspaceId: t.Optional(t.String({ minLength: 1 })),
  projectId: t.Optional(t.String()),
  captureType: t.Optional(oneOf(CAPTURE_TYPES)),
  status: t.Optional(t.Array(t.UnionEnum(REPORT_STATUSES))),
  priority: t.Optional(t.Array(t.UnionEnum(PRIORITIES))),
  assigneeId: t.Optional(t.String()),
  reporterId: t.Optional(t.String()),
  q: t.Optional(t.String({ maxLength: 200 })),
  createdAfter: t.Optional(t.String({ format: "date-time" })),
  createdBefore: t.Optional(t.String({ format: "date-time" })),
  /** Only reports whose debugger caught errors or failed requests. */
  hasErrors: t.Optional(t.BooleanString()),
  sort: t.Optional(t.UnionEnum(["newest", "oldest", "priority"])),
  // Whole numbers only; the cap keeps the OFFSET inside what Postgres accepts.
  page: t.Optional(t.Numeric({ minimum: 1, maximum: 100_000, multipleOf: 1 })),
  perPage: t.Optional(t.Numeric({ minimum: 1, maximum: MAX_PER_PAGE, multipleOf: 1 })),
})

export const updateReportBody = t.Object({
  title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  description: t.Optional(t.String({ maxLength: 5000 })),
  status: t.Optional(oneOf(REPORT_STATUSES)),
  priority: t.Optional(oneOf(PRIORITIES)),
  visibility: t.Optional(oneOf(VISIBILITIES)),
  assigneeId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
  /** Null takes the report out of its project. Moving never auto-sends to trackers. */
  projectId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
})
