import { beforeEach, describe, expect, test } from "bun:test"
import { type CaptureFlowDeps, sanitizePageCapture, startScreenshotReport } from "../../lib/capture/capture-flow"
import type { DraftStore } from "../../lib/draft-store"
import type { ReportDraft, ScreenshotDraft } from "../../lib/types"

const PNG_DATA_URL = `data:image/png;base64,${btoa("fake-png")}`
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"

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

let store: ReturnType<typeof memoryStore>
let opened: string[]
let reviewTabs: number[]
let captured: number[]
let deps: CaptureFlowDeps

const tab = {
  id: 7,
  windowId: 3,
  url: "https://app.kantor.test/checkout?session_token=abc",
  title: "Checkout",
  width: 1440,
  height: 900,
}

beforeEach(() => {
  store = memoryStore()
  opened = []
  reviewTabs = []
  captured = []
  deps = {
    captureVisibleTab: async (windowId) => {
      captured.push(windowId)
      return PNG_DATA_URL
    },
    readPageCapture: async () => ({
      status: "ok",
      events: [{ kind: "console", t: 5, level: "error", args: ["boom"] }],
      incomplete: [],
    }),
    readEnvironment: async () => ({ language: "id-ID", timeZone: "Asia/Jakarta", pixelRatio: 2 }),
    openReview: async (id, tabId) => {
      opened.push(id)
      reviewTabs.push(tabId)
    },
    store,
    userAgent: USER_AGENT,
    now: () => 1000,
    newId: () => "draft-1",
    pickArea: async () => ({ kind: "visible" }),
    cropImage: async () => new Blob(["cropped"], { type: "image/png" }),
  }
})

describe("startScreenshotReport", () => {
  test("stores a draft with the screenshot, page details and buffered events, then opens the editor", async () => {
    expect(await startScreenshotReport(tab, deps)).toEqual({ ok: true, draftId: "draft-1" })
    const draft = store.drafts.get("draft-1") as ScreenshotDraft | undefined
    expect(captured).toEqual([3])
    expect(await draft?.screenshot.text()).toBe("fake-png")
    expect(draft?.page.title).toBe("Checkout")
    expect(draft?.page.url).not.toContain("abc")
    expect(draft?.device).toEqual({ browser: "Chrome 141", os: "Windows", viewport: "1440x900" })
    expect(draft?.debuggerPayload).toMatchObject({ version: 1, capturedAt: 1000, recordingStartedAt: null, incomplete: [] })
    expect(draft?.debuggerPayload?.events).toHaveLength(1)
    expect(draft?.debuggerPayload?.environment).toEqual({ language: "id-ID", timeZone: "Asia/Jakarta", pixelRatio: 2 })
    expect(draft?.status).toBe("editing")
    expect(opened).toEqual(["draft-1"])
  })

  test("refuses pages the extension cannot capture, without creating a draft", async () => {
    for (const url of ["chrome://settings", "https://chromewebstore.google.com/detail/x", "https://addons.mozilla.org/firefox/addon/x", "https://addons.opera.com/extensions/details/x", "file:///C:/a.pdf", undefined]) {
      const result = await startScreenshotReport({ ...tab, url }, deps)
      expect(result.ok).toBe(false)
    }
    expect(captured).toEqual([])
    expect(store.drafts.size).toBe(0)
  })

  test("refuses a tab that is not the one showing, instead of capturing whatever is visible", async () => {
    const result = await startScreenshotReport({ ...tab, active: false }, deps)
    expect(result).toMatchObject({ ok: false })
    expect(result.ok ? "" : result.error).toContain("isn't showing")
    expect(captured).toEqual([])
  })

  test("reports a failed screenshot clearly", async () => {
    deps.captureVisibleTab = async () => {
      throw new Error("Cannot access contents of the page")
    }
    const result = await startScreenshotReport(tab, deps)
    expect(result).toEqual({ ok: false, error: "Screenshot failed: Cannot access contents of the page" })
    expect(store.drafts.size).toBe(0)
  })

  test("still creates the draft when the page has no capture session", async () => {
    deps.readPageCapture = async () => ({ status: "missing" })
    await startScreenshotReport(tab, deps)
    expect(store.drafts.get("draft-1")?.debuggerPayload).toMatchObject({ incomplete: ["not-injected"], events: [] })
  })

  test("still creates the draft when the page cannot be read or returns junk", async () => {
    deps.readPageCapture = async () => {
      throw new Error("Frame with ID 0 was removed")
    }
    await startScreenshotReport(tab, deps)
    expect(store.drafts.get("draft-1")?.debuggerPayload?.incomplete).toEqual(["page-access"])

    deps.readPageCapture = async () => ({ status: "ok", events: "lol", incomplete: [] })
    deps.newId = () => "draft-2"
    await startScreenshotReport(tab, deps)
    expect(store.drafts.get("draft-2")?.debuggerPayload?.incomplete).toEqual(["page-access"])
  })
})

describe("the review", () => {
  test("a screenshot opens the review on its tab, and remembers the tab and how it was taken", async () => {
    await startScreenshotReport(tab, deps, "area")
    expect(reviewTabs).toEqual([7])
    expect(store.drafts.get("draft-1")).toMatchObject({ tabId: 7, screenshotMode: "area" })
  })
})

describe("startScreenshotReport with Select area", () => {
  test("stores the cropped part of the screenshot", async () => {
    const crops: unknown[] = []
    deps.pickArea = async () => ({ kind: "area", rect: { x: 10, y: 20, width: 100, height: 50 }, pixelRatio: 2 })
    deps.cropImage = async (dataUrl, rect, pixelRatio) => {
      crops.push([dataUrl, rect, pixelRatio])
      return new Blob(["cropped"], { type: "image/png" })
    }
    expect(await startScreenshotReport(tab, deps, "area")).toEqual({ ok: true, draftId: "draft-1" })
    expect(crops).toEqual([[PNG_DATA_URL, { x: 10, y: 20, width: 100, height: 50 }, 2]])
    const draft = store.drafts.get("draft-1") as ScreenshotDraft
    expect(await draft.screenshot.text()).toBe("cropped")
    expect(opened).toEqual(["draft-1"])
  })

  test("Esc leaves nothing behind and is not a failure", async () => {
    deps.pickArea = async () => ({ kind: "cancel" })
    expect(await startScreenshotReport(tab, deps, "area")).toEqual({ ok: false, code: "cancelled", error: "Cancelled" })
    expect(store.drafts.size).toBe(0)
    expect(captured).toEqual([])
  })

  test("a click without a drag stores the whole visible area", async () => {
    deps.cropImage = async () => {
      throw new Error("must not crop")
    }
    expect(await startScreenshotReport(tab, deps, "area")).toEqual({ ok: true, draftId: "draft-1" })
    expect(await (store.drafts.get("draft-1") as ScreenshotDraft).screenshot.text()).toBe("fake-png")
  })

  test("a page that can't be captured is refused before the overlay", async () => {
    let picked = false
    deps.pickArea = async () => {
      picked = true
      return { kind: "visible" }
    }
    expect((await startScreenshotReport({ ...tab, url: "chrome://settings" }, deps, "area")).ok).toBe(false)
    expect(picked).toBe(false)
  })

  test("a page the overlay can't be put on says so, instead of doing nothing", async () => {
    deps.pickArea = () => Promise.reject(new Error("Cannot access contents of the page"))
    expect(await startScreenshotReport(tab, deps, "area")).toEqual({
      ok: false,
      error: "BugBerry can't reach this page. Reload it and try again.",
    })
    expect(store.drafts.size).toBe(0)
  })

  test("an answer the page made up is treated as a cancel", async () => {
    deps.pickArea = async () => ({ kind: "area", rect: "everything" })
    expect(await startScreenshotReport(tab, deps, "area")).toMatchObject({ ok: false, code: "cancelled" })
  })
})

describe("sanitizePageCapture", () => {
  test("keeps well-formed events, drops malformed ones and caps the count", () => {
    const events = [
      { kind: "action", t: 1, type: "click" },
      { kind: "console", t: "soon" },
      null,
      ...Array.from({ length: 1500 }, (_, i) => ({ kind: "console", t: i, level: "log", args: [] })),
    ]
    const result = sanitizePageCapture({ status: "ok", events, incomplete: ["xhr", 5] })
    expect(result?.status).toBe("ok")
    if (result?.status !== "ok") throw new Error("expected ok")
    expect(result.events).toHaveLength(1000)
    expect(result.events.every((event) => typeof event.t === "number")).toBe(true)
    expect(result.incomplete).toEqual(["xhr"])
  })

  test("keeps page resources and page timing, and still drops unknown kinds", () => {
    const result = sanitizePageCapture({
      status: "ok",
      events: [
        { kind: "page", t: 1, url: "https://shop.test/", via: "reload" },
        { kind: "resource", t: 2, url: "https://shop.test/app.js", initiatorType: "script" },
        { kind: "telemetry", t: 3 },
      ],
      incomplete: [],
    })
    if (result?.status !== "ok") throw new Error("expected ok")
    expect(result.events.map((event) => event.kind)).toEqual(["page", "resource"])
  })

  test("recognises a missing session and rejects anything else", () => {
    expect(sanitizePageCapture({ status: "missing" })).toEqual({ status: "missing" })
    expect(sanitizePageCapture("junk")).toBeNull()
    expect(sanitizePageCapture({ status: "ok", events: {} })).toBeNull()
  })
})

describe("page data limits", () => {
  test("drops malformed incomplete names and oversized events", () => {
    const result = sanitizePageCapture({
      status: "ok",
      events: [
        { kind: "console", t: 1, level: "log", args: ["x".repeat(100_000)] },
        { kind: "action", t: 2, type: "click" },
      ],
      incomplete: ["xhr", "x".repeat(60), "Bad Name"],
    })
    if (result?.status !== "ok") throw new Error("expected ok")
    expect(result.incomplete).toEqual(["xhr"])
    expect(result.events.map((event) => event.t)).toEqual([2])
  })

  test("keeps the whole payload bounded by dropping the oldest events", () => {
    const events = Array.from({ length: 1000 }, (_, i) => ({ kind: "console", t: i, level: "log", args: ["y".repeat(30_000)] }))
    const result = sanitizePageCapture({ status: "ok", events, incomplete: [] })
    if (result?.status !== "ok") throw new Error("expected ok")
    expect(JSON.stringify(result.events).length).toBeLessThanOrEqual(8 * 1024 * 1024)
    expect(result.events.at(-1)?.t).toBe(999)
    expect(result.events.length).toBeLessThan(1000)
  })
})

describe("startScreenshotReport with a stuck page", () => {
  test("a page that never answers is recorded as page-timeout and the draft is still created", async () => {
    deps.readPageCapture = () => new Promise(() => {})
    deps.pageReadTimeoutMs = 20
    expect(await startScreenshotReport(tab, deps)).toEqual({ ok: true, draftId: "draft-1" })
    const draft = store.drafts.get("draft-1") as ScreenshotDraft | undefined
    expect(draft?.debuggerPayload?.incomplete).toEqual(["page-timeout"])
    expect(draft?.annotations).toEqual([])
    expect(draft?.form).toBeNull()
  })
})
