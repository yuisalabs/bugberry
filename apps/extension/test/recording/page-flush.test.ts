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
  test("a page loaded during a recording says so, and sends its buffer as it goes away", () => {
    const sent: unknown[] = []
    const tab = page(BUFFER)
    installPageFlush({ document: tab.document, window: tab.window }, (message) => sent.push(message), recordingState(true).watch)
    expect(sent).toEqual([{ type: "bugberry:page-start" }])
    tab.hide()
    expect(sent).toEqual([{ type: "bugberry:page-start" }, FLUSH])
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
