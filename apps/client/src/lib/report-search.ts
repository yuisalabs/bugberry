import { CAPTURE_TYPES, type CaptureType, PRIORITIES, type Priority, REPORT_STATUSES, type ReportStatus } from "@bugberry/shared"
import type { ReportFilterQuery } from "./report-feed"

const MAX_QUERY_LENGTH = 200
const MAX_ID_LENGTH = 100
/** `projectId=none` on the all-reports page: only reports without a project. */
export const NO_PROJECT = "none"

/** Filters of the report list, kept in the URL. A missing key means no filter or the default. */
export interface ReportSearch {
  status?: ReportStatus[]
  priority?: Priority[]
  assigneeId?: string
  reporterId?: string
  captureType?: CaptureType
  /** A project id or NO_PROJECT; read only on the all-reports page. */
  projectId?: string
  q?: string
  /** Newest first when missing. */
  sort?: "oldest" | "priority"
}

/** Accepts an array or a comma list; keeps known values in their canonical order, once each. */
function pickList<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  const items: unknown[] = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []
  const picked = allowed.filter((option) => items.includes(option))
  return picked.length > 0 ? picked : undefined
}

function searchText(value: unknown): string | undefined {
  // TanStack Router parses `?q=404` as the number 404.
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : ""
  return text ? text.slice(0, MAX_QUERY_LENGTH) : undefined
}

function idParam(value: unknown): string | undefined {
  return typeof value === "string" && value ? value.slice(0, MAX_ID_LENGTH) : undefined
}

/**
 * Cleans hand-edited or stale URLs: unknown values are dropped instead of being sent to the API. The list loads
 * as it scrolls, so an old link's `page` and `perPage` are dropped too.
 */
export function validateReportSearch(search: Record<string, unknown>): ReportSearch {
  return {
    status: pickList(search.status, REPORT_STATUSES),
    priority: pickList(search.priority, PRIORITIES),
    assigneeId: idParam(search.assigneeId),
    reporterId: idParam(search.reporterId),
    captureType: (CAPTURE_TYPES as readonly unknown[]).includes(search.captureType)
      ? (search.captureType as CaptureType)
      : undefined,
    projectId: idParam(search.projectId),
    q: searchText(search.q),
    sort: search.sort === "priority" || search.sort === "oldest" ? search.sort : undefined,
  }
}

/** A project page's search: its project is fixed, so a project filter in the URL is dropped. */
export function validateProjectReportSearch(search: Record<string, unknown>): ReportSearch {
  return { ...validateReportSearch(search), projectId: undefined }
}

/**
 * A project page passes its own project as `scope` and ignores the URL's project filter; the
 * all-reports page passes `{}` and lets the URL choose a project or NO_PROJECT.
 */
export function toReportsQuery(scope: { projectId?: string }, search: ReportSearch): ReportFilterQuery {
  const projectId = scope.projectId ?? search.projectId
  const query: ReportFilterQuery = {
    ...(projectId ? { projectId } : {}),
    sort: search.sort ?? "newest",
  }
  if (search.status) query.status = search.status
  if (search.priority) query.priority = search.priority
  if (search.assigneeId) query.assigneeId = search.assigneeId
  if (search.reporterId) query.reporterId = search.reporterId
  if (search.captureType) query.captureType = search.captureType
  if (search.q) query.q = search.q
  return query
}

/** Every filter off; the order stays as chosen. */
export const CLEARED_FILTERS: Partial<ReportSearch> = {
  status: undefined,
  priority: undefined,
  assigneeId: undefined,
  reporterId: undefined,
  captureType: undefined,
  projectId: undefined,
  q: undefined,
}

export function hasFilters(search: ReportSearch): boolean {
  return Boolean(
    search.status ||
      search.priority ||
      search.assigneeId ||
      search.reporterId ||
      search.captureType ||
      search.projectId ||
      search.q,
  )
}

/** Adds or removes `value`; an empty list becomes undefined so it leaves the URL. */
export function toggleValue<T extends string>(list: readonly T[] | undefined, value: T): T[] | undefined {
  const next = list?.includes(value) ? list.filter((item) => item !== value) : [...(list ?? []), value]
  return next.length > 0 ? next : undefined
}
