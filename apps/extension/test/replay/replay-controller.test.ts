import { describe, expect, mock, test } from "bun:test"
import type { ActiveTab } from "../../lib/capture/capture-flow"
import { type ArmedTab, createArmedStore } from "../../lib/replay/armed-state"
import { createReplayController } from "../../lib/replay/replay-controller"

function memorySession() {
  const items = new Map<string, unknown>()
  return {
    get: async (key: string) => (items.has(key) ? { [key]: structuredClone(items.get(key)) } : {}),
    set: async (patch: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(patch)) items.set(key, structuredClone(value))
    },
  }
}

const tab = (id: number, extra: Partial<ActiveTab> = {}): ActiveTab => ({ id, windowId: 1, active: true, url: "https://app.test/", ...extra })

function setup(options: { recording?: boolean } = {}) {
  const injected: number[] = []
  const sent: Array<[number, unknown]> = []
  const badges: Array<[number, ArmedTab | null]> = []
  let pageReply: unknown = { events: [{ type: 4, timestamp: 1_000, data: {} }], since: 1_000, bytes: 10, degraded: false }
  let recording = options.recording ?? false
  let clock = 5_000
  const deps = {
    armed: createArmedStore(memorySession()),
    inject: mock(async (tabId: number) => {
      injected.push(tabId)
    }),
    toPage: mock(async (tabId: number, message: { type: string }) => {
      sent.push([tabId, message])
      return message.type === "bugberry:replay-snapshot" ? pageReply : { ok: true }
    }),
    captureJpeg: mock(async () => "BASE64"),
    isShowing: mock(async () => true),
    badge: mock(async (tabId: number, armed: ArmedTab | null) => {
      badges.push([tabId, armed])
    }),
    capture: mock(async () => ({ ok: true as const, draftId: "d1" })),
    maxMs: async () => 120_000,
    isRecording: async () => recording,
    now: () => clock,
  }
  const c = createReplayController(deps)
  return {
    c,
    deps,
    injected,
    sent,
    badges,
    reply: (value: unknown) => {
      pageReply = value
    },
    setRecording: (on: boolean) => {
      recording = on
    },
    tick: (ms: number) => {
      clock += ms
    },
  }
}

describe("arming", () => {
  test("arm injects, starts and badges", async () => {
    const { c, injected, sent, badges } = setup()
    const status = await c.arm(tab(3), 30_000)
    expect(injected).toEqual([3])
    expect(sent).toEqual([[3, { type: "bugberry:replay-start", windowMs: 30_000 }]])
    expect(status).toEqual({ armed: true, windowMs: 30_000, since: 5_000, degraded: false, suspended: false })
    expect(badges.at(-1)).toEqual([3, { windowMs: 30_000, since: 5_000, degraded: false, suspended: false }])
  })

  test("a page BugBerry can't script is refused and not armed", async () => {
    const s = setup()
    expect(await s.c.arm(tab(3, { url: "chrome://settings" }), 60_000)).toMatchObject({ ok: false })
    s.deps.inject.mockImplementationOnce(async () => Promise.reject(new Error("Cannot access contents of the page")))
    expect(await s.c.arm(tab(4), 60_000)).toEqual({ ok: false, error: "BugBerry can't reach this page. Reload it and try again." })
    expect(await s.c.status(4)).toEqual({ armed: false })
  })

  test("arming again with another window restarts the recorder with it; the same window changes nothing", async () => {
    const { c, injected, sent } = setup()
    await c.arm(tab(3), 60_000)
    await c.arm(tab(3), 60_000)
    expect(injected).toEqual([3])
    await c.arm(tab(3), 120_000)
    expect(sent.slice(-2)).toEqual([
      [3, { type: "bugberry:replay-stop" }],
      [3, { type: "bugberry:replay-start", windowMs: 120_000 }],
    ])
    expect(await c.status(3)).toMatchObject({ windowMs: 120_000 })
  })

  test("arming while a recording runs arms the tab paused, without a recorder", async () => {
    const { c, injected } = setup({ recording: true })
    expect(await c.arm(tab(3), 60_000)).toMatchObject({ armed: true, suspended: true })
    expect(injected).toEqual([])
  })

  test("a page load in an armed tab injects again with an empty buffer", async () => {
    const { c, injected, sent, tick } = setup()
    await c.arm(tab(3), 60_000)
    tick(10_000)
    await c.pageLoaded(3)
    expect(injected).toEqual([3, 3])
    expect(sent.at(-1)).toEqual([3, { type: "bugberry:replay-start", windowMs: 60_000 }])
    expect(await c.status(3)).toMatchObject({ since: 15_000 })
  })

  test("a page load in an unarmed tab does nothing", async () => {
    const { c, injected } = setup()
    await c.pageLoaded(3)
    expect(injected).toEqual([])
  })

  test("disarm stops the page and drops the tab; a closed tab is dropped too", async () => {
    const { c, sent, badges } = setup()
    await c.arm(tab(3), 60_000)
    await c.disarm(3)
    expect(sent.at(-1)).toEqual([3, { type: "bugberry:replay-stop" }])
    expect(badges.at(-1)).toEqual([3, null])
    expect(await c.status(3)).toEqual({ armed: false })
    await c.arm(tab(4), 60_000)
    await c.tabClosed(4)
    expect(await c.status(4)).toEqual({ armed: false })
  })

  test("the page saying its buffer is full turns the badge amber, and back", async () => {
    const { c, badges } = setup()
    await c.arm(tab(3), 60_000)
    await c.degraded(3, true)
    expect(await c.status(3)).toMatchObject({ degraded: true })
    expect(badges.at(-1)?.[1]).toMatchObject({ degraded: true })
    await c.degraded(3, false)
    expect(await c.status(3)).toMatchObject({ degraded: false })
  })
})

describe("capture", () => {
  test("asks the page for its buffer and hands it to the capture flow; the tab stays armed", async () => {
    const { c, deps, sent } = setup()
    await c.arm(tab(3), 60_000)
    expect(await c.capture(tab(3))).toEqual({ ok: true, draftId: "d1" })
    expect(sent.at(-1)).toEqual([3, { type: "bugberry:replay-snapshot" }])
    expect(deps.capture).toHaveBeenCalledWith(tab(3), { events: [{ type: 4, timestamp: 1_000, data: {} }], since: 1_000, bytes: 10, degraded: false }, 120_000)
    expect((await c.status(3)).armed).toBe(true)
  })

  test("an unarmed tab, a paused one and a page that doesn't answer each say why", async () => {
    const s = setup()
    expect(await s.c.capture(tab(3))).toEqual({ ok: false, error: "This tab is not armed for replay" })
    await s.c.arm(tab(3), 60_000)
    s.reply(undefined)
    expect(await s.c.capture(tab(3))).toEqual({ ok: false, error: "BugBerry can't reach this page. Reload it and try again." })
    await s.c.recordingChanged(true)
    expect(await s.c.capture(tab(3))).toEqual({ ok: false, error: "Replay is paused while recording" })
    expect(s.deps.capture).not.toHaveBeenCalled()
  })
})

describe("frames", () => {
  test("come only for armed, unpaused tabs that are showing", async () => {
    const s = setup()
    expect(await s.c.frame(3, 1)).toEqual({ jpeg: null })
    await s.c.arm(tab(3), 60_000)
    expect(await s.c.frame(3, 1)).toEqual({ jpeg: "BASE64" })
    s.deps.isShowing.mockImplementationOnce(async () => false)
    expect(await s.c.frame(3, 1)).toEqual({ jpeg: null })
    await s.c.recordingChanged(true)
    expect(await s.c.frame(3, 1)).toEqual({ jpeg: null })
  })

  test("a captureVisibleTab failure is a null frame, not an error", async () => {
    const s = setup()
    await s.c.arm(tab(3), 60_000)
    s.deps.captureJpeg.mockImplementationOnce(async () => Promise.reject(new Error("rate limit")))
    expect(await s.c.frame(3, 1)).toEqual({ jpeg: null })
  })
})

describe("recordings", () => {
  test("a recording pauses every armed tab and its end starts them again, empty", async () => {
    const { c, sent, injected, badges } = setup()
    await c.arm(tab(3), 60_000)
    await c.recordingChanged(true)
    expect(sent.at(-1)).toEqual([3, { type: "bugberry:replay-stop" }])
    expect(await c.status(3)).toMatchObject({ suspended: true })
    expect(badges.at(-1)?.[1]).toMatchObject({ suspended: true })
    await c.recordingChanged(true)
    expect(sent.filter(([, message]) => (message as { type: string }).type === "bugberry:replay-stop")).toHaveLength(1)
    await c.recordingChanged(false)
    expect(injected).toEqual([3, 3])
    expect(await c.status(3)).toMatchObject({ suspended: false })
  })
})

describe("handle", () => {
  test("routes the popup's actions", async () => {
    const { c } = setup()
    expect(await c.handle({ type: "bugberry:replay", action: "arm", tabId: 3, windowMs: 30_000 }, tab(3))).toMatchObject({ armed: true, windowMs: 30_000 })
    expect(await c.handle({ type: "bugberry:replay", action: "status", tabId: 3 }, tab(3))).toMatchObject({ armed: true })
    expect(await c.handle({ type: "bugberry:replay", action: "capture", tabId: 3 }, tab(3))).toEqual({ ok: true, draftId: "d1" })
    expect(await c.handle({ type: "bugberry:replay", action: "disarm", tabId: 3 }, tab(3))).toEqual({ armed: false })
  })
})

describe("one change at a time", () => {
  test("a degraded notice arriving while a recording pauses the tab can't unpause it", async () => {
    // Session storage whose writes wait for `open`, so a read can land between another call's read and write.
    const items = new Map<string, unknown>()
    let open: () => void = () => {}
    let gate: Promise<void> = Promise.resolve()
    const session = {
      get: async (key: string) => (items.has(key) ? { [key]: structuredClone(items.get(key)) } : {}),
      set: async (patch: Record<string, unknown>) => {
        await gate
        for (const [key, value] of Object.entries(patch)) items.set(key, structuredClone(value))
      },
    }
    const s = setup()
    const c = createReplayController({ ...s.deps, armed: createArmedStore(session) })
    await c.arm(tab(3), 60_000)
    gate = new Promise((resolve) => {
      open = resolve
    })
    const pausing = c.recordingChanged(true)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const notice = c.degraded(3, true)
    await new Promise((resolve) => setTimeout(resolve, 5))
    open()
    await Promise.all([pausing, notice])
    expect(await c.status(3)).toMatchObject({ suspended: true })
  })
})
