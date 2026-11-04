import { describe, expect, mock, test } from "bun:test"
import type { ReplayEvent } from "@bugberry/shared"
import { installReplayRecorder, type ReplayRecordOptions } from "../../lib/replay/replay-page"

function setup(options: { visible?: boolean; jpeg?: string | null; maxBytes?: number; alive?: () => boolean } = {}) {
  let handler: (message: unknown, reply: (value: unknown) => void) => boolean | undefined = () => undefined
  let tick: () => Promise<void> = async () => {}
  let recorded: ReplayRecordOptions | null = null
  let clock = 0
  const stopRecord = mock()
  const record = mock((opts: ReplayRecordOptions) => {
    recorded = opts
    return stopRecord
  })
  const addCustomEvent = mock()
  const takeFullSnapshot = mock()
  const requestFrame = mock(async () => (options.jpeg === undefined ? "AAAA" : options.jpeg))
  const clearInterval = mock()
  const notifyDegraded = mock()
  const page = installReplayRecorder({
    record,
    addCustomEvent,
    takeFullSnapshot,
    requestFrame,
    visible: () => options.visible ?? true,
    onMessage: (h) => {
      handler = h
    },
    now: () => clock,
    notifyDegraded,
    // The browser's own timers throw "Illegal invocation" when called on another object, as deps.setInterval(…) would.
    setInterval: function (this: unknown, fn: () => Promise<void>) {
      if (this !== undefined) throw new TypeError("Illegal invocation")
      tick = fn
      return 7
    } as unknown as typeof setInterval,
    clearInterval: function (this: unknown, id: number) {
      if (this !== undefined) throw new TypeError("Illegal invocation")
      clearInterval(id)
    } as unknown as typeof globalThis.clearInterval,
    maxBytes: options.maxBytes,
    alive: options.alive,
  })
  const send = (message: unknown) => {
    let answer: unknown
    handler(message, (value) => {
      answer = value
    })
    return answer
  }
  const emit = (event: ReplayEvent, isCheckout = false) => recorded?.emit(event, isCheckout)
  return {
    page,
    record,
    stopRecord,
    addCustomEvent,
    takeFullSnapshot,
    requestFrame,
    clearInterval,
    notifyDegraded,
    send,
    emit,
    tick: () => tick(),
    options: () => recorded,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const start = { type: "bugberry:replay-start", windowMs: 30_000 }

describe("the page's replay recorder", () => {
  test("waits for start, then records with the fixed options and the window as checkout", () => {
    const p = setup()
    expect(p.record).not.toHaveBeenCalled()
    p.send(start)
    expect(p.options()).toMatchObject({
      checkoutEveryNms: 30_000,
      maskAllInputs: true,
      collectFonts: true,
      inlineStylesheet: true,
      recordCanvas: false,
      recordCrossOriginIframes: false,
    })
  })

  test("a second start while running is ignored", () => {
    const p = setup()
    p.send(start)
    p.send(start)
    expect(p.record).toHaveBeenCalledTimes(1)
  })

  test("a frame is asked for only while the page is visible", async () => {
    const hidden = setup({ visible: false })
    hidden.send(start)
    await hidden.tick()
    expect(hidden.requestFrame).not.toHaveBeenCalled()

    const shown = setup()
    shown.send(start)
    await shown.tick()
    expect(shown.addCustomEvent).toHaveBeenCalledWith("bugberry:frame", { jpeg: "AAAA" })
  })

  test("a failed frame is skipped", async () => {
    const p = setup({ jpeg: null })
    p.send(start)
    await p.tick()
    expect(p.addCustomEvent).not.toHaveBeenCalled()
  })

  test("a snapshot request replies with what the buffer holds", () => {
    const p = setup()
    p.send(start)
    p.emit({ type: 4, timestamp: 1_000, data: {} })
    p.emit({ type: 2, timestamp: 1_000, data: {} }, true)
    expect(p.send({ type: "bugberry:replay-snapshot" })).toMatchObject({ since: 1_000, degraded: false, events: [{ type: 4 }, { type: 2 }] })
  })

  test("stop ends recording and the timer and empties the buffer", () => {
    const p = setup()
    p.send(start)
    p.emit({ type: 4, timestamp: 1_000, data: {} })
    p.send({ type: "bugberry:replay-stop" })
    expect(p.stopRecord).toHaveBeenCalled()
    expect(p.clearInterval).toHaveBeenCalledWith(7)
    expect(p.send({ type: "bugberry:replay-snapshot" })).toMatchObject({ events: [] })
    p.send(start)
    expect(p.record).toHaveBeenCalledTimes(2)
  })

  test("a quiet page still gets a checkout every window, so a capture never spans much more than two", async () => {
    const p = setup({ visible: false })
    p.send(start)
    p.emit({ type: 4, timestamp: 0, data: {} })
    p.advance(29_000)
    await p.tick()
    expect(p.takeFullSnapshot).not.toHaveBeenCalled()
    p.advance(1_000)
    await p.tick()
    expect(p.takeFullSnapshot).toHaveBeenCalledTimes(1)
  })

  test("a lone segment crossing the byte cap gets a fresh checkout at once, not at the next tick", async () => {
    const p = setup({ visible: false, maxBytes: 100 })
    p.send(start)
    p.emit({ type: 4, timestamp: 0, data: {} })
    p.emit({ type: 3, timestamp: 1, data: { s: "x".repeat(200) } })
    p.emit({ type: 3, timestamp: 2, data: { s: "x".repeat(200) } })
    await Promise.resolve()
    expect(p.takeFullSnapshot).toHaveBeenCalledTimes(1)
  })

  // Chrome leaves the old script in open tabs when the extension reloads; sending from it throws at once.
  test("left behind by a reload, it stops recording at its next frame instead of asking for one", async () => {
    let alive = true
    const p = setup({ alive: () => alive })
    p.send(start)
    alive = false
    await p.tick()
    expect(p.requestFrame).not.toHaveBeenCalled()
    expect(p.stopRecord).toHaveBeenCalled()
    expect(p.clearInterval).toHaveBeenCalledWith(7)
  })

  test("left behind by a reload, it stops recording instead of telling the background the buffer turned degraded", async () => {
    let alive = true
    const p = setup({ maxBytes: 300, alive: () => alive })
    p.send(start)
    p.emit({ type: 4, timestamp: 0, data: {} })
    p.emit({ type: 3, timestamp: 1, data: { s: "x".repeat(250) } })
    alive = false
    p.emit({ type: 4, timestamp: 5_000, data: {} })
    expect(() => p.emit({ type: 3, timestamp: 5_001, data: {} })).not.toThrow()
    expect(p.notifyDegraded).not.toHaveBeenCalled()
    // Queued, since rrweb is still inside this emit.
    expect(p.stopRecord).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(p.stopRecord).toHaveBeenCalled()
  })

  test("the background hears when the buffer turns degraded and back, once each", () => {
    const p = setup({ maxBytes: 300 })
    p.send(start)
    p.emit({ type: 4, timestamp: 0, data: {} })
    p.emit({ type: 3, timestamp: 1, data: { s: "x".repeat(250) } })
    expect(p.notifyDegraded).not.toHaveBeenCalled()
    p.emit({ type: 4, timestamp: 5_000, data: {} })
    p.emit({ type: 3, timestamp: 5_001, data: {} })
    expect(p.notifyDegraded.mock.calls).toEqual([[true]])
    p.emit({ type: 4, timestamp: 10_000, data: {} })
    expect(p.notifyDegraded.mock.calls).toEqual([[true], [false]])
  })

  test("other extension messages get no answer", () => {
    const p = setup()
    expect(p.send({ type: "bugberry:screenshot" })).toBeUndefined()
  })
})
