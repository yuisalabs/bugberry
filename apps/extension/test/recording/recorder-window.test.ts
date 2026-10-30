import { describe, expect, mock, test } from "bun:test"
import type { OffscreenMessage } from "../../lib/messages"
import { createWindowRecorderHost, onRecorderClosed, RECORDER_CLOSED, type WindowRecorderDeps } from "../../lib/recording/recorder-window"

function memoryWindowId(initial: number | null = null) {
  let value = initial
  return { get: async () => value, set: async (id: number | null) => void (value = id), peek: () => value }
}

function setup(overrides: Partial<WindowRecorderDeps> = {}, stored = memoryWindowId()) {
  const deps = {
    createWindow: mock(async () => 41),
    windowExists: mock(async () => true),
    focusWindow: mock(async () => {}),
    removeWindow: mock(async () => {}),
    sendMessage: mock(async (_message: OffscreenMessage): Promise<unknown> => ({ ok: true })),
    windowId: stored,
    readyTimeoutMs: 1000,
    ...overrides,
  }
  return { deps, stored, host: createWindowRecorderHost(deps) }
}

const open: OffscreenMessage = {
  type: "bugberry:offscreen-open",
  draftId: "d1",
  capture: { kind: "display", surface: "window", systemAudio: false },
  mic: false,
  micDeviceId: null,
  maxBytes: 1000,
  maxMs: 120_000,
}

describe("createWindowRecorderHost", () => {
  test("ensure opens the recorder window and waits until it is ready", async () => {
    const { deps, stored, host } = setup()
    let done = false
    const ensuring = host.ensure().then(() => void (done = true))
    await Bun.sleep(5)
    expect(deps.createWindow).toHaveBeenCalledWith("/recorder.html")
    expect(done).toBe(false)
    host.ready()
    await ensuring
    expect(done).toBe(true)
    expect(stored.peek()).toBe(41)
  })

  test("ensure reuses a recorder window that still exists", async () => {
    const { deps, host } = setup({}, memoryWindowId(41))
    await host.ensure()
    expect(deps.focusWindow).toHaveBeenCalledWith(41)
    expect(deps.createWindow).not.toHaveBeenCalled()
  })

  test("ensure fails when the window never says ready", async () => {
    const { deps, stored, host } = setup({ readyTimeoutMs: 10 })
    await expect(host.ensure()).rejects.toThrow()
    expect(deps.removeWindow).toHaveBeenCalledWith(41)
    expect(stored.peek()).toBeNull()
  })

  test("closing the window while the picker is pending cancels the open", async () => {
    const { stored, host } = setup({ sendMessage: mock(() => new Promise<unknown>(() => {})) }, memoryWindowId(41))
    const sending = host.send(open)
    await Bun.sleep(5)
    expect(await host.windowRemoved(41)).toBe(true)
    expect(await sending).toEqual({ ok: false, error: "Cancelled", code: "cancelled" })
    expect(stored.peek()).toBeNull()
  })

  test("the page going away first (Firefox rejects the pending send) still counts as a cancel", async () => {
    const { host } = setup({ sendMessage: mock(() => Promise.reject(new Error("Message manager disconnected"))) }, memoryWindowId(41))
    const sending = host.send(open)
    await Bun.sleep(5)
    await host.windowRemoved(41)
    expect(await sending).toEqual({ ok: false, error: "Cancelled", code: "cancelled" })
  })

  test("a failed open with the window still there is a real error", async () => {
    const { host } = setup(
      { sendMessage: mock(() => Promise.reject(new Error("boom"))), cancelGraceMs: 10 },
      memoryWindowId(41),
    )
    await expect(host.send(open)).rejects.toThrow("boom")
  })

  test("windowRemoved ignores other windows", async () => {
    const { stored, host } = setup({}, memoryWindowId(41))
    expect(await host.windowRemoved(7)).toBe(false)
    expect(stored.peek()).toBe(41)
  })

  test("close removes the window and forgets it", async () => {
    const { deps, stored, host } = setup({}, memoryWindowId(41))
    await host.close()
    expect(deps.removeWindow).toHaveBeenCalledWith(41)
    expect(stored.peek()).toBeNull()
    // Its own close is not a reporter closing the window.
    expect(await host.windowRemoved(41)).toBe(false)
  })

  test("close with no recorder window does nothing", async () => {
    const { deps, host } = setup()
    await host.close()
    expect(deps.removeWindow).not.toHaveBeenCalled()
  })

  test("the recorder window id survives a background restart", async () => {
    const stored = memoryWindowId(41)
    setup({}, stored)
    const { host: restarted } = setup({}, stored)
    expect(await restarted.windowRemoved(41)).toBe(true)
  })
})

describe("onRecorderClosed", () => {
  test("a closed recorder window mid-recording discards and flags the tab", async () => {
    const discard = mock(async () => {})
    const flag = mock(async () => {})
    await onRecorderClosed({
      status: async () => ({ recording: true, draftId: "d1", tabId: 7, startedAt: 1 }),
      discard,
      flag,
    })
    expect(discard).toHaveBeenCalledTimes(1)
    expect(flag).toHaveBeenCalledWith(7, { ok: false, error: RECORDER_CLOSED })
    expect(RECORDER_CLOSED).toBe("Recording lost: the BugBerry recorder window was closed.")
  })

  test("nothing happens when no recording was running", async () => {
    const discard = mock(async () => {})
    const flag = mock(async () => {})
    await onRecorderClosed({ status: async () => ({ recording: false }), discard, flag })
    expect(discard).not.toHaveBeenCalled()
    expect(flag).not.toHaveBeenCalled()
  })
})
