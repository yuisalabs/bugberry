import { MAX_RECORDING_MS } from "../../lib/recording/recorder"
import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { DraftStore } from "../../lib/drafts/draft-store"
import type { OffscreenMessage } from "../../lib/messages"
import {
  createRecordingController,
  discardRecording,
  type RecordOptions,
  formatElapsed,
  type RecordingFlowDeps,
  type RecordingState,
  recordingStateFrom,
  recordingStatus,
  startVideoRecording,
  stopVideoRecording,
} from "../../lib/recording/recording-flow"
import type { ReportDraft } from "../../lib/types"

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"

const tab = {
  id: 7,
  windowId: 3,
  url: "https://app.kantor.test/checkout?session_token=abc",
  title: "Checkout",
  width: 1440,
  height: 900,
}

const TAB_OPTIONS: RecordOptions & { maxBytes: number; maxMs: number } = {
  source: "tab",
  mic: false,
  systemAudio: true,
  countdown: false,
  maxBytes: 199_229_440,
  maxMs: 120_000,
}

function memoryStore(): DraftStore & { drafts: Map<string, ReportDraft> } {
  const drafts = new Map<string, ReportDraft>()
  return {
    drafts,
    put: async (draft) => void drafts.set(draft.id, draft),
    get: async (id) => drafts.get(id) ?? null,
    list: async () => [...drafts.values()],
    delete: async (id) => void drafts.delete(id),
  }
}

function memoryState() {
  let value: RecordingState | null = null
  return {
    get: async () => value,
    set: async (state: RecordingState) => {
      value = state
    },
    clear: async () => {
      value = null
    },
    peek: () => value,
  }
}

let store: ReturnType<typeof memoryStore>
let state: ReturnType<typeof memoryState>
let sent: OffscreenMessage[]
let badges: boolean[]
let opened: string[]
let offscreenOpen: boolean
let clock: number
let offscreenReply: (message: OffscreenMessage) => unknown
let deps: RecordingFlowDeps
let micTurnedOff: number
let countdownResult: "done" | "cancel" | "unavailable"
let countdowns: number
let ui: Array<[number, boolean]>
let reviewTabs: number[]
/** The offscreen messages, the countdown and the camera, in the order they happened. */
let steps: string[]

beforeEach(() => {
  store = memoryStore()
  state = memoryState()
  sent = []
  badges = []
  opened = []
  offscreenOpen = false
  micTurnedOff = 0
  countdownResult = "done"
  countdowns = 0
  ui = []
  reviewTabs = []
  steps = []
  clock = 1000
  offscreenReply = (message) =>
    message.type === "bugberry:offscreen-open"
      ? { ok: true, micOn: false, micAvailable: false }
      : message.type === "bugberry:offscreen-begin"
        ? { ok: true, startedAt: 1500 }
        : { ok: true, durationMs: 4000 }
  deps = {
    getStreamId: async (tabId) => `stream-${tabId}`,
    ensureOffscreen: async () => {
      offscreenOpen = true
    },
    closeOffscreen: async () => {
      offscreenOpen = false
    },
    sendToOffscreen: async (message) => {
      sent.push(message)
      steps.push(message.type)
      const reply = offscreenReply(message)
      // Like the real offscreen document: the video is stored in the draft before it answers.
      if (message.type === "bugberry:offscreen-stop" && (reply as { ok?: unknown }).ok === true) {
        const draft = store.drafts.get("video-1")
        if (draft?.captureType === "video") await store.put({ ...draft, video: new Blob(["webm"]), durationMs: 4000 })
      }
      return reply
    },
    setBadge: async (recording) => void badges.push(recording),
    readPageCapture: async () => ({
      status: "ok",
      events: [{ kind: "action", t: 2000, type: "click", target: "button#pay" }],
      incomplete: [],
    }),
    readEnvironment: async () => ({ language: "en-US" }),
    openReview: async (id, tabId) => {
      opened.push(id)
      reviewTabs.push(tabId)
    },
    countdown: async () => {
      steps.push("countdown")
      countdowns += 1
      return countdownResult
    },
    showRecordingUi: async (tabId, on) => void ui.push([tabId, on]),
    showCamera: async (tabId, camera) => {
      steps.push(`camera-show ${tabId} ${camera.deviceId} ${camera.shape}`)
      return { ready: Promise.resolve() }
    },
    hideCamera: async (tabId) => void steps.push(`camera-hide ${tabId}`),
    author: async () => "Dana",
    state,
    store,
    userAgent: USER_AGENT,
    now: () => clock,
    newId: () => "video-1",
    micUnavailable: async () => {
      micTurnedOff += 1
    },
  }
})

describe("startVideoRecording", () => {
  test("creates a recording draft, starts the offscreen recorder and shows the badge", async () => {
    expect(await startVideoRecording(tab, TAB_OPTIONS, deps)).toEqual({ ok: true, draftId: "video-1" })
    expect(sent).toEqual([
      {
        type: "bugberry:offscreen-open",
        draftId: "video-1",
        capture: { kind: "tab", streamId: "stream-7" },
        mic: false,
        micDeviceId: null,
        maxBytes: 199_229_440,
        maxMs: 120_000,
      },
      { type: "bugberry:offscreen-begin" },
    ])
    expect(offscreenOpen).toBe(true)
    expect(state.peek()).toEqual({
      draftId: "video-1",
      tabId: 7,
      startedAt: 1500,
      loads: 0,
      logs: true,
      pauses: [],
      pausedAt: null,
      micOn: false,
      micAvailable: false,
      countdown: false,
      source: "tab",
      tabs: [],
      maxMs: 120_000,
    })
    expect(ui).toEqual([[7, true]])
    expect(badges).toEqual([true])
    const draft = store.drafts.get("video-1")
    expect(draft).toMatchObject({
      captureType: "video",
      status: "recording",
      video: null,
      recordingStartedAt: 1500,
      page: { title: "Checkout" },
      device: { browser: "Chrome 141", os: "Windows", viewport: "1440x900" },
    })
    expect(draft?.page.url).not.toContain("abc")
    expect(await recordingStatus(deps)).toEqual({ recording: true, draftId: "video-1", tabId: 7, startedAt: 1500 })
  })

  test("the chosen microphone goes to the recorder", async () => {
    await startVideoRecording(tab, { ...TAB_OPTIONS, micDeviceId: "abc" }, deps)
    expect(sent[0]).toMatchObject({ type: "bugberry:offscreen-open", micDeviceId: "abc" })
  })

  test("a screen recorded from a page that isn't a web page has no logs", async () => {
    const newTab = { ...tab, url: "chrome://newtab/" }
    let streamIds = 0
    deps.getStreamId = async () => `stream-${++streamIds}`
    const readPage = mock(deps.readPageCapture)
    deps.readPageCapture = readPage
    const options = { source: "screen" as const, mic: true, systemAudio: true, countdown: false, maxBytes: 1234, maxMs: 60_000 }
    expect(await startVideoRecording(newTab, options, deps)).toEqual({ ok: true, draftId: "video-1" })
    expect(sent[0]).toEqual({
      type: "bugberry:offscreen-open",
      draftId: "video-1",
      capture: { kind: "display", surface: "monitor", systemAudio: true },
      mic: true,
      micDeviceId: null,
      maxBytes: 1234,
      maxMs: 60_000,
    })
    expect(streamIds).toBe(0)
    expect(store.drafts.get("video-1")?.page.url).toBe("chrome://newtab/")
    expect(state.peek()?.logs).toBe(false)

    expect(await stopVideoRecording(deps)).toEqual({ ok: true, draftId: "video-1" })
    expect(store.drafts.get("video-1")).toMatchObject({ debuggerPayload: { events: [], incomplete: ["not-web-page"] } })
    expect(readPage).not.toHaveBeenCalled()
  })

  test("a window recording asks Chrome for a window; a tab without a URL is about:blank", async () => {
    await startVideoRecording({ ...tab, url: undefined }, { ...TAB_OPTIONS, source: "window" }, deps)
    expect(sent[0]).toMatchObject({ capture: { kind: "display", surface: "window", systemAudio: true } })
    expect(store.drafts.get("video-1")?.page.url).toBe("about:blank")
  })

  test("a cancelled share picker leaves nothing behind and is not a failure", async () => {
    offscreenReply = (message) =>
      message.type === "bugberry:offscreen-open" ? { ok: false, error: "Cancelled", code: "cancelled" } : { ok: true }
    const result = await startVideoRecording(tab, { ...TAB_OPTIONS, source: "screen" }, deps)
    expect(result).toEqual({ ok: false, code: "cancelled", error: "Cancelled" })
    expect(store.drafts.size).toBe(0)
    expect(offscreenOpen).toBe(false)
    expect(badges).toEqual([])
    expect(state.peek()).toBeNull()
  })

  test("a microphone that couldn't be opened turns the Mic choice off", async () => {
    offscreenReply = (message) =>
      message.type === "bugberry:offscreen-open" ? { ok: true, micOn: false, micAvailable: false } : { ok: true }
    expect(await startVideoRecording(tab, { ...TAB_OPTIONS, mic: true }, deps)).toMatchObject({ ok: true })
    expect(micTurnedOff).toBe(1)
  })

  test("a microphone that opened, or wasn't asked for, leaves the choice alone", async () => {
    offscreenReply = (message) =>
      message.type === "bugberry:offscreen-open" ? { ok: true, micOn: true, micAvailable: true } : { ok: true }
    await startVideoRecording(tab, { ...TAB_OPTIONS, mic: true }, deps)
    await stopVideoRecording(deps)
    offscreenReply = (message) =>
      message.type === "bugberry:offscreen-open" ? { ok: true, micOn: false, micAvailable: false } : { ok: true }
    await startVideoRecording(tab, TAB_OPTIONS, deps)
    expect(micTurnedOff).toBe(0)
  })

  test("state saved before logs existed still has logs", () => {
    expect(recordingStateFrom({ draftId: "d", tabId: 1, startedAt: 2, loads: 0 })?.logs).toBe(true)
  })

  test("pages that cannot be recorded, or a refused capture, leave nothing behind", async () => {
    expect((await startVideoRecording({ ...tab, url: "chrome://settings" }, TAB_OPTIONS, deps)).ok).toBe(false)

    deps.getStreamId = async () => {
      throw new Error("Extension has not been invoked for the current page")
    }
    expect(await startVideoRecording(tab, TAB_OPTIONS, deps)).toMatchObject({
      ok: false,
      error: expect.stringContaining("not been invoked"),
    })

    deps.getStreamId = async (tabId) => `stream-${tabId}`
    offscreenReply = () => ({ ok: false, error: "Permission denied" })
    expect(await startVideoRecording(tab, TAB_OPTIONS, deps)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Permission denied"),
    })

    expect(store.drafts.size).toBe(0)
    expect(badges).toEqual([])
    expect(state.peek()).toBeNull()
    expect(offscreenOpen).toBe(false)
  })
})

describe("recorder window hosts", () => {
  test("focusTab runs after the source opens and before the countdown", async () => {
    const order: string[] = []
    const base = deps.sendToOffscreen
    deps.sendToOffscreen = async (message) => {
      if (message.type === "bugberry:offscreen-open") order.push("open")
      return base(message)
    }
    deps.focusTab = async (focused) => void order.push(`focus-${focused.windowId}`)
    deps.countdown = async () => {
      order.push("countdown")
      return "done"
    }
    await startVideoRecording(tab, { ...TAB_OPTIONS, source: "window", countdown: true }, deps)
    expect(order).toEqual(["open", "focus-3", "countdown"])
  })

  test("a recorder that is gone mid-recording still lets the take be discarded", async () => {
    await startVideoRecording(tab, TAB_OPTIONS, deps)
    deps.sendToOffscreen = async () => {
      throw new Error("Could not establish connection. Receiving end does not exist.")
    }
    expect(await discardRecording(deps)).toMatchObject({ ok: false, code: "cancelled" })
    expect(state.peek()).toBeNull()
    expect(store.drafts.size).toBe(0)
  })
})

describe("stopVideoRecording", () => {
  test("stop without review does not open the review", async () => {
    await startVideoRecording(tab, TAB_OPTIONS, deps)
    clock = 6000
    expect(await stopVideoRecording(deps, undefined, { review: false })).toEqual({ ok: true, draftId: "video-1" })
    expect(store.drafts.get("video-1")).toMatchObject({ status: "editing", durationMs: 4000 })
    expect(opened).toEqual([])
  })

  test("the controller passes the no-review choice on", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    expect(await controller.stop(undefined, { review: false })).toMatchObject({ ok: true })
    expect(opened).toEqual([])
  })

  test("adds the page buffer, measured from the recording start, and opens the editor", async () => {
    await startVideoRecording(tab, TAB_OPTIONS, deps)
    clock = 6000
    expect(await stopVideoRecording(deps)).toEqual({ ok: true, draftId: "video-1" })
    expect(sent.at(-1)).toEqual({ type: "bugberry:offscreen-stop" })
    const draft = store.drafts.get("video-1")
    expect(draft).toMatchObject({ status: "editing", durationMs: 4000, recordingStartedAt: 1500 })
    expect(draft?.debuggerPayload).toMatchObject({ recordingStartedAt: 1500, capturedAt: 6000, incomplete: [] })
    expect(draft?.debuggerPayload?.events).toHaveLength(1)
    expect(draft?.captureType === "video" ? await draft.video?.text() : null).toBe("webm")
    expect(opened).toEqual(["video-1"])
    expect(badges.at(-1)).toBe(false)
    expect(offscreenOpen).toBe(false)
    expect(await recordingStatus(deps)).toEqual({ recording: false })
  })

  test("a second start while recording, or a stop with nothing recording, is refused", async () => {
    await startVideoRecording(tab, TAB_OPTIONS, deps)
    expect(await startVideoRecording({ ...tab, id: 8 }, TAB_OPTIONS, deps)).toMatchObject({
      ok: false,
      code: "already-recording",
      error: expect.stringContaining("still running"),
    })
    expect(sent.map((message) => message.type)).toEqual(["bugberry:offscreen-open", "bugberry:offscreen-begin"])
    expect(store.drafts.size).toBe(1)
    await stopVideoRecording(deps)
    expect(await stopVideoRecording(deps)).toMatchObject({ ok: false })
    expect(opened).toEqual(["video-1"])
  })

  test("a tab closed during recording still gives a report, marked incomplete", async () => {
    await startVideoRecording(tab, TAB_OPTIONS, deps)
    deps.readPageCapture = async () => {
      throw new Error("No tab with id: 7")
    }
    expect(await stopVideoRecording(deps)).toMatchObject({ ok: true })
    expect(store.drafts.get("video-1")?.debuggerPayload).toMatchObject({ incomplete: ["page-access"], events: [] })
  })

  test("a page that never flushed marks the report navigated", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    await controller.noteNavigation(8)
    expect(state.peek()?.loads).toBe(0)
    await controller.noteNavigation(7)
    await controller.noteNavigation(7)
    await controller.notePageFlush(7, {
      documentId: "page-1",
      events: [{ kind: "action", t: 1600, type: "click", target: "a#next" }],
      incomplete: [],
    })
    expect(await controller.stop()).toMatchObject({ ok: true })
    const payload = store.drafts.get("video-1")?.debuggerPayload
    expect(payload?.incomplete).toEqual(["navigated"])
    expect(payload?.events.map((event) => event.t)).toEqual([1600, 2000])
  })

  test("the bar shows the account's length limit; the 20-minute ceiling isn't shown", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    expect((await controller.barStatus()).maxMs).toBe(120_000)
    await controller.discard()
    await controller.start(tab, { ...TAB_OPTIONS, maxMs: MAX_RECORDING_MS })
    expect((await controller.barStatus()).maxMs).toBeNull()
  })

  test("every reason a recording ended by itself is kept on the draft", async () => {
    for (const reason of ["size-limit", "source-ended", "max-duration"] as const) {
      const controller = createRecordingController(deps)
      await controller.start(tab, TAB_OPTIONS)
      await controller.stop(reason)
      expect((store.drafts.get("video-1") as { endReason?: string }).endReason).toBe(reason)
    }
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    await controller.stop()
    expect((store.drafts.get("video-1") as { endReason?: string }).endReason).toBeUndefined()
  })

  test("stopped by the time limit, the draft says at what length", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    expect(await controller.stop("max-duration")).toMatchObject({ ok: true })
    expect((store.drafts.get("video-1") as { stoppedAtLimitMs?: number }).stoppedAtLimitMs).toBe(120_000)
  })

  test("stopped by the reporter, the draft says nothing about a limit", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    await controller.stop()
    expect((store.drafts.get("video-1") as { stoppedAtLimitMs?: number }).stoppedAtLimitMs).toBeUndefined()
  })

  test("every page flushed means one timeline and no navigated note", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    await controller.noteNavigation(7)
    await controller.notePageFlush(7, {
      documentId: "page-1",
      events: [{ kind: "action", t: 1700, type: "click", target: "button#pay" }],
      incomplete: [],
    })
    expect(await controller.stop()).toMatchObject({ ok: true })
    const draft = store.drafts.get("video-1")
    expect(draft?.debuggerPayload?.incomplete).toEqual([])
    expect(draft?.debuggerPayload?.events.map((event) => event.t)).toEqual([1700, 2000])
    expect(draft?.captureType === "video" ? draft.pages : "screenshot").toBeUndefined()
  })

  test("a page that reloads itself many times keeps the stored events bounded", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    for (let page = 0; page < 12; page++) {
      await controller.notePageFlush(7, {
        documentId: `page-${page}`,
        events: Array.from({ length: 1000 }, (_, index) => ({ kind: "action", t: page * 10_000 + index, type: "click" })),
        incomplete: [],
      })
    }
    const draft = store.drafts.get("video-1")
    const stored = draft?.captureType === "video" ? (draft.pages ?? []) : []
    expect(stored.reduce((total, page) => total + page.events.length, 0)).toBeLessThanOrEqual(5000)
    expect(stored.at(-1)?.documentId).toBe("page-11")
    expect(stored.at(-1)?.events).toHaveLength(1000)
  })

  test("a flush from another tab, or when nothing is recording, is ignored", async () => {
    const controller = createRecordingController(deps)
    const flush = { documentId: "page-x", events: [{ kind: "action", t: 1, type: "click" }], incomplete: [] }
    await controller.notePageFlush(7, flush)
    await controller.start(tab, TAB_OPTIONS)
    await controller.notePageFlush(8, flush)
    await controller.notePageFlush(7, { documentId: 42, events: "junk" })
    const draft = store.drafts.get("video-1")
    expect(draft?.captureType === "video" ? (draft.pages ?? []) : []).toEqual([])
  })

  test("a screen recording takes the logs of every tab the reporter went to", async () => {
    deps.readPageCapture = async (tabId) => ({
      status: "ok",
      documentId: `doc-${tabId}`,
      events: [{ kind: "action", t: tabId === 7 ? 2000 : 1800, type: "click", target: `tab-${tabId}` }],
      incomplete: [],
    })
    const controller = createRecordingController(deps)
    await controller.start(tab, { ...TAB_OPTIONS, source: "screen" })
    await controller.noteActiveTab(9)
    await controller.noteActiveTab(9)
    await controller.noteActiveTab(7)
    expect(state.peek()?.tabs).toEqual([9])
    // A tab visited, then left on another page (or closed): its page flushed on the way out.
    await controller.noteActiveTab(11)
    await controller.notePageFlush(11, { documentId: "doc-11-old", events: [{ kind: "action", t: 1600, type: "click", target: "tab-11" }], incomplete: [] })
    // A tab never looked at doesn't count.
    await controller.notePageFlush(12, { documentId: "doc-12", events: [{ kind: "action", t: 1700, type: "click", target: "tab-12" }], incomplete: [] })
    expect(await controller.stop()).toMatchObject({ ok: true })
    const events = store.drafts.get("video-1")?.debuggerPayload?.events ?? []
    expect(events.map((event) => (event.kind === "action" ? event.target : ""))).toEqual(["tab-11", "tab-9", "tab-11", "tab-7"])
    expect(store.drafts.get("video-1")?.debuggerPayload?.incomplete).toEqual([])
  })

  test("a tab recording keeps to its own tab", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    await controller.noteActiveTab(9)
    expect(state.peek()?.tabs).toEqual([])
    await controller.notePageFlush(9, { documentId: "doc-9", events: [{ kind: "action", t: 1600, type: "click" }], incomplete: [] })
    const draft = store.drafts.get("video-1")
    expect(draft?.captureType === "video" ? (draft.pages ?? []) : []).toEqual([])
  })

  test("a screen recording started from a new tab still gets the logs of the tabs it goes to", async () => {
    const controller = createRecordingController(deps)
    await controller.start({ ...tab, url: "chrome://newtab/" }, { ...TAB_OPTIONS, source: "screen" })
    await controller.noteActiveTab(9)
    expect(await controller.popupStatus()).toMatchObject({ logs: true })
    expect(await controller.stop()).toMatchObject({ ok: true })
    expect(store.drafts.get("video-1")?.debuggerPayload?.events).toHaveLength(1)
  })

  test("when the recorder cannot save the video, the draft is marked failed", async () => {
    await startVideoRecording(tab, TAB_OPTIONS, deps)
    offscreenReply = () => ({ ok: false, error: "No recording is running" })
    expect(await stopVideoRecording(deps)).toMatchObject({ ok: false })
    expect(store.drafts.get("video-1")).toMatchObject({ status: "failed" })
    expect(badges.at(-1)).toBe(false)
    expect(state.peek()).toBeNull()
    expect(opened).toEqual([])
  })
})

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("createRecordingController", () => {
  test("overlapping starts give one recording; the second is told one is running", async () => {
    const gate = deferred<void>()
    const send = deps.sendToOffscreen
    deps.sendToOffscreen = async (message) => {
      if (message.type === "bugberry:offscreen-open") await gate.promise
      return send(message)
    }
    let ids = 0
    deps.newId = () => `video-${++ids}`
    const controller = createRecordingController(deps)
    const first = controller.start(tab, TAB_OPTIONS)
    const second = controller.start(tab, TAB_OPTIONS)
    gate.resolve()
    expect(await first).toEqual({ ok: true, draftId: "video-1" })
    expect(await second).toMatchObject({ ok: false, code: "already-recording" })
    expect(sent.filter((message) => message.type === "bugberry:offscreen-open")).toHaveLength(1)
    expect(store.drafts.size).toBe(1)
  })

  test("a start asked for while a stop is still saving waits for it", async () => {
    const log: string[] = []
    const saving = deferred<void>()
    const send = deps.sendToOffscreen
    deps.sendToOffscreen = async (message) => {
      log.push(message.type)
      if (message.type === "bugberry:offscreen-stop") await saving.promise
      return send(message)
    }
    deps.ensureOffscreen = async () => {
      log.push("open")
      offscreenOpen = true
    }
    deps.closeOffscreen = async () => {
      log.push("close")
      offscreenOpen = false
    }
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    const stopped = controller.stop()
    const restarted = controller.start(tab, TAB_OPTIONS)
    saving.resolve()
    expect(await stopped).toMatchObject({ ok: true })
    expect(await restarted).toMatchObject({ ok: true })
    expect(log).toEqual([
      "open",
      "bugberry:offscreen-open",
      "bugberry:offscreen-begin",
      "bugberry:offscreen-stop",
      "close",
      "open",
      "bugberry:offscreen-open",
      "bugberry:offscreen-begin",
    ])
    expect(offscreenOpen).toBe(true)
  })
})

describe("the camera", () => {
  const CAMERA = { deviceId: "cam1", shape: "circle" as const }
  const cameraSteps = () => steps.filter((step) => step.startsWith("camera"))

  test("a tab recording with the camera shows it before the countdown and the take", async () => {
    await startVideoRecording(tab, { ...TAB_OPTIONS, countdown: true, camera: CAMERA }, deps)
    expect(steps).toEqual(["bugberry:offscreen-open", "camera-show 7 cam1 circle", "countdown", "bugberry:offscreen-begin"])
  })

  test("the camera warms up during the countdown, and the take waits for it", async () => {
    let warm = () => {}
    deps.showCamera = async () => ({ ready: new Promise<void>((resolve) => (warm = resolve)) })
    const started = startVideoRecording(tab, { ...TAB_OPTIONS, countdown: true, camera: CAMERA }, deps)
    for (let i = 0; i < 20; i += 1) await Promise.resolve()
    expect(steps).toContain("countdown")
    expect(steps).not.toContain("bugberry:offscreen-begin")
    warm()
    expect(await started).toEqual({ ok: true, draftId: "video-1" })
    expect(steps.at(-1)).toBe("bugberry:offscreen-begin")
  })

  test("without a camera nothing is shown", async () => {
    await startVideoRecording(tab, TAB_OPTIONS, deps)
    await startVideoRecording(tab, { ...TAB_OPTIONS, camera: null }, deps)
    expect(cameraSteps()).toEqual([])
  })

  test("a cancelled countdown hides the camera", async () => {
    countdownResult = "cancel"
    await startVideoRecording(tab, { ...TAB_OPTIONS, countdown: true, camera: CAMERA }, deps)
    expect(cameraSteps()).toEqual(["camera-show 7 cam1 circle", "camera-hide 7"])
  })

  test("a failed begin hides the camera", async () => {
    offscreenReply = (message) => (message.type === "bugberry:offscreen-begin" ? { ok: false, error: "x" } : { ok: true, micOn: false, micAvailable: false })
    expect(await startVideoRecording(tab, { ...TAB_OPTIONS, camera: CAMERA }, deps)).toMatchObject({ ok: false })
    expect(cameraSteps().at(-1)).toBe("camera-hide 7")
  })

  test("a camera that fails doesn't hold the start", async () => {
    deps.showCamera = async () => {
      throw new Error("no camera")
    }
    expect(await startVideoRecording(tab, { ...TAB_OPTIONS, camera: CAMERA }, deps)).toEqual({ ok: true, draftId: "video-1" })
  })

  test("a start that fails after the take began still turns the camera off", async () => {
    deps.state = { ...state, set: async () => Promise.reject(new Error("storage is full")) }
    await expect(startVideoRecording(tab, { ...TAB_OPTIONS, camera: CAMERA }, deps)).rejects.toThrow("storage is full")
    expect(cameraSteps().at(-1)).toBe("camera-hide 7")
  })

  test("Restart keeps the camera; Discard hides it", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, { ...TAB_OPTIONS, camera: CAMERA })
    await controller.restart()
    expect(cameraSteps()).toEqual(["camera-show 7 cam1 circle"])
    await controller.discard()
    expect(cameraSteps()).toEqual(["camera-show 7 cam1 circle", "camera-hide 7"])
  })

  test("Stop hides the camera", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, { ...TAB_OPTIONS, camera: CAMERA })
    await controller.stop()
    expect(cameraSteps()).toEqual(["camera-show 7 cam1 circle", "camera-hide 7"])
  })
})

describe("formatElapsed", () => {
  test("minutes and seconds", () => {
    expect(formatElapsed(0)).toBe("0:00")
    expect(formatElapsed(65_400)).toBe("1:05")
    expect(formatElapsed(300_000)).toBe("5:00")
    expect(formatElapsed(-50)).toBe("0:00")
  })
})

describe("recording controls", () => {
  const begun = () => sent.filter((message) => message.type === "bugberry:offscreen-begin").length

  test("the countdown runs between opening the source and recording", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, { ...TAB_OPTIONS, countdown: true })
    expect(sent.map((message) => message.type)).toEqual(["bugberry:offscreen-open", "bugberry:offscreen-begin"])
    expect(countdowns).toBe(1)
    expect(state.peek()?.startedAt).toBe(1500)
  })

  test("Esc during the countdown leaves nothing behind", async () => {
    countdownResult = "cancel"
    const controller = createRecordingController(deps)
    expect(await controller.start(tab, { ...TAB_OPTIONS, countdown: true })).toMatchObject({ ok: false, code: "cancelled" })
    expect(sent.at(-1)?.type).toBe("bugberry:offscreen-discard")
    expect(begun()).toBe(0)
    expect(state.peek()).toBeNull()
    expect(store.drafts.size).toBe(0)
    expect(offscreenOpen).toBe(false)
  })

  test("paused moments are cut from the logs, and later events line up with the video", async () => {
    deps.readPageCapture = async () => ({
      status: "ok",
      events: [
        { kind: "action", t: 2000, type: "click", target: "a" },
        { kind: "console", t: 6000, level: "error", args: ["typed card number"] },
        { kind: "action", t: 9000, type: "click", target: "b" },
      ],
      incomplete: [],
    })
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    clock = 5000
    await controller.pause()
    expect(sent.at(-1)?.type).toBe("bugberry:offscreen-pause")
    expect((await controller.barStatus()).paused).toBe(true)
    clock = 8000
    await controller.resume()
    expect(state.peek()?.pauses).toEqual([{ start: 5000, end: 8000 }])
    clock = 10_000
    expect((await controller.barStatus()).elapsedMs).toBe(5500)
    await controller.stop()
    const payload = (store.drafts.get("video-1") as { debuggerPayload: { events: Array<{ t: number }>; pauses: unknown } }).debuggerPayload
    expect(payload.events.map((event) => event.t)).toEqual([2000, 6000])
    expect(payload.pauses).toEqual([{ atMs: 3500, ms: 3000 }])
  })

  test("notes get their number and video time, and the author's name at stop", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    clock = 5000
    await controller.pause()
    clock = 8000
    await controller.resume()
    clock = 9000
    expect(await controller.addNote("Spins forever")).toEqual({ n: 1 })
    // Notes live in the draft (IndexedDB, extension pages only), never in session storage, which content scripts can read.
    expect((store.drafts.get("video-1") as { liveNotes?: unknown }).liveNotes).toEqual([{ n: 1, atMs: 4500, text: "Spins forever" }])
    expect(JSON.stringify(state.peek())).not.toContain("Spins forever")
    await controller.stop()
    expect(store.drafts.get("video-1")).toMatchObject({
      debuggerPayload: { notes: [{ n: 1, atMs: 4500, text: "Spins forever", author: "Dana" }] },
    })
  })

  test("Restart starts a new take on the same source and forgets the old one", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, { ...TAB_OPTIONS, countdown: true })
    clock = 3000
    await controller.addNote("old")
    await controller.pause()
    offscreenReply = (message) =>
      message.type === "bugberry:offscreen-begin" ? { ok: true, startedAt: 7000 } : { ok: true, durationMs: 4000 }
    await controller.restart()
    expect(sent.map((message) => message.type).slice(-2)).toEqual(["bugberry:offscreen-restart", "bugberry:offscreen-begin"])
    expect(sent.filter((message) => message.type === "bugberry:offscreen-open")).toHaveLength(1)
    expect(countdowns).toBe(2)
    expect(state.peek()).toMatchObject({ startedAt: 7000, pauses: [], pausedAt: null, loads: 0 })
    expect((store.drafts.get("video-1") as { liveNotes?: unknown }).liveNotes).toEqual([])
    // The page layer is rebuilt, so the deleted take's pins and strokes leave the screen (and the video).
    expect(ui).toEqual([
      [7, true],
      [7, false],
      [7, true],
    ])
    deps.readPageCapture = async () => ({
      status: "ok",
      events: [
        { kind: "action", t: 2000, type: "click", target: "old" },
        { kind: "action", t: 8000, type: "click", target: "new" },
      ],
      incomplete: [],
    })
    await controller.stop()
    const payload = (store.drafts.get("video-1") as { debuggerPayload: { events: Array<{ t: number }> } }).debuggerPayload
    expect(payload.events.map((event) => event.t)).toEqual([8000])
  })

  test("Discard throws everything away", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    await controller.discard()
    expect(sent.at(-1)?.type).toBe("bugberry:offscreen-discard")
    expect(store.drafts.size).toBe(0)
    expect(state.peek()).toBeNull()
    expect(opened).toEqual([])
    expect(ui).toEqual([
      [7, true],
      [7, false],
    ])
    expect(badges).toEqual([true, false])
  })

  test("popupStatus reports source, time and counts", async () => {
    deps.readPageCapture = async () => ({
      status: "ok",
      events: [
        { kind: "console", t: 2000, level: "error", args: ["boom"] },
        { kind: "network", t: 2100, method: "GET", url: "https://a.test/x", status: 404 },
        { kind: "action", t: 2200, type: "click", target: "a" },
        { kind: "action", t: 2300, type: "click", target: "b" },
      ],
      incomplete: [],
    })
    const controller = createRecordingController(deps)
    expect(await controller.popupStatus()).toEqual({ recording: false })
    await controller.start(tab, { ...TAB_OPTIONS, source: "screen" })
    clock = 13_500
    expect(await controller.popupStatus()).toEqual({
      recording: true,
      source: "screen",
      tabId: 7,
      elapsedMs: 12_000,
      paused: false,
      logs: true,
      counts: { errors: 1, failedRequests: 1, actions: 2 },
    })
  })

  test("popupStatus of a recording without logs says so", async () => {
    const controller = createRecordingController(deps)
    await controller.start({ ...tab, url: "chrome://newtab/" }, { ...TAB_OPTIONS, source: "screen" })
    expect(await controller.popupStatus()).toMatchObject({ recording: true, logs: false, counts: { errors: 0, failedRequests: 0, actions: 0 } })
  })

  test("popupStatus while restarting is an empty take", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    clock = 9000
    await state.set({ ...(state.peek() as RecordingState), restarting: true })
    expect(await controller.popupStatus()).toMatchObject({
      recording: true,
      elapsedMs: 0,
      counts: { errors: 0, failedRequests: 0, actions: 0 },
    })
  })

  test("old state without a source reads as a tab", () => {
    expect(recordingStateFrom({ draftId: "d", tabId: 1, startedAt: 0 })?.source).toBe("tab")
  })

  test("the length limit survives being read back from storage", () => {
    expect(recordingStateFrom({ draftId: "d", tabId: 1, startedAt: 2, maxMs: 120_000 })?.maxMs).toBe(120_000)
    expect(recordingStateFrom({ draftId: "d", tabId: 1, startedAt: 2, maxMs: "x" })).not.toHaveProperty("maxMs")
  })

  test("Stop opens the review on the recorded tab", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    await controller.stop()
    expect(opened).toEqual(["video-1"])
    expect(reviewTabs).toEqual([7])
  })

  test("the microphone can be turned on mid-recording", async () => {
    offscreenReply = (message) =>
      message.type === "bugberry:offscreen-mic"
        ? { ok: true, micOn: true }
        : message.type === "bugberry:offscreen-open"
          ? { ok: true, micOn: false, micAvailable: true }
          : { ok: true, startedAt: 1500 }
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    await controller.setMic(true)
    expect(sent.at(-1)).toEqual({ type: "bugberry:offscreen-mic", on: true })
    expect(await controller.barStatus()).toMatchObject({ micOn: true, micAvailable: true })
  })

  test("errors caught count the page's errors and failed requests, read at most every 2 s", async () => {
    let reads = 0
    deps.readPageCapture = async () => {
      reads += 1
      return {
        status: "ok",
        events: [
          { kind: "console", t: 2000, level: "error", args: ["x"] },
          { kind: "network", t: 2100, method: "POST", url: "https://a.test/pay", status: 500 },
          { kind: "action", t: 2200, type: "click" },
        ],
        incomplete: [],
      }
    }
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    clock = 3000
    expect((await controller.barStatus()).errors).toBe(2)
    clock = 4000
    await controller.barStatus()
    expect(reads).toBe(1)
    clock = 5100
    await controller.barStatus()
    expect(reads).toBe(2)
  })

  test("nothing recording, a quiet status", async () => {
    const controller = createRecordingController(deps)
    expect(await controller.barStatus()).toEqual({
      recording: false,
      elapsedMs: 0,
      paused: false,
      errors: 0,
      micOn: false,
      micAvailable: false,
      maxMs: null,
    })
    expect(await controller.addNote("x")).toBeNull()
  })
})

describe("restart and pause edges", () => {
  test("while a Restart counts down, the bar shows a fresh take, not the old one", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, { ...TAB_OPTIONS, countdown: true })
    clock = 9000
    let during: unknown = null
    deps.countdown = async () => {
      during = await controller.barStatus()
      return "done"
    }
    offscreenReply = (message) => (message.type === "bugberry:offscreen-begin" ? { ok: true, startedAt: 9500 } : { ok: true })
    await controller.restart()
    expect(during).toMatchObject({ recording: true, elapsedMs: 0, errors: 0, paused: false })
  })

  test("a pause the recorder didn't take changes nothing, so no logs are lost while the video runs", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    offscreenReply = () => ({ ok: false, error: "No recording is running" })
    await controller.pause()
    expect(state.peek()?.pausedAt).toBeNull()
  })
})

describe("data during pauses and starts", () => {
  test("a popup opened while Chrome's share picker is up gets no status until the start is done", async () => {
    const gate = deferred<void>()
    const send = deps.sendToOffscreen
    deps.sendToOffscreen = async (message) => {
      if (message.type === "bugberry:offscreen-open") await gate.promise
      return send(message)
    }
    const controller = createRecordingController(deps)
    const starting = controller.start(tab, TAB_OPTIONS)
    let answered = false
    const status = controller.status().then((value) => {
      answered = true
      return value
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    // Until then the popup shows "(checking…)" and offers no Delete for the starting draft.
    expect(answered).toBe(false)
    gate.resolve()
    await starting
    expect(await status).toMatchObject({ recording: true, draftId: "video-1" })
  })

  test("a page flushed during a pause doesn't keep the paused events, so they take no room", async () => {
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    clock = 5000
    await controller.pause()
    clock = 8000
    await controller.resume()
    await controller.notePageFlush(7, {
      documentId: "doc-1",
      events: [
        { kind: "action", t: 1000, type: "click", target: "before the take" },
        { kind: "action", t: 2000, type: "click", target: "kept" },
        { kind: "action", t: 6000, type: "click", target: "paused" },
      ],
      incomplete: [],
    })
    const pages = (store.drafts.get("video-1") as { pages?: Array<{ events: Array<{ t: number }> }> }).pages ?? []
    expect(pages[0]?.events.map((event) => event.t)).toEqual([2000])
  })

  test("the open page is read without the paused events, before its 1000-event cut", async () => {
    const reads: unknown[] = []
    deps.readPageCapture = async (_tabId, keep) => {
      reads.push(keep)
      return { status: "ok", events: [], incomplete: [] }
    }
    const controller = createRecordingController(deps)
    await controller.start(tab, TAB_OPTIONS)
    clock = 5000
    await controller.pause()
    clock = 8000
    await controller.resume()
    await controller.stop()
    expect(reads.at(-1)).toEqual({ since: 1500, pauses: [{ start: 5000, end: 8000 }] })
  })
})
