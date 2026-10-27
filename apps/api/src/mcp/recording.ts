import { type DebuggerView, eventBase, isFailedRequest, type ViewAction } from "@bugberry/debugger-view"
import { clip, offsetLabel } from "./format"
import { actionText, requestLine } from "./tools/events"

/** Frames worth cutting: enough to follow a recording, few enough for an agent to look at every one. */
export const MAX_MOMENTS = 20
/** A click or submit this soon before an error or failed request is the step that caused it. */
const CAUSE_WINDOW_MS = 2000
/** Things this close together show on the same frame. */
const SAME_FRAME_MS = 1000

/** What it is, for which to keep when there are too many: problems first, navigations last. */
const RANK = { problem: 0, note: 1, action: 2, navigation: 3 } as const

interface Mark {
  atMs: number
  rank: number
  line: string
}

/** One spot in the video to look at, at the time of its last line, so the frame shows what came of the rest. */
export interface Moment {
  atMs: number
  lines: string[]
}

/** Every mark, in video time: events sit at `t - base` (paused parts were cut by the extension), notes are stored that way. */
function marksOf(view: DebuggerView): Mark[] {
  const marks: Mark[] = []
  const mark = (atMs: number, rank: number, text: string) => marks.push({ atMs, rank, line: `${offsetLabel(atMs)} ${text}` })
  for (const note of view.notes) mark(note.atMs, RANK.note, `Note ${note.n}: ${clip(note.text, 300)} (${note.author})`)

  const base = eventBase(view)
  if (base === null) return marks
  const pressed: ViewAction[] = []
  const causes = new Set<ViewAction>()
  const problem = (t: number, text: string) => {
    mark(t - base, RANK.problem, text)
    const cause = pressed.findLast((action) => t - action.t <= CAUSE_WINDOW_MS)
    if (cause) causes.add(cause)
  }
  for (const event of view.events) {
    if (event.kind === "error") problem(event.t, clip(event.message, 300))
    else if (event.kind === "console" && event.level === "error") problem(event.t, `[error] ${clip(event.text, 300)}`)
    else if (event.kind === "network" && isFailedRequest(event)) problem(event.t, requestLine(event))
    else if (event.kind === "page") mark(event.t - base, RANK.navigation, `${event.via === "reload" ? "Page reload" : "Page load"} ${clip(event.url, 300)}`)
    else if (event.kind === "action") {
      if (event.type === "click" || event.type === "submit") pressed.push(event)
      else if (event.type === "rage-click") mark(event.t - base, RANK.action, actionText(event))
      else if (event.type === "navigate") mark(event.t - base, RANK.navigation, actionText(event))
    }
  }
  for (const cause of causes) mark(cause.t - base, RANK.action, actionText(cause))
  return marks
}

/** The moments of a recording `durationMs` long worth a frame each, in video order. */
export function recordingMoments(view: DebuggerView, durationMs: number | null): Moment[] {
  const inVideo = (mark: Mark) => mark.atMs >= 0 && (durationMs === null || mark.atMs <= durationMs)
  const marks = marksOf(view)
    .filter(inVideo)
    .sort((a, b) => a.atMs - b.atMs)

  const groups: Array<{ startMs: number; rank: number; marks: Mark[] }> = []
  for (const mark of marks) {
    const last = groups.at(-1)
    if (last && mark.atMs - last.startMs < SAME_FRAME_MS) {
      last.marks.push(mark)
      last.rank = Math.min(last.rank, mark.rank)
    } else groups.push({ startMs: mark.atMs, rank: mark.rank, marks: [mark] })
  }

  const kept = new Set([...groups].sort((a, b) => a.rank - b.rank || a.startMs - b.startMs).slice(0, MAX_MOMENTS))
  return groups
    .filter((group) => kept.has(group))
    .map((group) => ({ atMs: group.marks.at(-1)?.atMs ?? group.startMs, lines: group.marks.map((mark) => mark.line) }))
}
