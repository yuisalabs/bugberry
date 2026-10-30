import type { CaptureResult } from "../capture/capture-flow"
import type { OffscreenMessage } from "../shared/messages"
import type { RecordingStatus } from "./recording-flow"

export const RECORDER_PAGE = "/recorder.html"
export const RECORDER_CLOSED = "Recording lost: the BugBerry recorder window was closed."

/** The browser calls behind Firefox's recorder window, injected so the host can be tested. */
export interface WindowRecorderDeps {
  /** Opens the recorder page in a small popup window; resolves with its window id. */
  createWindow(url: string): Promise<number>
  windowExists(id: number): Promise<boolean>
  focusWindow(id: number): Promise<void>
  removeWindow(id: number): Promise<void>
  sendMessage(message: OffscreenMessage): Promise<unknown>
  /** In session storage, so a background page that was unloaded still knows its window. */
  windowId: { get(): Promise<number | null>; set(id: number | null): Promise<void> }
  readyTimeoutMs?: number
  /** How long a failed `open` waits to learn whether the reporter closed the window. */
  cancelGraceMs?: number
}

const READY_TIMEOUT_MS = 10_000
const CANCEL_GRACE_MS = 1000
const CANCELLED = { ok: false, error: "Cancelled", code: "cancelled" } as const

/**
 * Firefox has no offscreen documents, and its share picker only opens after a click on a page the reporter
 * sees. So the recorder runs in a small window of its own, which answers the same `bugberry:offscreen-*`
 * messages as Chrome's offscreen document.
 */
export function createWindowRecorderHost(deps: WindowRecorderDeps) {
  let readyWaiters: Array<() => void> = []
  /** Answers a pending `open` with "cancelled" when the reporter closes the window instead of picking. */
  let cancelOpen: (() => void) | null = null

  return {
    /** The recorder page says it listens. */
    ready(): void {
      const waiting = readyWaiters
      readyWaiters = []
      for (const resolve of waiting) resolve()
    },

    async ensure(): Promise<void> {
      const existing = await deps.windowId.get()
      if (existing !== null && (await deps.windowExists(existing).catch(() => false))) {
        await deps.focusWindow(existing)
        return
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      // Waiting before the window exists, so a page that is ready at once is not missed.
      const ready = new Promise<void>((resolve, reject) => {
        readyWaiters.push(resolve)
        timer = setTimeout(() => reject(new Error("The recorder window didn't open")), deps.readyTimeoutMs ?? READY_TIMEOUT_MS)
      })
      const created = await deps.createWindow(RECORDER_PAGE)
      await deps.windowId.set(created)
      try {
        await ready
      } catch (error) {
        await deps.windowId.set(null)
        await deps.removeWindow(created).catch(() => {})
        throw error
      } finally {
        clearTimeout(timer)
      }
    },

    async close(): Promise<void> {
      const id = await deps.windowId.get()
      if (id === null) return
      // Forgotten first: its own close must not look like the reporter closing the window.
      await deps.windowId.set(null)
      await deps.removeWindow(id).catch(() => {})
    },

    async send(message: OffscreenMessage): Promise<unknown> {
      if (message.type !== "bugberry:offscreen-open") return deps.sendMessage(message)
      const cancelled = new Promise<unknown>((resolve) => {
        cancelOpen = () => resolve(CANCELLED)
      })
      try {
        return await Promise.race([deps.sendMessage(message), cancelled])
      } catch (error) {
        // Closing the window drops the page's pending answer, and Firefox may reject the send before it
        // reports the window gone: that is still the reporter backing out, not a failure.
        const grace = new Promise((resolve) => setTimeout(resolve, deps.cancelGraceMs ?? CANCEL_GRACE_MS, null))
        if ((await Promise.race([cancelled, grace])) === CANCELLED) return CANCELLED
        throw error
      } finally {
        cancelOpen = null
      }
    },

    /** True when the closed window was the recorder (and the host has forgotten it). */
    async windowRemoved(windowId: number): Promise<boolean> {
      if ((await deps.windowId.get()) !== windowId) return false
      await deps.windowId.set(null)
      cancelOpen?.()
      return true
    },
  }
}

/** The reporter closed the recorder window: the take is gone, and the recorded tab says so. */
export async function onRecorderClosed(deps: {
  status(): Promise<RecordingStatus>
  discard(): Promise<unknown>
  flag(tabId: number, result: CaptureResult): Promise<unknown>
}): Promise<void> {
  const status = await deps.status()
  if (!status.recording) return
  await deps.discard()
  await deps.flag(status.tabId, { ok: false, error: RECORDER_CLOSED })
}
