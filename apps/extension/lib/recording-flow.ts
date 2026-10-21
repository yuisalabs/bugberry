import { type CaptureEvent, DEBUGGER_PAYLOAD_VERSION, type DebuggerPayload, redactUrl } from "@bugberry/capture"
import { type ActiveTab, type CaptureResult, capturable, pagePayloadFor, sanitizePageCapture } from "./capture-flow"
import { deviceInfoFrom } from "./device"
import type { DraftStore } from "./draft-store"
import type { RecordSource } from "./capture-prefs"
import type { CaptureSource, OffscreenMessage, RecordOptions } from "./messages"
import { capPages, mergePages, type PageCaptureRecord } from "./page-merge"
import { applyPauses, errorsCaught, keptEvents, type LiveCounts, liveCounts, type PauseSpan, pauseMarks, videoTime } from "./review-data"
import type { VideoDraft } from "./types"

export type { RecordOptions } from "./messages"

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
}

export interface RecordingFlowDeps {
  getStreamId(tabId: number): Promise<string>
  ensureOffscreen(): Promise<void>
  closeOffscreen(): Promise<void>
  /** Raw reply of the offscreen document; validated before use. */
  sendToOffscreen(message: OffscreenMessage): Promise<unknown>
  /** Global, not per tab: Chrome clears per-tab badges whenever the recorded tab navigates. */
  setBadge(recording: boolean): Promise<void>
  readPageCapture(tabId: number, keep?: { since: number; pauses: PauseSpan[] }): Promise<unknown>
  readEnvironment(tabId: number): Promise<unknown>
  /** The 3-2-1 on the page; "unavailable" when the page can't show it (then recording starts at once). */
  countdown(tabId: number): Promise<"done" | "cancel" | "unavailable">
  /** Shows or removes the Recording Bar and the drawing layer on the recorded tab. */
  showRecordingUi(tabId: number, on: boolean): Promise<void>
  /** The review modal over the tab, or in a tab of its own when the page can't show it. */
  openReview(draftId: string, tabId: number): Promise<void>
  /** The signed-in name written on notes; "" when unknown. */
  author(): Promise<string>
  /** Brings the recorded tab's window to the front once the source is open (Firefox's recorder window took focus). */
  focusTab?(tab: ActiveTab): Promise<void>
  /** The microphone was asked for but couldn't be opened: the recording runs without it, so "Mic on" would be wrong. */
  micUnavailable(): Promise<void>
  state: RecordingStateStore
  store: DraftStore
  pageReadTimeoutMs?: number
  userAgent: string
  now(): number
  newId(): string
}

type OffscreenReply =
  | { ok: true; startedAt: number | null; micOn: boolean | null; micAvailable: boolean }
  | { ok: false; error: string; cancelled?: boolean }

const NOTE_MAX = 500
const ERRORS_READ_MS = 2000

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
  }
}

export function isRecordingState(value: unknown): value is RecordingState {
  return recordingStateFrom(value) !== null
}

/** Every pause so far, the running one ending at `now`. */
function pausesUntil(state: RecordingState, now: number): PauseSpan[] {
  return state.pausedAt === null ? state.pauses : [...state.pauses, { start: state.pausedAt, end: now }]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function ask(deps: RecordingFlowDeps, message: OffscreenMessage): Promise<OffscreenReply> {
  let raw: unknown
  try {
    raw = await deps.sendToOffscreen(message)
  } catch (error) {
    return { ok: false, error: messageOf(error) }
  }
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "The recorder didn't answer" }
  const reply = raw as Record<string, unknown>
  if (reply.ok !== true) {
    return { ok: false, error: typeof reply.error === "string" ? reply.error : "The recorder failed", cancelled: reply.code === "cancelled" }
  }
  const startedAt = typeof reply.startedAt === "number" && Number.isFinite(reply.startedAt) ? reply.startedAt : null
  return { ok: true, startedAt, micOn: typeof reply.micOn === "boolean" ? reply.micOn : null, micAvailable: reply.micAvailable === true }
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`
}

export async function recordingStatus(deps: Pick<RecordingFlowDeps, "state">): Promise<RecordingStatus> {
  const state = await deps.state.get()
  return state ? { recording: true, draftId: state.draftId, tabId: state.tabId, startedAt: state.startedAt } : { recording: false }
}

/** Called when a tab starts loading a page; only the recorded tab matters. */
export async function noteNavigation(tabId: number, deps: Pick<RecordingFlowDeps, "state">): Promise<void> {
  const state = await deps.state.get()
  if (state && state.tabId === tabId) await deps.state.set({ ...state, loads: state.loads + 1 })
}

/** A page of the recorded tab is going away: keep its events in the draft until the recording stops. */
export async function notePageFlush(
  tabId: number,
  raw: unknown,
  deps: Pick<RecordingFlowDeps, "state" | "store" | "now">,
): Promise<void> {
  const state = await deps.state.get()
  if (!state || state.tabId !== tabId || typeof raw !== "object" || raw === null) return
  const page = sanitizePageCapture({ ...(raw as Record<string, unknown>), status: "ok" })
  if (page?.status !== "ok" || !page.documentId) return
  const draft = await deps.store.get(state.draftId)
  if (draft?.captureType !== "video") return
  // Paused events (and an earlier take's) never take room under the caps: they would be dropped at stop anyway.
  const events = keptEvents(page.events, state.startedAt, pausesUntil(state, deps.now()))
  const record: PageCaptureRecord = { documentId: page.documentId, events, incomplete: page.incomplete }
  const pages = (draft.pages ?? []).filter((stored) => stored.documentId !== record.documentId)
  await deps.store.put({ ...draft, pages: capPages([...pages, record]) })
}

/** Drops the opened source, the offscreen document and the draft: nothing of this recording is kept. */
async function abandon(draftId: string, deps: RecordingFlowDeps): Promise<void> {
  await ask(deps, { type: "bugberry:offscreen-discard" })
  await deps.closeOffscreen()
  await deps.store.delete(draftId)
}

/**
 * A tab is recorded through tabCapture, so it must be a web page. A screen or window may be recorded
 * from any tab; that tab only supplies the logs, and a tab that isn't a web page supplies none.
 * The source opens first (Chrome's share picker for a screen or window), then the countdown, then the take.
 */
export async function startVideoRecording(
  tab: ActiveTab,
  options: RecordOptions & { maxBytes: number },
  deps: RecordingFlowDeps,
): Promise<CaptureResult> {
  if (await deps.state.get()) {
    return { ok: false, code: "already-recording", error: "Another recording is still running. Stop it first (Alt+Shift+S)." }
  }
  const logs = capturable(tab.url)
  if (options.source === "tab" && !logs) {
    return { ok: false, error: "This page can't be recorded. Open a regular web page (http/https)." }
  }

  let capture: CaptureSource
  if (options.source === "tab") {
    try {
      capture = { kind: "tab", streamId: await deps.getStreamId(tab.id) }
    } catch (error) {
      return { ok: false, error: `Couldn't start recording: ${messageOf(error)}` }
    }
  } else {
    capture = { kind: "display", surface: options.source === "screen" ? "monitor" : "window", systemAudio: options.systemAudio }
  }

  const draft: VideoDraft = {
    id: deps.newId(),
    createdAt: deps.now(),
    captureType: "video",
    page: { url: tab.url ? redactUrl(tab.url) : "about:blank", title: tab.title ?? "" },
    device: deviceInfoFrom(deps.userAgent, { width: tab.width, height: tab.height }),
    video: null,
    durationMs: null,
    recordingStartedAt: null,
    debuggerPayload: null,
    debuggerGzip: null,
    status: "recording",
    error: null,
    session: null,
    form: null,
    tabId: tab.id,
  }
  await deps.store.put(draft)

  let opened: OffscreenReply
  try {
    await deps.ensureOffscreen()
    opened = await ask(deps, { type: "bugberry:offscreen-open", draftId: draft.id, capture, mic: options.mic, micDeviceId: options.micDeviceId ?? null, maxBytes: options.maxBytes })
  } catch (error) {
    opened = { ok: false, error: messageOf(error) }
  }
  if (!opened.ok) {
    await deps.store.delete(draft.id)
    await deps.closeOffscreen()
    if (opened.cancelled) return { ok: false, code: "cancelled", error: "Cancelled" }
    return { ok: false, error: `Couldn't start recording: ${opened.error}` }
  }

  await deps.focusTab?.(tab).catch(() => {})
  if (options.countdown && (await deps.countdown(tab.id)) === "cancel") {
    await abandon(draft.id, deps)
    return { ok: false, code: "cancelled", error: "Cancelled" }
  }
  const begun = await ask(deps, { type: "bugberry:offscreen-begin" })
  if (!begun.ok) {
    await abandon(draft.id, deps)
    return { ok: false, error: `Couldn't start recording: ${begun.error}` }
  }

  if (options.mic && opened.micOn === false) await deps.micUnavailable()
  const startedAt = begun.startedAt ?? deps.now()
  await deps.store.put({ ...draft, recordingStartedAt: startedAt })
  await deps.state.set({
    draftId: draft.id,
    tabId: tab.id,
    startedAt,
    loads: 0,
    logs,
    pauses: [],
    pausedAt: null,
    micOn: opened.micOn === true,
    micAvailable: opened.micAvailable,
    countdown: options.countdown,
    source: options.source,
  })
  await deps.setBadge(true)
  await deps.showRecordingUi(tab.id, true)
  return { ok: true, draftId: draft.id }
}

export async function pauseRecording(deps: RecordingFlowDeps): Promise<void> {
  const state = await deps.state.get()
  if (!state || state.pausedAt !== null) return
  const reply = await ask(deps, { type: "bugberry:offscreen-pause" })
  if (reply.ok) await deps.state.set({ ...state, pausedAt: deps.now() })
}

export async function resumeRecording(deps: RecordingFlowDeps): Promise<void> {
  const state = await deps.state.get()
  if (!state || state.pausedAt === null) return
  const reply = await ask(deps, { type: "bugberry:offscreen-resume" })
  if (reply.ok) await deps.state.set({ ...state, pauses: pausesUntil(state, deps.now()), pausedAt: null })
}

export async function setRecordingMic(on: boolean, deps: RecordingFlowDeps): Promise<void> {
  const state = await deps.state.get()
  if (!state) return
  const reply = await ask(deps, { type: "bugberry:offscreen-mic", on })
  if (reply.ok) await deps.state.set({ ...state, micOn: reply.micOn === true })
}

export async function addRecordingNote(text: string, deps: RecordingFlowDeps): Promise<{ n: number } | null> {
  const state = await deps.state.get()
  if (!state) return null
  const now = deps.now()
  const draft = await deps.store.get(state.draftId)
  if (draft?.captureType !== "video") return null
  const notes = draft.liveNotes ?? []
  const note = { n: notes.length + 1, atMs: videoTime(now, state.startedAt, pausesUntil(state, now)), text: text.slice(0, NOTE_MAX) }
  await deps.store.put({ ...draft, liveNotes: [...notes, note] })
  return { n: note.n }
}

/** A new take on the same source: what was recorded so far (video, logs, pauses, notes) is gone. */
export async function restartRecording(deps: RecordingFlowDeps): Promise<CaptureResult> {
  const state = await deps.state.get()
  if (!state) return { ok: false, error: "No recording is running" }
  await ask(deps, { type: "bugberry:offscreen-restart" })
  // A fresh page layer: the deleted take's pins and strokes must not show (or be recorded) in the new one.
  await deps.showRecordingUi(state.tabId, false)
  await deps.showRecordingUi(state.tabId, true)
  const draft = await deps.store.get(state.draftId)
  if (draft?.captureType === "video") await deps.store.put({ ...draft, pages: [], liveNotes: [] })
  await deps.state.set({ ...state, restarting: true })
  if (state.countdown && (await deps.countdown(state.tabId)) === "cancel") return discardRecording(deps)
  const begun = await ask(deps, { type: "bugberry:offscreen-begin" })
  if (!begun.ok) return discardRecording(deps)
  const startedAt = begun.startedAt ?? deps.now()
  await deps.state.set({ ...state, startedAt, loads: 0, pauses: [], pausedAt: null, restarting: false })
  const current = await deps.store.get(state.draftId)
  if (current?.captureType === "video") await deps.store.put({ ...current, recordingStartedAt: startedAt })
  return { ok: true, draftId: state.draftId }
}

/** Throws the recording away: nothing is saved, not even a draft. */
export async function discardRecording(deps: RecordingFlowDeps): Promise<CaptureResult> {
  const state = await deps.state.get()
  if (!state) return { ok: false, error: "No recording is running" }
  await deps.state.clear()
  await deps.setBadge(false)
  await abandon(state.draftId, deps)
  await deps.showRecordingUi(state.tabId, false)
  return { ok: false, code: "cancelled", error: "Discarded" }
}

/** The payload's notes and pauses, written once the recording ends. */
async function extras(
  state: RecordingState,
  notes: NonNullable<VideoDraft["liveNotes"]>,
  end: number,
  deps: RecordingFlowDeps,
): Promise<Pick<DebuggerPayload, "notes" | "pauses">> {
  const author = notes.length > 0 ? await deps.author().catch(() => "") : ""
  return {
    notes: notes.map((note) => ({ ...note, author })),
    pauses: pauseMarks(state.startedAt, pausesUntil(state, end)),
  }
}

export async function stopVideoRecording(deps: RecordingFlowDeps): Promise<CaptureResult> {
  const state = await deps.state.get()
  if (!state) return { ok: false, error: "No recording is running" }
  const end = deps.now()
  // Cleared first, so a second stop (shortcut plus time limit) finds nothing to do.
  await deps.state.clear()
  await deps.setBadge(false)
  await deps.showRecordingUi(state.tabId, false)

  const reply = await ask(deps, { type: "bugberry:offscreen-stop" })
  await deps.closeOffscreen()
  const draft = await deps.store.get(state.draftId)
  if (!reply.ok || draft?.captureType !== "video" || !draft.video) {
    const error = `Couldn't save the recording: ${reply.ok ? "video not found" : reply.error}`
    if (draft) await deps.store.put({ ...draft, status: "failed", error })
    return { ok: false, error }
  }
  const pauses = pausesUntil(state, end)
  const added = await extras(state, draft.liveNotes ?? [], end, deps)

  if (!state.logs) {
    const { pages: _none, liveNotes: _notes, ...rest } = draft
    await deps.store.put({
      ...rest,
      debuggerPayload: {
        version: DEBUGGER_PAYLOAD_VERSION,
        capturedAt: deps.now(),
        recordingStartedAt: state.startedAt,
        events: [],
        incomplete: ["not-web-page"],
        ...added,
      },
      recordingStartedAt: state.startedAt,
      status: "editing",
      error: null,
    })
    await deps.openReview(state.draftId, state.tabId)
    return { ok: true, draftId: state.draftId }
  }

  // Pages the tab left flushed their events on the way out; the page open now is read here.
  const { payload, documentId } = await pagePayloadFor(state.tabId, deps, state.startedAt, { since: state.startedAt, pauses })
  const stored = draft.pages ?? []
  const current = documentId ? { documentId, events: payload.events, incomplete: payload.incomplete } : null
  const merged = mergePages(stored, current)
  // Every load since the start should have left a flushed page behind; one that did not lost its events.
  const flushedEarlier = stored.filter((page) => page.documentId !== documentId).length
  const incomplete = [...new Set([...payload.incomplete, ...merged.incomplete])]
  if (state.loads > flushedEarlier) incomplete.push("navigated")
  const events = current ? merged.events : [...merged.events, ...payload.events]
  const { pages: _flushed, liveNotes: _notes, ...rest } = draft
  await deps.store.put({
    ...rest,
    // Nothing from before this take or from a pause is sent; the rest lines up with the cut video.
    debuggerPayload: { ...payload, events: applyPauses(events, state.startedAt, pauses), incomplete, ...added },
    recordingStartedAt: state.startedAt,
    status: "editing",
    error: null,
  })
  await deps.openReview(state.draftId, state.tabId)
  return { ok: true, draftId: state.draftId }
}

export interface RecordingController {
  start(tab: ActiveTab, options: RecordOptions & { maxBytes: number }): Promise<CaptureResult>
  stop(): Promise<CaptureResult>
  status(): Promise<RecordingStatus>
  noteNavigation(tabId: number): Promise<void>
  notePageFlush(tabId: number, raw: unknown): Promise<void>
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

const QUIET: BarStatus = { recording: false, elapsedMs: 0, paused: false, errors: 0, micOn: false, micAvailable: false }

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
    const page = sanitizePageCapture(await deps.readPageCapture(state.tabId).catch(() => null))
    const draft = await deps.store.get(state.draftId)
    const flushed = draft?.captureType === "video" ? (draft.pages ?? []).flatMap((stored) => stored.events) : []
    pageEvents = { draftId: state.draftId, at: now, events: [...flushed, ...(page?.status === "ok" ? page.events : [])] }
    return pageEvents.events
  }

  return {
    start: (tab, options) => enqueue(() => startVideoRecording(tab, options, deps)),
    stop: () => enqueue(() => stopVideoRecording(deps)),
    status: () => enqueue(() => recordingStatus(deps)),
    noteNavigation: (tabId) => enqueue(() => noteNavigation(tabId, deps)),
    notePageFlush: (tabId, raw) => enqueue(() => notePageFlush(tabId, raw, deps)),
    pause: () => enqueue(() => pauseRecording(deps)),
    resume: () => enqueue(() => resumeRecording(deps)),
    setMic: (on) => enqueue(() => setRecordingMic(on, deps)),
    addNote: (text) => enqueue(() => addRecordingNote(text, deps)),
    restart: () => enqueue(() => restartRecording(deps)),
    discard: () => enqueue(() => discardRecording(deps)),
    barStatus: async () => {
      const state = await deps.state.get()
      if (!state) return QUIET
      if (state.restarting) return { ...QUIET, recording: true, micOn: state.micOn, micAvailable: state.micAvailable }
      const now = deps.now()
      const pauses = pausesUntil(state, now)
      const errors = state.logs ? errorsCaught(await liveEvents(state), state.startedAt, pauses) : 0
      return {
        recording: true,
        elapsedMs: videoTime(now, state.startedAt, pauses),
        paused: state.pausedAt !== null,
        errors,
        micOn: state.micOn,
        micAvailable: state.micAvailable,
      }
    },
    popupStatus: async () => {
      const state = await deps.state.get()
      if (!state) return { recording: false }
      const base = { recording: true as const, source: state.source, tabId: state.tabId, logs: state.logs }
      if (state.restarting) return { ...base, elapsedMs: 0, paused: false, counts: NO_COUNTS }
      const now = deps.now()
      const pauses = pausesUntil(state, now)
      return {
        ...base,
        elapsedMs: videoTime(now, state.startedAt, pauses),
        paused: state.pausedAt !== null,
        counts: state.logs ? liveCounts(await liveEvents(state), state.startedAt, pauses) : NO_COUNTS,
      }
    },
  }
}
