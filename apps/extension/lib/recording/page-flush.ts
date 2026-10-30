import { CAPTURE_PAUSE_EVENT, FLUSH_EVENT, FLUSH_REQUEST_EVENT } from "@bugberry/capture"
import type { PageFlushMessage, PageStartMessage } from "../shared/messages"

export interface FlushHost {
  /** The page's document, shared with the capture script in the MAIN world. */
  document: EventTarget
  window: EventTarget
}

/**
 * Reports whether a recording is running: once when the page loads (`atLoad` true), then on every
 * change. Read from the extension's session storage, so nothing wakes the background on a normal page load.
 */
export type RecordingWatch = (onChange: (recording: boolean, atLoad: boolean, paused?: boolean) => void) => void

/**
 * Runs in the extension's isolated world. A page loaded while a recording runs says so (the background
 * counts it); when any page goes away during a recording (reload, link, back/forward), it asks the
 * capture script for this document's events and hands them to the background, which keeps them only for
 * the recorded tab. Everything inside pagehide happens synchronously.
 */
export function installPageFlush(
  host: FlushHost,
  send: (message: PageFlushMessage | PageStartMessage) => void,
  watch: RecordingWatch,
): void {
  let recorded = false
  let paused = false
  watch((recording, atLoad, nowPaused = false) => {
    recorded = recording
    if (recording && atLoad) send({ type: "bugberry:page-start" })
    // The capture script in the page keeps nothing while the recording is paused.
    const pause = recording && nowPaused
    if (pause !== paused) host.document.dispatchEvent(new CustomEvent(CAPTURE_PAUSE_EVENT, { detail: pause ? "on" : "off" }))
    paused = pause
  })
  host.window.addEventListener("pagehide", () => {
    if (!recorded) return
    let answer: unknown = null
    const onFlush = (event: Event) => {
      answer = (event as CustomEvent).detail
    }
    host.document.addEventListener(FLUSH_EVENT, onFlush)
    host.document.dispatchEvent(new CustomEvent(FLUSH_REQUEST_EVENT))
    host.document.removeEventListener(FLUSH_EVENT, onFlush)
    if (typeof answer !== "string") return
    let parsed: unknown
    try {
      parsed = JSON.parse(answer)
    } catch {
      return
    }
    if (typeof parsed !== "object" || parsed === null) return
    const value = parsed as Record<string, unknown>
    // The page could forge this answer; the background checks every field before keeping it.
    send({
      type: "bugberry:page-flush",
      documentId: String(value.documentId),
      events: Array.isArray(value.events) ? value.events : [],
      incomplete: Array.isArray(value.incomplete) ? value.incomplete : [],
    })
  })
}
