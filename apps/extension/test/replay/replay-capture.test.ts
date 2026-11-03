import { describe, expect, mock, test } from "bun:test"
import { decodeReplayMedia, type ReplayEvent } from "@bugberry/shared"
import type { ActiveTab } from "../../lib/capture/capture-flow"
import type { DraftStore } from "../../lib/drafts/draft-store"
import { lastSegment, type ReplayCaptureDeps, startReplayReport, withinLimit } from "../../lib/replay/replay-capture"
import type { ReplayDraft, ReportDraft } from "../../lib/shared/types"

const meta = (timestamp: number): ReplayEvent => ({ type: 4, timestamp, data: { href: "https://app.test/", width: 800, height: 600 } })
const snap = (timestamp: number): ReplayEvent => ({ type: 2, timestamp, data: {} })
const inc = (timestamp: number): ReplayEvent => ({ type: 3, timestamp, data: {} })
const frame = (timestamp: number): ReplayEvent => ({ type: 5, timestamp, data: { tag: "bugberry:frame", payload: { jpeg: "AAAA" } } })

const tab = (id: number, extra: Partial<ActiveTab> = {}): ActiveTab => ({ id, windowId: 1, active: true, url: "https://app.test/cart", title: "Cart", ...extra })

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

function setup() {
  const store = memoryStore()
  const opened: Array<[string, number]> = []
  const console = (t: number) => ({ kind: "console", t, level: "log", args: [`at ${t}`] })
  const readPageCapture = mock(async (_tabId: number, keep?: { since: number }) => ({
    status: "ok",
    events: [console(40_000), console(55_000)].filter((event) => event.t >= (keep?.since ?? 0)),
    incomplete: [],
    metadata: { fields: null, error: null, droppedKeys: 0 },
    url: "https://app.test/cart",
  }))
  const deps: ReplayCaptureDeps = {
    readPageCapture,
    readEnvironment: async () => ({ language: "en-US" }),
    openReview: async (draftId, tabId) => void opened.push([draftId, tabId]),
    store,
    userAgent: "Mozilla/5.0 Chrome/140.0",
    now: () => 70_000,
    newId: () => "r1",
  }
  return { deps, store, opened, readPageCapture }
}

describe("lastSegment and withinLimit", () => {
  test("the last segment starts at the last Meta event; one segment is the whole list", () => {
    const events = [meta(0), snap(0), inc(50_000), meta(60_000), snap(60_000), inc(130_000)]
    expect(lastSegment(events).map((e) => e.timestamp)).toEqual([60_000, 60_000, 130_000])
    const one = [meta(0), snap(0)]
    expect(lastSegment(one)).toEqual(one)
  })

  test("a window longer than the recording limit keeps only the last segment", () => {
    const events = [meta(0), snap(0), inc(50_000), meta(60_000), snap(60_000), inc(130_000)]
    expect(withinLimit(events, 120_000).map((e) => e.timestamp)).toEqual([60_000, 60_000, 130_000])
    expect(withinLimit(events, 200_000)).toBe(events)
  })
})

describe("startReplayReport", () => {
  test("the draft holds the encoded media, the frames, the duration and a payload cut to the window", async () => {
    const { deps, store, opened } = setup()
    const snapshot = { since: 50_000, bytes: 1, degraded: false, events: [meta(50_000), snap(50_000), frame(55_000), inc(62_000)] }
    const result = await startReplayReport(tab(3), snapshot, deps, 120_000)
    expect(result).toEqual({ ok: true, draftId: "r1" })
    const draft = store.drafts.get("r1") as ReplayDraft
    expect(draft.captureType).toBe("replay")
    expect(draft.durationMs).toBe(12_000)
    expect(draft.frames).toEqual([5_000])
    expect(draft.recordingStartedAt).toBe(50_000)
    expect(draft.status).toBe("editing")
    expect(draft.tabId).toBe(3)
    expect(draft.page).toEqual({ url: "https://app.test/cart", title: "Cart" })
    expect(draft.debuggerPayload?.recordingStartedAt).toBe(50_000)
    expect(draft.debuggerPayload?.events.map((e) => e.t)).toEqual([55_000])
    expect((await decodeReplayMedia(draft.replay)).events).toHaveLength(4)
    expect(opened).toEqual([["r1", 3]])
  })

  test("a window over the limit starts the draft at the kept segment", async () => {
    const { deps, store } = setup()
    const events = [meta(0), snap(0), inc(50_000), meta(60_000), snap(60_000), inc(130_000)]
    await startReplayReport(tab(3), { since: 0, bytes: 1, degraded: false, events }, deps, 120_000)
    const draft = store.drafts.get("r1") as ReplayDraft
    expect(draft.recordingStartedAt).toBe(60_000)
    expect(draft.durationMs).toBe(70_000)
  })

  test("an empty buffer is refused", async () => {
    const { deps, store } = setup()
    expect(await startReplayReport(tab(3), { since: 0, bytes: 0, degraded: false, events: [] }, deps, 120_000)).toEqual({
      ok: false,
      error: "Nothing was recorded yet",
    })
    expect(store.drafts.size).toBe(0)
  })

  test("a page that isn't a web page is refused", async () => {
    const { deps } = setup()
    const result = await startReplayReport(tab(3, { url: "chrome://settings" }), { since: 0, bytes: 1, degraded: false, events: [meta(0)] }, deps, 120_000)
    expect(result.ok).toBe(false)
  })
})
