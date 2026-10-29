import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AutomationDraftMeta } from "../../extension/lib/automation-draft"
import { createRecorderSession, type SessionDeps } from "../src/session"
import type { ContextLike, PageLike } from "../src/tabs"

class FakePage implements PageLike {
  closed = false
  reloads = 0
  constructor(private address = "about:blank") {}
  url() {
    return this.address
  }
  isClosed() {
    return this.closed
  }
  async goto(url: string) {
    this.address = url
  }
  async reload() {
    this.reloads++
  }
  async bringToFront() {}
}

function fakeContext() {
  const list = [new FakePage()]
  const listeners: Array<(page: FakePage) => void> = []
  return {
    pages: () => list,
    on: (_event: "page", listener: (page: FakePage) => void) => void listeners.push(listener),
    newPage: async () => {
      const page = new FakePage()
      list.push(page)
      return page
    },
    open(url: string) {
      const page = new FakePage(url)
      list.push(page)
      for (const listener of listeners) listener(page)
    },
  } satisfies ContextLike<FakePage> & { open(url: string): void }
}

function meta(overrides: Partial<AutomationDraftMeta> = {}): AutomationDraftMeta {
  return {
    durationMs: 12_400,
    pageUrl: "https://shop.test/checkout",
    pageTitle: "Checkout",
    device: { browser: "Chromium 156", os: "Windows", viewport: "1280x800" },
    debuggerSummary: { logs: 2, errors: 1, requests: 4, failedRequests: 1, actions: 3, incomplete: [] },
    agentActions: 3,
    stoppedAtLimitMs: null,
    endReason: null,
    sizes: { media: 5, debugger: 3, thumbnail: 2 },
    ...overrides,
  }
}

let tempDir: string
let context: ReturnType<typeof fakeContext>
let stored: AutomationDraftMeta
let calls: string[]
let stopAnswer: () => Promise<{ draftId: string }>
let readFailures: number
let front: { id: number; url: string } | null
let startDraft: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "recorder-test-"))
  context = fakeContext()
  stored = meta()
  calls = []
  stopAnswer = async () => ({ draftId: "draft-1" })
  readFailures = 0
  front = { id: 7, url: "https://shop.test/checkout" }
  startDraft = "draft-1"
})
afterEach(() => rmSync(tempDir, { recursive: true, force: true }))

function session(overrides: Partial<SessionDeps<FakePage>> = {}) {
  return createRecorderSession<FakePage>({
    cdpEndpoint: "http://127.0.0.1:9555",
    tempDir,
    launch: async () => {
      calls.push("launch")
      return { context, isOpen: () => true, close: async () => {} }
    },
    caps: async () => ({ maxMs: 120_000, maxBytes: 1_000_000 }),
    start: async (_browser, page) => {
      calls.push(`start ${page.url()}`)
      return { draftId: startDraft, tabId: 7 }
    },
    stop: async () => stopAnswer(),
    read: async (_browser, _id, dir) => {
      if (readFailures-- > 0) throw new Error("Target page, context or browser has been closed")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "media.webm"), Buffer.from([1, 2, 3, 4, 5]))
      writeFileSync(join(dir, "debugger.json.gz"), Buffer.from([9, 9, 9]))
      if (stored.sizes.thumbnail) writeFileSync(join(dir, "thumbnail.jpg"), Buffer.from([7, 7]))
      return stored
    },
    remove: async (_browser, id) => void calls.push(`delete ${id}`),
    frontTab: async () => front,
    newId: () => "rec-1",
    ...overrides,
  })
}

describe("recorder session", () => {
  test("refuses a non-http url", async () => {
    await expect(session().start("file:///etc/passwd")).rejects.toThrow("http")
    expect(calls).toEqual([])
  })

  test("refuses to start twice", async () => {
    const recorder = session()
    await recorder.start("https://shop.test/checkout")
    await expect(recorder.start("https://shop.test/checkout")).rejects.toThrow("already running")
  })

  test("start answers with the tab, the endpoint and the rules", async () => {
    const result = await session().start("https://shop.test/checkout")
    expect(result.tabIndex).toBe(0)
    expect(result.cdpEndpoint).toBe("http://127.0.0.1:9555")
    for (const part of ["bugberry-browser", "stopRecording", "tab 0"]) expect(result.text).toContain(part)
    expect(calls).toEqual(["launch", "start https://shop.test/checkout"])
  })

  test("the page is reloaded once recording runs, so errors on load are caught", async () => {
    await session().start("https://shop.test/checkout")
    expect(context.pages()[0]?.reloads).toBe(1)
  })

  test("refuses an empty recording", async () => {
    stored = meta({ agentActions: 0, debuggerSummary: { logs: 0, errors: 0, requests: 2, failedRequests: 0, actions: 1, incomplete: [] } })
    const recorder = session()
    await recorder.start("https://shop.test/checkout")
    await expect(recorder.stop()).rejects.toThrow("Did you use the bugberry-browser tools?")
    expect(calls).toContain("delete draft-1")
  })

  test("stop keeps the files and returns what createUpload takes", async () => {
    const recorder = session()
    await recorder.start("https://shop.test/checkout")
    const result = await recorder.stop()
    expect(result.recordingId).toBe("rec-1")
    expect(result.endedBy).toBe("agent")
    expect(result.recording).toEqual({
      mediaSize: 5,
      debuggerSize: 3,
      thumbnailSize: 2,
      durationMs: 12_400,
      pageUrl: "https://shop.test/checkout",
      pageTitle: "Checkout",
      device: { browser: "Chromium 156", os: "Windows", viewport: "1280x800" },
      debuggerSummary: { logs: 2, errors: 1, requests: 4, failedRequests: 1, actions: 3, incomplete: [] },
    })
    const kept = recorder.take("rec-1")
    expect(kept && [...readFileSync(kept.mediaPath)]).toEqual([1, 2, 3, 4, 5])
    expect(kept?.draftId).toBe("draft-1")
    expect(result.summary).toContain("1 error")
    expect(result.summary).toContain("createUpload")
  })

  test("stop result recording matches createUpload's input", async () => {
    const recorder = session()
    await recorder.start("https://shop.test/checkout")
    const { recording } = await recorder.stop()
    expect(Object.keys(recording).sort()).toEqual(
      ["mediaSize", "debuggerSize", "thumbnailSize", "durationMs", "pageUrl", "pageTitle", "device", "debuggerSummary"].sort(),
    )
  })

  test("a recording without a thumbnail leaves thumbnailSize out", async () => {
    stored = meta({ sizes: { media: 5, debugger: 3, thumbnail: null } })
    const recorder = session()
    await recorder.start("https://shop.test/checkout")
    const { recording } = await recorder.stop()
    expect("thumbnailSize" in recording).toBe(false)
    expect(recorder.take("rec-1")?.thumbnailPath).toBeNull()
    expect(existsSync(join(tempDir, "rec-1", "thumbnail.jpg"))).toBe(false)
  })

  test("limit-ended recording is returned with its reason", async () => {
    stored = meta({ stoppedAtLimitMs: 120_000, endReason: "max-duration" })
    // The extension stopped it by itself when the limit came, so there is nothing to stop any more.
    stopAnswer = async () => {
      throw new Error("Couldn't stop the recording: No recording is running")
    }
    const recorder = session()
    await recorder.start("https://shop.test/checkout")
    const result = await recorder.stop()
    expect(result.endedBy).toBe("limit")
    expect(result.summary).toContain("2:00")
  })

  test("a size limit or a closed tab is said too", async () => {
    for (const [endReason, endedBy, words] of [
      ["size-limit", "limit", "size limit"],
      ["source-ended", "tab-closed", "tab closed"],
    ] as const) {
      stored = meta({ endReason })
      const recorder = session()
      await recorder.start("https://shop.test/checkout")
      const result = await recorder.stop()
      expect(result.endedBy).toBe(endedBy)
      expect(result.summary).toContain(words)
    }
  })

  test("a stop that fails to read can be tried again", async () => {
    readFailures = 1
    const recorder = session()
    await recorder.start("https://shop.test/checkout")
    await expect(recorder.stop()).rejects.toThrow("call stopRecording again")
    expect((await recorder.status()).recording).toBe(true)
    const result = await recorder.stop()
    expect(result.recordingId).toBe("rec-1")
    expect((await recorder.status()).recording).toBe(false)
  })

  test("stop includes the tab warning", async () => {
    const recorder = session()
    await recorder.start("https://shop.test/checkout")
    context.open("https://shop.test/two")
    const result = await recorder.stop()
    expect(result.warning).toContain("Go back to tab 0")
  })

  test("stop with nothing recording says to start first", async () => {
    await expect(session().stop()).rejects.toThrow("startRecording")
  })

  test("discard stops and drops the draft", async () => {
    const recorder = session()
    await recorder.start("https://shop.test/checkout")
    await recorder.discard()
    expect(calls).toContain("delete draft-1")
    expect((await recorder.status()).recording).toBe(false)
  })

  test("close shuts the browser it launched", async () => {
    let closed = 0
    const recorder = session({ launch: async () => ({ context, isOpen: () => closed === 0, close: async () => void closed++ }) })
    await recorder.close()
    expect(closed).toBe(0)
    await recorder.start("https://shop.test/checkout")
    await recorder.close()
    expect(closed).toBe(1)
    expect((await recorder.status()).recording).toBe(false)
  })

  test("status says how long it has run and repeats the warning", async () => {
    let now = 1000
    const recorder = session({ now: () => now })
    expect(await recorder.status()).toMatchObject({ recording: false })
    await recorder.start("https://shop.test/checkout")
    now = 8000
    context.open("https://shop.test/two")
    expect(await recorder.status()).toMatchObject({ recording: true, seconds: 7 })
    expect((await recorder.status()).warning).toContain("Go back to tab 0")
  })

  test("status says when the time limit has stopped the recording", async () => {
    let now = 1000
    const recorder = session({ now: () => now })
    await recorder.start("https://shop.test/checkout")
    now = 1000 + 121_000
    expect((await recorder.status()).warning).toContain("limit")
  })
  test("status and stop warn when the agent went to a tab that was already open", async () => {
    const recorder = session()
    await recorder.start("https://shop.test/checkout")
    expect((await recorder.status()).warning).toBeNull()
    front = { id: 9, url: "https://shop.test/old" }
    const warning = (await recorder.status()).warning
    expect(warning).toContain("https://shop.test/old")
    expect(warning).toContain("Go back to tab 0")
    expect((await recorder.stop()).warning).toContain("https://shop.test/old")
  })

  test("the extension's own page in front is no reason to warn", async () => {
    const recorder = session()
    await recorder.start("https://shop.test/checkout")
    front = { id: 3, url: "chrome-extension://abc/automation.html" }
    expect((await recorder.status()).warning).toBeNull()
  })

  test("close removes what was never sent: files, drafts, the running recording and the temp folder", async () => {
    const recorder = session({ newId: (() => { let n = 0; return () => `rec-${++n}` })() })
    await recorder.start("https://shop.test/checkout")
    await recorder.stop()
    expect(existsSync(join(tempDir, "rec-1", "media.webm"))).toBe(true)
    startDraft = "draft-2"
    await recorder.start("https://shop.test/checkout")
    await recorder.close()
    expect(calls).toContain("delete draft-1")
    expect(calls).toContain("delete draft-2")
    expect(existsSync(tempDir)).toBe(false)
  })
})
