import { type IntegrationProvider, issueReference, PROVIDER_LABELS, type Priority, type ReportStatus } from "@bugberry/shared"
import { reportedVia } from "../components/report/ReportMeta"
import type { Activity, CommentThread } from "./api"
import { PRIORITY_LABELS, STATUS_LABELS } from "../features/reports/list/labels"

/** One line of the comments feed: a thread, or (under All activity) something that happened to the report. */
export type FeedEntry = { kind: "thread"; at: Date; thread: CommentThread } | { kind: "activity"; at: Date; item: Activity }

/** Threads and activity newest first; a thread sits at its first comment's time. Null activity: threads only. */
export function mergeFeed(threads: CommentThread[], activity: Activity[] | null): FeedEntry[] {
  const entries: FeedEntry[] = threads.map((thread) => ({ kind: "thread", at: new Date(thread.createdAt), thread }))
  for (const item of activity ?? []) entries.push({ kind: "activity", at: new Date(item.at), item })
  return entries.sort((left, right) => right.at.getTime() - left.at.getTime())
}

/** Comments shown in the heading's count: first comments and replies, but not "This comment was deleted". */
export function commentCount(threads: CommentThread[]): number {
  return threads.reduce((sum, thread) => sum + (thread.deleted ? 0 : 1) + thread.replies.filter((reply) => !reply.deleted).length, 0)
}

export type TextPart = { text: string } | { time: string; ms: number }

/** "0:52" or "1:02:03" on its own: not glued to letters, digits, colons or a dot before it ("10:30am", "10.0.0.5:22"). */
const TIME = /(?<![\w:.])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\w:])/g

/**
 * A comment's text split around video times. A time becomes a seek target only on a video report and only
 * inside the video's length; anything else that looks like a clock ("call at 10:30") stays text.
 */
export function videoTimes(text: string, durationMs: number | null): TextPart[] {
  const parts: TextPart[] = []
  const pushText = (value: string) => {
    if (!value) return
    const last = parts.at(-1)
    if (last && "text" in last) last.text += value
    else parts.push({ text: value })
  }
  let cursor = 0
  for (const match of text.matchAll(TIME)) {
    const [whole, hours, minutes, seconds] = match
    const start = match.index ?? 0
    const ms = ((Number(hours ?? 0) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000
    const valid = Number(seconds) < 60 && (hours === undefined || Number(minutes) < 60)
    pushText(text.slice(cursor, start))
    if (durationMs !== null && valid && ms <= durationMs) parts.push({ time: whole, ms })
    else pushText(whole)
    cursor = start + whole.length
  }
  pushText(text.slice(cursor))
  return parts
}

const READ_PARTS: Record<string, string> = {
  report: "this report",
  comments: "the comments",
  screenshot: "the screenshot",
  recording: "the recording",
  timeline: "the timeline",
  console: "the console",
  actions: "the user actions",
  network: "the network log",
  performance: "the performance data",
  frustration: "the frustration signals",
  code: "the code hotspots",
}

/** "a", "a and b", "a, b and c". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

type Person = { name: string } | null

/** What an activity line says after the person's name, such as "changed priority from None to High". */
export function activitySentence(item: Activity): string {
  const detail = item.detail as Record<string, unknown>
  switch (item.kind) {
    case "status":
      return `changed status from ${STATUS_LABELS[detail.from as ReportStatus]} to ${STATUS_LABELS[detail.to as ReportStatus]}`
    case "priority":
      return `changed priority from ${PRIORITY_LABELS[detail.from as Priority]} to ${PRIORITY_LABELS[detail.to as Priority]}`
    case "assignee": {
      const to = detail.to as Person
      const from = detail.from as Person
      if (to) return `assigned this to ${to.name}`
      return from ? `unassigned ${from.name}` : "unassigned this"
    }
    case "title":
      return `renamed this from "${detail.from}" to "${detail.to}"`
    case "tracker": {
      const provider = detail.provider as IntegrationProvider
      const where = `${PROVIDER_LABELS[provider] ?? "the tracker"} as ${issueReference(provider, String(detail.externalId))}`
      // Only sends marked automatic say so; older ones never stored who sent them.
      return detail.automatic ? `sent automatically to ${where}` : `sent this to ${where}`
    }
    case "agent_read":
      return `read ${listOf(((detail.parts as string[] | undefined) ?? []).map((part) => READ_PARTS[part] ?? part))}`
    case "created":
      // The agent's name already follows the person's ("Ana via Claude Code"), so the browser is left out.
      return item.viaAgent ? "recorded this" : `reported this via ${reportedVia(String(detail.browser ?? ""))}`
    default:
      return "updated this report"
  }
}
