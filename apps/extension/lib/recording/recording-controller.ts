import type { CaptureEvent } from "@bugberry/capture"
import { type ActiveTab, type CaptureResult, sanitizePageCapture } from "../capture/capture-flow"
import { errorsCaught, type LiveCounts, liveCounts, videoTime } from "../review/review-data"
import type { RecordOptions } from "../shared/messages"
import { MAX_RECORDING_MS, type RecordingEndReason } from "./recorder"
import {
  addRecordingNote,
  discardRecording,
  noteActiveTab,
  noteNavigation,
  notePageFlush,
  pauseRecording,
  type RecordingFlowDeps,
  recordingStatus,
  restartRecording,
  resumeRecording,
  setRecordingMic,
  startVideoRecording,
  stopVideoRecording,
} from "./recording-flow"
import { type BarStatus, hasLogs, type PopupRecordingStatus, pausesUntil, type RecordingState, type RecordingStatus } from "./recording-state"

const ERRORS_READ_MS = 2000

export interface RecordingController {
  start(tab: ActiveTab, options: RecordOptions & { maxBytes: number; maxMs: number }): Promise<CaptureResult>
  stop(reason?: RecordingEndReason, opts?: { review?: boolean }): Promise<CaptureResult>
  status(): Promise<RecordingStatus>
  noteNavigation(tabId: number): Promise<void>
  notePageFlush(tabId: number, raw: unknown): Promise<void>
  noteActiveTab(tabId: number): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  setMic(on: boolean): Promise<void>
  addNote(text: string): Promise<{ n: number } | null>
  restart(): Promise<CaptureResult>
  discard(): Promise<CaptureResult>
  barStatus(): Promise<BarStatus>
  popupStatus(): Promise<PopupRecordingStatus>
}

const NO_COUNTS: LiveCounts = { errors: 0, failedRequests: 0, actions: 0 }

const QUIET: BarStatus = { recording: false, elapsedMs: 0, paused: false, errors: 0, micOn: false, micAvailable: false, maxMs: null }

/**
 * Runs every change one after another. The popup, the bar, the shortcuts and the time limit can ask at
 * the same moment; without a queue a start could pass the "already recording" check, or reach the
 * offscreen document while the previous video is still being saved. The bar's status only reads, so it
 * doesn't wait in the queue.
 */
export function createRecordingController(deps: RecordingFlowDeps): RecordingController {
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation)
    queue = next.catch(() => undefined)
    return next
  }

  // The page is read for the error count at most every 2 s.
  let pageEvents: { draftId: string; at: number; events: CaptureEvent[] } | null = null
  const liveEvents = async (state: RecordingState): Promise<CaptureEvent[]> => {
    const now = deps.now()
    if (pageEvents?.draftId === state.draftId && now - pageEvents.at < ERRORS_READ_MS) return pageEvents.events
    // The pages open now in every tab of the recording, and the ones already left behind.
    const open = await Promise.all(
      [...(state.logs ? [state.tabId] : []), ...state.tabs].map(async (tabId) => {
        const page = sanitizePageCapture(await deps.readPageCapture(tabId).catch(() => null))
        return page?.status === "ok" ? page.events : []
      }),
    )
    const draft = await deps.store.get(state.draftId)
    const flushed = draft?.captureType === "video" ? (draft.pages ?? []).flatMap((stored) => stored.events) : []
    pageEvents = { draftId: state.draftId, at: now, events: [...flushed, ...open.flat()] }
    return pageEvents.events
  }

  return {
    start: (tab, options) => enqueue(() => startVideoRecording(tab, options, deps)),
    stop: (reason, opts) => enqueue(() => stopVideoRecording(deps, reason, opts)),
    status: () => enqueue(() => recordingStatus(deps)),
    noteNavigation: (tabId) => enqueue(() => noteNavigation(tabId, deps)),
    notePageFlush: (tabId, raw) => enqueue(() => notePageFlush(tabId, raw, deps)),
    noteActiveTab: (tabId) => enqueue(() => noteActiveTab(tabId, deps)),
    pause: () => enqueue(() => pauseRecording(deps)),
    resume: () => enqueue(() => resumeRecording(deps)),
    setMic: (on) => enqueue(() => setRecordingMic(on, deps)),
    addNote: (text) => enqueue(() => addRecordingNote(text, deps)),
    restart: () => enqueue(() => restartRecording(deps)),
    discard: () => enqueue(() => discardRecording(deps)),
    barStatus: async () => {
      const state = await deps.state.get()
      if (!state) return QUIET
      const maxMs = state.maxMs !== undefined && state.maxMs < MAX_RECORDING_MS ? state.maxMs : null
      if (state.restarting) return { ...QUIET, recording: true, micOn: state.micOn, micAvailable: state.micAvailable, maxMs }
      const now = deps.now()
      const pauses = pausesUntil(state, now)
      const errors = hasLogs(state) ? errorsCaught(await liveEvents(state), state.startedAt, pauses) : 0
      return {
        recording: true,
        elapsedMs: videoTime(now, state.startedAt, pauses),
        paused: state.pausedAt !== null,
        errors,
        micOn: state.micOn,
        micAvailable: state.micAvailable,
        maxMs,
      }
    },
    popupStatus: async () => {
      const state = await deps.state.get()
      if (!state) return { recording: false }
      const base = { recording: true as const, source: state.source, tabId: state.tabId, logs: hasLogs(state) }
      if (state.restarting) return { ...base, elapsedMs: 0, paused: false, counts: NO_COUNTS }
      const now = deps.now()
      const pauses = pausesUntil(state, now)
      return {
        ...base,
        elapsedMs: videoTime(now, state.startedAt, pauses),
        paused: state.pausedAt !== null,
        counts: hasLogs(state) ? liveCounts(await liveEvents(state), state.startedAt, pauses) : NO_COUNTS,
      }
    },
  }
}
