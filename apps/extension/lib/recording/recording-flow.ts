import { DEBUGGER_PAYLOAD_VERSION, type DebuggerPayload, redactUrl } from "@bugberry/capture"
import { type ActiveTab, type CaptureResult, capturable, pagePayloadFor, sanitizePageCapture } from "../capture/capture-flow"
import { deviceInfoFrom } from "../capture/device"
import type { DraftStore } from "../drafts/draft-store"
import type { CameraChoice, CaptureSource, OffscreenMessage, RecordOptions } from "../shared/messages"
import { capPages, mergePages, type PageCaptureRecord } from "./page-merge"
import { applyPauses, keptEvents, type PauseSpan, pauseMarks, videoTime } from "../review/review-data"
import { MAX_RECORDING_MS, type RecordingEndReason } from "./recorder"
import { logsFrom, pausesUntil, type RecordingState, type RecordingStateStore, type RecordingStatus } from "./recording-state"
import type { VideoDraft } from "../shared/types"

export type { RecordOptions } from "../shared/messages"

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
  /**
   * Shows the camera bubble on the tab. `ready` settles once it shows a picture, can't, or a short while
   * passed; it never rejects. Apart from the Recording Bar: a Restart rebuilds the bar, the camera stays on.
   */
  showCamera(tabId: number, camera: CameraChoice): Promise<{ ready: Promise<void> }>
  /** Takes the camera bubble off the tab and turns the camera off; nothing happens when there is none. */
  hideCamera(tabId: number): Promise<void>
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
const PAGE_READ_MS = 2000

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

export async function recordingStatus(deps: Pick<RecordingFlowDeps, "state">): Promise<RecordingStatus> {
  const state = await deps.state.get()
  return state ? { recording: true, draftId: state.draftId, tabId: state.tabId, startedAt: state.startedAt } : { recording: false }
}

/** Called when a tab starts loading a page; only the recorded tab matters. */
export async function noteNavigation(tabId: number, deps: Pick<RecordingFlowDeps, "state">): Promise<void> {
  const state = await deps.state.get()
  if (state && state.tabId === tabId) await deps.state.set({ ...state, loads: state.loads + 1 })
}

/** A tab became active (or its window got the focus): during a screen or window recording, its logs go in too. */
export async function noteActiveTab(tabId: number, deps: Pick<RecordingFlowDeps, "state">): Promise<void> {
  const state = await deps.state.get()
  if (!state || state.source === "tab" || state.tabId === tabId || state.tabs.includes(tabId)) return
  await deps.state.set({ ...state, tabs: [...state.tabs, tabId] })
}

/** A page of a tab in the recording is going away: keep its events in the draft until the recording stops. */
export async function notePageFlush(
  tabId: number,
  raw: unknown,
  deps: Pick<RecordingFlowDeps, "state" | "store" | "now">,
): Promise<void> {
  const state = await deps.state.get()
  if (!state || !logsFrom(state, tabId) || typeof raw !== "object" || raw === null) return
  const page = sanitizePageCapture({ ...(raw as Record<string, unknown>), status: "ok" })
  if (page?.status !== "ok" || !page.documentId) return
  const draft = await deps.store.get(state.draftId)
  if (draft?.captureType !== "video") return
  // Paused events (and an earlier take's) never take room under the caps: they would be dropped at stop anyway.
  const events = keptEvents(page.events, state.startedAt, pausesUntil(state, deps.now()))
  const record: PageCaptureRecord = { documentId: page.documentId, tabId, events, incomplete: page.incomplete }
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
  options: RecordOptions & { maxBytes: number; maxMs: number },
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
    opened = await ask(deps, { type: "bugberry:offscreen-open", draftId: draft.id, capture, mic: options.mic, micDeviceId: options.micDeviceId ?? null, maxBytes: options.maxBytes, maxMs: options.maxMs })
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
  // Before the countdown, so the camera warms up while it counts. A camera that fails costs nothing else.
  const camera = options.camera ? await deps.showCamera(tab.id, options.camera).catch(() => null) : null
  if (options.countdown && (await deps.countdown(tab.id)) === "cancel") {
    await deps.hideCamera(tab.id).catch(() => {})
    await abandon(draft.id, deps)
    return { ok: false, code: "cancelled", error: "Cancelled" }
  }
  // The first second of the take shows the reporter, not an empty bubble.
  await camera?.ready.catch(() => {})
  const begun = await ask(deps, { type: "bugberry:offscreen-begin" })
  if (!begun.ok) {
    await deps.hideCamera(tab.id).catch(() => {})
    await abandon(draft.id, deps)
    return { ok: false, error: `Couldn't start recording: ${begun.error}` }
  }

  const startedAt = begun.startedAt ?? deps.now()
  try {
    if (options.mic && opened.micOn === false) await deps.micUnavailable()
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
      tabs: [],
      maxMs: options.maxMs,
    })
  } catch (error) {
    // Without a recording state no Stop or Discard will come to turn the camera off.
    await deps.hideCamera(tab.id).catch(() => {})
    throw error
  }
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
  await deps.hideCamera(state.tabId).catch(() => {})
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

/**
 * `reason`: why the recording ended by itself; absent when the reporter stopped it. `review: false` leaves the
 * review closed, for the agent recorder, which reads the draft itself.
 */
export async function stopVideoRecording(
  deps: RecordingFlowDeps,
  reason?: RecordingEndReason,
  opts: { review?: boolean } = {},
): Promise<CaptureResult> {
  const openReview = opts.review === false ? async () => {} : deps.openReview
  const state = await deps.state.get()
  if (!state) return { ok: false, error: "No recording is running" }
  // The review says why a recording ended before the reporter stopped it.
  const stoppedBy = {
    ...(reason === "max-duration" ? { stoppedAtLimitMs: state.maxMs ?? MAX_RECORDING_MS } : {}),
    // The agent recorder tells the agent why: a size limit or a closed tab cut the recording short too.
    ...(reason ? { endReason: reason } : {}),
  }
  const end = deps.now()
  // Cleared first, so a second stop (shortcut plus time limit) finds nothing to do.
  await deps.state.clear()
  await deps.setBadge(false)
  await deps.showRecordingUi(state.tabId, false)
  await deps.hideCamera(state.tabId).catch(() => {})

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
  // The recorded tab first (when it is a web page), then every other tab the reporter went to on screen.
  const logTabs = [...(state.logs ? [state.tabId] : []), ...state.tabs]
  const stored = draft.pages ?? []

  if (logTabs.length === 0 && stored.length === 0) {
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
      ...stoppedBy,
      status: "editing",
      error: null,
    })
    await openReview(state.draftId, state.tabId)
    return { ok: true, draftId: state.draftId }
  }

  // Pages left during the recording flushed their events on the way out; the pages open now are read here.
  const keep = { since: state.startedAt, pauses }
  const [first, ...others] = logTabs
  const { payload, documentId } =
    first === undefined
      ? { payload: emptyPayload(state.startedAt, deps.now()), documentId: null }
      : await pagePayloadFor(first, deps, state.startedAt, keep)
  const current: PageCaptureRecord[] = documentId ? [{ documentId, tabId: first, events: payload.events, incomplete: payload.incomplete }] : []
  for (const tabId of others) {
    const page = await openPage(tabId, keep, deps)
    if (page) current.push(page)
  }
  const merged = mergePages(stored, current)
  // Every load of the recorded tab since the start should have left a flushed page behind; one that did not lost its events.
  const flushedEarlier = stored.filter((page) => (page.tabId ?? state.tabId) === state.tabId && page.documentId !== documentId).length
  const incomplete = [...new Set([...payload.incomplete, ...merged.incomplete])]
  if (state.logs && state.loads > flushedEarlier) incomplete.push("navigated")
  const events = documentId ? merged.events : [...merged.events, ...payload.events].sort((a, b) => a.t - b.t)
  const { pages: _flushed, liveNotes: _notes, ...rest } = draft
  await deps.store.put({
    ...rest,
    // Nothing from before this take or from a pause is sent; the rest lines up with the cut video.
    debuggerPayload: { ...payload, events: applyPauses(events, state.startedAt, pauses), incomplete, ...added },
    recordingStartedAt: state.startedAt,
    ...stoppedBy,
    status: "editing",
    error: null,
  })
  await openReview(state.draftId, state.tabId)
  return { ok: true, draftId: state.draftId }
}

function emptyPayload(recordingStartedAt: number, capturedAt: number): DebuggerPayload {
  return { version: DEBUGGER_PAYLOAD_VERSION, capturedAt, recordingStartedAt, events: [], incomplete: [] }
}

/** The page open now in another tab of the recording; null when it is closed, not a web page, or silent. */
async function openPage(
  tabId: number,
  keep: { since: number; pauses: PauseSpan[] },
  deps: Pick<RecordingFlowDeps, "readPageCapture" | "pageReadTimeoutMs">,
): Promise<PageCaptureRecord | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const raw = await Promise.race([
    deps.readPageCapture(tabId, keep).catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), deps.pageReadTimeoutMs ?? PAGE_READ_MS)
    }),
  ])
  clearTimeout(timer)
  const page = sanitizePageCapture(raw)
  return page?.status === "ok" && page.documentId ? { documentId: page.documentId, tabId, events: page.events, incomplete: page.incomplete } : null
}
