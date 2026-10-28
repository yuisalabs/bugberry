import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AutomationDraft } from "../../extension/lib/automation-draft"
import { createRecorderSession, type SessionDeps } from "../src/session"
import type { ContextLike, PageLike } from "../src/tabs"

class FakePage implements PageLike {
  closed = false
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

const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64")

function draft(overrides: Partial<AutomationDraft> = {}): AutomationDraft {
  return {
    videoBase64: b64([1, 2, 3, 4, 5]),
    debuggerBase64: b64([9, 9, 9]),
    thumbnailBase64: b64([7, 7]),
    durationMs: 12_400,
    pageUrl: "https://shop.test/checkout",
    pageTitle: "Checkout",
    device: { browser: "Chromium 156", os: "Windows", viewport: "1280x800" },
    debuggerSummary: { logs: 2, errors: 1, requests: 4, failedRequests: 1, actions: 3, incomplete: [] },
    stoppedAtLimitMs: null,
    ...overrides,
  }
}

let tempDir: string
let context: ReturnType<typeof fakeContext>
let stored: AutomationDraft
let calls: string[]
let stopAnswer: () => Promise<{ draftId: string }>

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "recorder-test-"))
  context = fakeContext()
  stored = draft()
  calls = []
  stopAnswer = async () => ({ draftId: "draft-1" })
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
      return { draftId: "draft-1" }
    },
    stop: async () => stopAnswer(),
    read: async () => stored,
    remove: async (_browser, id) => void calls.push(`delete ${id}`),
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

  test("refuses an empty recording", async () => {
    stored = draft({ debuggerSummary: { logs: 0, errors: 0, requests: 2, failedRequests: 0, actions: 0, incomplete: [] } })
    const recorder = session()
    await recorder.start("https://shop.test/checkout")
    await expect(recorder.stop()).rejects.toThrow("Did you use the bugberry-browser tools?")
    expect(calls).toContain("delete draft-1")
  })

  test("stop writes the files and returns what createUpload takes", async () => {
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
    stored = draft({ thumbnailBase64: null })
    const recorder = session()
    await recorder.start("https://shop.test/checkout")
    const { recording } = await recorder.stop()
    expect("thumbnailSize" in recording).toBe(false)
    expect(existsSync(recorder.take("rec-1")?.thumbnailPath ?? "/none")).toBe(false)
  })

  test("limit-ended recording is returned with its reason", async () => {
    stored = draft({ stoppedAtLimitMs: 120_000 })
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
    expect(recorder.status().recording).toBe(false)
  })

  test("status says how long it has run and repeats the warning", async () => {
    let now = 1000
    const recorder = session({ now: () => now })
    expect(recorder.status()).toMatchObject({ recording: false })
    await recorder.start("https://shop.test/checkout")
    now = 8000
    context.open("https://shop.test/two")
    expect(recorder.status()).toMatchObject({ recording: true, seconds: 7 })
    expect(recorder.status().warning).toContain("Go back to tab 0")
  })
})
