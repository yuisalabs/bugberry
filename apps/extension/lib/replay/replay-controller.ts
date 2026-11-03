import type { ReplayWindowMs } from "@bugberry/shared"
import { type ActiveTab, type CaptureResult, capturable, UNCAPTURABLE } from "../capture/capture-flow"
import type { ReplayRequest, ReplaySnapshot, ReplaySnapshotRequest, ReplayStartMessage, ReplayStatus, ReplayStopMessage } from "../shared/messages"
import type { ArmedStore, ArmedTab } from "./armed-state"

export interface ReplayControllerDeps {
  armed: ArmedStore
  /** scripting.executeScript with the recorder's file. */
  inject(tabId: number): Promise<void>
  toPage(tabId: number, message: ReplayStartMessage | ReplaySnapshotRequest | ReplayStopMessage): Promise<unknown>
  /** captureVisibleTab as JPEG, in base64 without the data: prefix. */
  captureJpeg(windowId: number): Promise<string>
  /** Whether the tab is the one showing in its window; captureVisibleTab would otherwise take another tab. */
  isShowing(tabId: number): Promise<boolean>
  badge(tabId: number, tab: ArmedTab | null): Promise<void>
  /** Turns the page's buffer into a draft and opens the review (startReplayReport). */
  capture(tab: ActiveTab, snapshot: ReplaySnapshot, maxMs: number): Promise<CaptureResult>
  /** The per-recording length limit. */
  maxMs(): Promise<number>
  isRecording(): Promise<boolean>
  now(): number
}

type Refusal = { ok: false; error: string }

export interface ReplayController {
  arm(tab: ActiveTab, windowMs: ReplayWindowMs): Promise<ReplayStatus | Refusal>
  disarm(tabId: number): Promise<void>
  status(tabId: number): Promise<ReplayStatus>
  capture(tab: ActiveTab): Promise<CaptureResult>
  frame(tabId: number, windowId: number): Promise<{ jpeg: string | null }>
  /** The page said its buffer dropped a segment for the byte cap, or that a checkout fit again. */
  degraded(tabId: number, degraded: boolean): Promise<void>
  pageLoaded(tabId: number): Promise<void>
  tabClosed(tabId: number): Promise<void>
  recordingChanged(recording: boolean): Promise<void>
  handle(message: ReplayRequest, tab: ActiveTab): Promise<ReplayStatus | CaptureResult | Refusal>
}

const UNREACHABLE = "BugBerry can't reach this page. Reload it and try again."
const NOT_SHOWING = "That tab isn't showing. Switch to it and try again."

function statusOf(tab: ArmedTab | null): ReplayStatus {
  return tab ? { armed: true, ...tab } : { armed: false }
}

export function replaySnapshotFrom(value: unknown): ReplaySnapshot | null {
  if (typeof value !== "object" || value === null) return null
  const snapshot = value as Record<string, unknown>
  if (!Array.isArray(snapshot.events) || typeof snapshot.since !== "number" || typeof snapshot.bytes !== "number") return null
  return { events: snapshot.events, since: snapshot.since, bytes: snapshot.bytes, degraded: snapshot.degraded === true }
}

/**
 * Armed tabs, from the background: the recorder goes into the page on arming and after every load, pauses while a video
 * recording runs, and hands its buffer over on Capture. The buffer never leaves the page until then.
 */
export function createReplayController(deps: ReplayControllerDeps): ReplayController {
  const stopPage = (tabId: number) => deps.toPage(tabId, { type: "bugberry:replay-stop" }).catch(() => undefined)

  /** Puts a fresh recorder in the page; false when the page can't be scripted. */
  const startPage = async (tabId: number, windowMs: ReplayWindowMs): Promise<boolean> => {
    try {
      await deps.inject(tabId)
      await deps.toPage(tabId, { type: "bugberry:replay-start", windowMs })
      return true
    } catch {
      return false
    }
  }

  const save = async (tabId: number, tab: ArmedTab) => {
    await deps.armed.set(tabId, tab)
    await deps.badge(tabId, tab)
  }

  const disarm = async (tabId: number) => {
    await stopPage(tabId)
    await deps.armed.remove(tabId)
    await deps.badge(tabId, null)
  }

  const arm = async (tab: ActiveTab, windowMs: ReplayWindowMs): Promise<ReplayStatus | Refusal> => {
    if (!capturable(tab.url)) return { ok: false, error: UNCAPTURABLE }
    if (tab.active === false) return { ok: false, error: NOT_SHOWING }
    const current = await deps.armed.get(tab.id)
    if (current?.windowMs === windowMs) return statusOf(current)
    const since = deps.now()
    if (await deps.isRecording()) {
      const paused = { windowMs, since, degraded: false, suspended: true }
      await save(tab.id, paused)
      return statusOf(paused)
    }
    // Another window: rrweb's checkout interval is fixed at start, so the recorder starts over.
    if (current) await stopPage(tab.id)
    if (!(await startPage(tab.id, windowMs))) {
      if (current) await disarm(tab.id)
      return { ok: false, error: UNREACHABLE }
    }
    const armed = { windowMs, since, degraded: false, suspended: false }
    await save(tab.id, armed)
    return statusOf(armed)
  }

  const status = async (tabId: number) => statusOf(await deps.armed.get(tabId))

  const capture = async (tab: ActiveTab): Promise<CaptureResult> => {
    const armed = await deps.armed.get(tab.id)
    if (!armed) return { ok: false, error: "This tab is not armed for replay" }
    if (armed.suspended) return { ok: false, error: "Replay is paused while recording" }
    if (tab.active === false) return { ok: false, error: NOT_SHOWING }
    const snapshot = replaySnapshotFrom(await deps.toPage(tab.id, { type: "bugberry:replay-snapshot" }).catch(() => null))
    if (!snapshot) return { ok: false, error: UNREACHABLE }
    // The tab stays armed with its buffer, so a second capture is possible.
    return deps.capture(tab, snapshot, await deps.maxMs())
  }

  const pageLoaded = async (tabId: number) => {
    const armed = await deps.armed.get(tabId)
    if (!armed || armed.suspended) return
    // A page that can't be scripted (an error page, the Web Store) records nothing; the tab stays armed for the next one.
    if (!(await startPage(tabId, armed.windowMs))) return
    await save(tabId, { ...armed, since: deps.now(), degraded: false })
  }

  return {
    arm,
    disarm,
    status,
    capture,
    async frame(tabId, windowId) {
      const armed = await deps.armed.get(tabId)
      if (!armed || armed.suspended) return { jpeg: null }
      try {
        if (!(await deps.isShowing(tabId))) return { jpeg: null }
        return { jpeg: await deps.captureJpeg(windowId) }
      } catch {
        // Hidden tab, unfocused window or the two-per-second limit: the frame is skipped.
        return { jpeg: null }
      }
    },
    async degraded(tabId, degraded) {
      const armed = await deps.armed.get(tabId)
      if (!armed || armed.suspended || armed.degraded === degraded) return
      await save(tabId, { ...armed, degraded })
    },
    pageLoaded,
    async tabClosed(tabId) {
      await deps.armed.remove(tabId)
    },
    // The two never run together. The buffer is dropped at the pause: a replay across the gap would show a hole.
    async recordingChanged(recording) {
      const tabs = await deps.armed.all()
      for (const [id, armed] of Object.entries(tabs)) {
        const tabId = Number(id)
        if (recording && !armed.suspended) {
          await stopPage(tabId)
          await save(tabId, { ...armed, suspended: true, degraded: false })
        } else if (!recording && armed.suspended) {
          await deps.armed.set(tabId, { ...armed, suspended: false })
          await pageLoaded(tabId)
        }
      }
    },
    async handle(message, tab) {
      switch (message.action) {
        case "arm":
          return arm(tab, message.windowMs ?? 60_000)
        case "disarm":
          await disarm(tab.id)
          return status(tab.id)
        case "capture":
          return capture(tab)
        case "status":
          return status(tab.id)
      }
    },
  }
}
