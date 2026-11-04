import { describe, expect, test } from "bun:test"
import { CAPTURE_PAUSE_EVENT, FLUSH_EVENT, FLUSH_REQUEST_EVENT } from "@bugberry/capture"
import { installPageFlush, type RecordingWatch } from "../../lib/recording/page-flush"

/** The page's capture script, answering a flush request the way the MAIN-world session does. */
function page(answer: string | null) {
  const document = new EventTarget()
  document.addEventListener(FLUSH_REQUEST_EVENT, () => {
    if (answer !== null) document.dispatchEvent(new CustomEvent(FLUSH_EVENT, { detail: answer }))
  })
  const window = new EventTarget()
  return { document, window, hide: () => window.dispatchEvent(new Event("pagehide")) }
}

/** The recording state as the extension's storage reports it: once at load, then on every change. */
function recordingState(atLoad: boolean) {
  let listener: Parameters<RecordingWatch>[0] = () => {}
  const watch: RecordingWatch = (onChange) => {
    listener = onChange
    onChange(atLoad, true)
  }
  return { watch, change: (recording: boolean) => listener(recording, false) }
}

const BUFFER = JSON.stringify({ documentId: "doc-1", events: [{ kind: "action", t: 1 }], incomplete: [] })
const FLUSH = { type: "bugberry:page-flush", documentId: "doc-1", events: [{ kind: "action", t: 1 }], incomplete: [] }

describe("installPageFlush", () => {
  test("the flush message carries the page's metadata snapshot and its URL", () => {
    const sent: unknown[] = []
    const withMetadata = JSON.stringify({ documentId: "doc-1", events: [], incomplete: [], metadata: { fields: { userId: "u1" }, error: null, droppedKeys: 0 } })
    const { document, window, hide } = page(withMetadata)
    const location = { href: "https://shop.test/checkout?token=abc" }
    installPageFlush({ document, window, location }, (message) => sent.push(message), recordingState(true).watch)
    hide()
    const message = sent.at(-1) as { metadata: string }
    expect(message).toMatchObject({ type: "bugberry:page-flush", url: "https://shop.test/checkout?token=abc" })
    // As text: Chrome sorts the keys of objects in runtime messages, and the app's order must survive.
    expect(JSON.parse(message.metadata)).toEqual({ fields: { userId: "u1" }, error: null, droppedKeys: 0 })
  })

  test("a page loaded during a recording says so, and sends its buffer as it goes away", () => {
    const sent: unknown[] = []
    const tab = page(BUFFER)
    installPageFlush({ document: tab.document, window: tab.window }, (message) => sent.push(message), recordingState(true).watch)
    expect(sent).toEqual([{ type: "bugberry:page-start" }])
    tab.hide()
    expect(sent).toEqual([{ type: "bugberry:page-start" }, FLUSH])
  })

  // Chrome leaves the old script in open tabs when the extension reloads mid-recording; sending from it throws at once.
  test("left behind by a reload, the page sends nothing as it goes away", () => {
    const sent: unknown[] = []
    let alive = true
    const tab = page(BUFFER)
    installPageFlush({ document: tab.document, window: tab.window }, (message) => sent.push(message), recordingState(true).watch, () => alive)
    alive = false
    tab.hide()
    expect(sent).toEqual([{ type: "bugberry:page-start" }])
  })

  test("the page open when the recording starts flushes too, without counting as a new page", () => {
    const sent: unknown[] = []
    const tab = page(BUFFER)
    const state = recordingState(false)
    installPageFlush({ document: tab.document, window: tab.window }, (message) => sent.push(message), state.watch)
    state.change(true)
    tab.hide()
    expect(sent).toEqual([FLUSH])
  })

  test("a page that is not being recorded sends nothing, also after the recording ended", () => {
    const sent: unknown[] = []
    const tab = page(BUFFER)
    const state = recordingState(true)
    installPageFlush({ document: tab.document, window: tab.window }, (message) => sent.push(message), state.watch)
    state.change(false)
    tab.hide()
    expect(sent).toEqual([{ type: "bugberry:page-start" }])
  })

  test("no answer, or an answer that is not JSON, sends no flush", () => {
    for (const answer of [null, "{not json", "42"]) {
      const sent: unknown[] = []
      const tab = page(answer)
      installPageFlush({ document: tab.document, window: tab.window }, (message) => sent.push(message), recordingState(true).watch)
      tab.hide()
      expect(sent).toEqual([{ type: "bugberry:page-start" }])
    }
  })
})

test("a pause tells the page's capture script to keep nothing, and a resume to keep going", () => {
  const tab = page(null)
  const told: unknown[] = []
  tab.document.addEventListener(CAPTURE_PAUSE_EVENT, (event) => told.push((event as CustomEvent).detail))
  let listener: Parameters<RecordingWatch>[0] = () => {}
  installPageFlush({ document: tab.document, window: tab.window }, () => {}, (onChange) => {
    listener = onChange
    // A page loaded while paused starts paused.
    onChange(true, true, true)
  })
  listener(true, false, false)
  listener(false, false, false)
  expect(told).toEqual(["on", "off"])
})
