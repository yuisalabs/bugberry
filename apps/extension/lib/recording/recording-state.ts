import type { RecordSource } from "../capture/capture-prefs"
import type { LiveCounts, PauseSpan } from "../review/review-data"

export interface RecordingState {
  draftId: string
  tabId: number
  startedAt: number
  /** Pages the recorded tab loaded since the start; each should flush its events as it goes away. */
  loads: number
  /** False for a screen or window recorded from a tab that isn't a web page: there are no logs to read. */
  logs: boolean
  /** Finished pauses, in epoch ms. */
  pauses: PauseSpan[]
  /** When the running pause began; null while recording. */
  pausedAt: number | null
  micOn: boolean
  micAvailable: boolean
  /** Whether a Restart counts down again, like the start did. */
  countdown: boolean
  /** Between a Restart and its new take: the bar shows a fresh, empty take. */
  restarting?: boolean
  /** What is being recorded, for the popup's "Recording this tab". */
  source: RecordSource
  /**
   * A screen or window shows whatever tab the reporter goes to: every other tab that was active during the
   * recording, whose logs go in too. Always empty when recording a tab.
   */
  tabs: number[]
  /** Where the recording stops by itself; absent on one started before 0.8.1, which stops at MAX_RECORDING_MS. */
  maxMs?: number
}

/** Kept in storage.session, so a recording survives the service worker going to sleep. */
export interface RecordingStateStore {
  get(): Promise<RecordingState | null>
  set(state: RecordingState): Promise<void>
  clear(): Promise<void>
}

export type RecordingStatus =
  | { recording: false }
  | { recording: true; draftId: string; tabId: number; startedAt: number }

/** What the popup shows while a recording runs. */
export type PopupRecordingStatus =
  | { recording: false }
  | { recording: true; source: RecordSource; tabId: number; elapsedMs: number; paused: boolean; logs: boolean; counts: LiveCounts }

/** What the Recording Bar shows. */
export interface BarStatus {
  recording: boolean
  /** Recording time so far, without paused time. */
  elapsedMs: number
  paused: boolean
  errors: number
  micOn: boolean
  micAvailable: boolean
  /** The account's length limit, shown next to the timer; null at the 20-minute ceiling everyone has. */
  maxMs: number | null
}

/** Also reads the state saved by older versions, which only knew whether the tab navigated. */
export function recordingStateFrom(value: unknown): RecordingState | null {
  if (typeof value !== "object" || value === null) return null
  const state = value as Record<string, unknown>
  if (typeof state.draftId !== "string" || typeof state.tabId !== "number" || typeof state.startedAt !== "number") return null
  const loads = typeof state.loads === "number" && state.loads >= 0 ? state.loads : state.navigated === true ? 1 : 0
  return {
    draftId: state.draftId,
    tabId: state.tabId,
    startedAt: state.startedAt,
    loads,
    logs: state.logs !== false,
    pauses: Array.isArray(state.pauses) ? (state.pauses as PauseSpan[]) : [],
    pausedAt: typeof state.pausedAt === "number" ? state.pausedAt : null,
    micOn: state.micOn === true,
    micAvailable: state.micAvailable === true,
    countdown: state.countdown === true,
    restarting: state.restarting === true,
    source: state.source === "screen" || state.source === "window" ? state.source : "tab",
    tabs: Array.isArray(state.tabs) ? state.tabs.filter((id): id is number => typeof id === "number") : [],
    ...(typeof state.maxMs === "number" && Number.isFinite(state.maxMs) && state.maxMs > 0 ? { maxMs: state.maxMs } : {}),
  }
}

export function isRecordingState(value: unknown): value is RecordingState {
  return recordingStateFrom(value) !== null
}

/** Every pause so far, the running one ending at `now`. */
export function pausesUntil(state: RecordingState, now: number): PauseSpan[] {
  return state.pausedAt === null ? state.pauses : [...state.pauses, { start: state.pausedAt, end: now }]
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`
}

/** Whether a tab's logs belong to the recording: the recorded tab, or one the reporter went to on screen. */
export function logsFrom(state: RecordingState, tabId: number): boolean {
  return (state.tabId === tabId && state.logs) || state.tabs.includes(tabId)
}

/** Whether any tab of the recording supplies logs. */
export function hasLogs(state: RecordingState): boolean {
  return state.logs || state.tabs.length > 0
}
