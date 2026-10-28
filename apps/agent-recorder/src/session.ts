import { rmSync } from "node:fs"
import { join } from "node:path"
import type { DebuggerSummary, DeviceInfo } from "@bugberry/shared"
import type { AutomationDraftMeta } from "../../extension/lib/automation-draft"
import type { RecordingCaps } from "./limits"
import { agentTabs, type ContextLike, createTabWatcher, type PageLike, recordedPageFor, type TabWatcher } from "./tabs"

/** The browser the session records in; Chromium with the extension in real use. */
export interface RecorderBrowser<P extends PageLike> {
  context: ContextLike<P>
  /** False once the person closed Chromium: the next recording launches it again. */
  isOpen(): boolean
  close(): Promise<void>
}

export interface SessionDeps<P extends PageLike> {
  cdpEndpoint: string
  tempDir: string
  launch(): Promise<RecorderBrowser<P>>
  caps(): Promise<RecordingCaps>
  start(browser: RecorderBrowser<P>, page: P, caps: RecordingCaps): Promise<{ draftId: string }>
  stop(browser: RecorderBrowser<P>): Promise<{ draftId: string }>
  /** Writes the draft's files into `dir` (media.webm, debugger.json.gz, thumbnail.jpg when there is one). */
  read(browser: RecorderBrowser<P>, draftId: string, dir: string): Promise<AutomationDraftMeta>
  remove(browser: RecorderBrowser<P>, draftId: string): Promise<void>
  newId?(): string
  now?(): number
}

/** Exactly what BugBerry's createUpload takes as `recording`. */
export interface RecordingInfo {
  mediaSize: number
  debuggerSize: number
  thumbnailSize?: number
  durationMs: number
  pageUrl: string
  pageTitle: string
  device: DeviceInfo
  debuggerSummary: DebuggerSummary
}

export interface StartResult {
  text: string
  tabIndex: number
  cdpEndpoint: string
}

export interface StopResult {
  recordingId: string
  summary: string
  warning: string | null
  /** Who ended it: the agent, a time or size limit, the recorded tab closing, or a recorder error. */
  endedBy: "agent" | "limit" | "tab-closed" | "error"
  recording: RecordingInfo
}

/** A stopped recording waiting for submitRecording: its files on disk and the extension draft they came from. */
export interface StoredRecording {
  recordingId: string
  draftId: string
  dir: string
  mediaPath: string
  debuggerPath: string
  thumbnailPath: string | null
}

export interface RecorderSession {
  start(url: string): Promise<StartResult>
  status(): { recording: boolean; seconds: number; warning: string | null }
  stop(): Promise<StopResult>
  discard(): Promise<void>
  take(recordingId: string): StoredRecording | null
  /** Drops a submitted recording: its files, and the draft in the extension. */
  forget(recordingId: string): Promise<void>
  /** Closes the browser, as the recorder shuts down. */
  close(): Promise<void>
}

export const EMPTY_RECORDING =
  "Nothing was recorded: no click, typing or page change happened in the recorded tab. Did you use the bugberry-browser " +
  "tools? Your other browser tools drive a different browser."

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
const clock = (ms: number) => {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function endedByOf(meta: AutomationDraftMeta): StopResult["endedBy"] {
  if (meta.endReason === "max-duration" || meta.endReason === "size-limit") return "limit"
  if (meta.endReason === "source-ended") return "tab-closed"
  return meta.endReason === "error" ? "error" : "agent"
}

/** Why it stopped before the agent asked, so the agent knows what after that point is missing. */
function endedLine(meta: AutomationDraftMeta): string {
  switch (meta.endReason) {
    case "max-duration":
      return `The recording reached its ${clock(meta.stoppedAtLimitMs ?? meta.durationMs)} limit and stopped by itself: nothing after that is in it.`
    case "size-limit":
      return "The recording reached the server's size limit and stopped by itself: nothing after that is in it."
    case "source-ended":
      return "The recorded tab closed, so the recording stopped there."
    case "error":
      return "The recorder stopped early after an error: nothing after that is in it."
    default:
      return ""
  }
}

function summaryOf(draft: AutomationDraftMeta): string {
  const s = draft.debuggerSummary
  return [
    `Recorded ${clock(draft.durationMs)} on ${draft.pageUrl}.`,
    endedLine(draft),
    `Caught ${plural(s.actions, "action")}, ${plural(s.logs, "console log")} (${plural(s.errors, "error")}), ` +
      `${plural(s.requests, "request")} (${s.failedRequests} failed).`,
    "Next: write a title and description from what you saw, call createUpload on the BugBerry server with this " +
      "`recording` object unchanged, then call submitRecording here with the uploadLink it returns.",
  ]
    .filter(Boolean)
    .join(" ")
}

/** One browser, one recording at a time; the tab it recorded is kept for the next recording. */
export function createRecorderSession<P extends PageLike>(deps: SessionDeps<P>): RecorderSession {
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? (() => crypto.randomUUID())
  let browser: RecorderBrowser<P> | null = null
  let watcher: TabWatcher | null = null
  let page: P | null = null
  /** `stopped` once the extension stopped it: a stop whose reading failed then only reads again. */
  let running: { draftId: string; startedAt: number; maxMs: number; stopped: boolean } | null = null
  const stored = new Map<string, StoredRecording>()

  const ensureBrowser = async (): Promise<RecorderBrowser<P>> => {
    if (browser?.isOpen()) return browser
    running = null
    const launched = await deps.launch()
    browser = launched
    page = null
    watcher = createTabWatcher(launched.context, () => page)
    return launched
  }

  return {
    async start(url) {
      let parsed: URL | null = null
      try {
        parsed = new URL(url)
      } catch {}
      if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
        throw new Error("startRecording needs a web page address starting with http:// or https://.")
      }
      if (running) throw new Error("A recording is already running. Call stopRecording or discardRecording first.")
      const current = await ensureBrowser()
      page = await recordedPageFor(current.context, page, parsed.href)
      watcher?.reset()
      const caps = await deps.caps()
      const { draftId } = await deps.start(current, page, caps)
      running = { draftId, startedAt: now(), maxMs: caps.maxMs, stopped: false }
      // Loaded again while recording, so errors and failed requests on load are in the report.
      await page.reload()
      const tabIndex = agentTabs(current.context).indexOf(page)
      const others = agentTabs(current.context).length > 1
      return {
        tabIndex,
        cdpEndpoint: deps.cdpEndpoint,
        text: [
          `Recording tab ${tabIndex} (${parsed.href}).`,
          `Drive it with the bugberry-browser tools (they attach to ${deps.cdpEndpoint}), in this tab only: open no new tabs, as other tabs are not recorded.`,
          others ? `Other tabs are open: select tab ${tabIndex} with browser_tabs before you start.` : "",
          "When you have shown the bug, call stopRecording.",
        ]
          .filter(Boolean)
          .join(" "),
      }
    },

    status() {
      if (!running) return { recording: false, seconds: 0, warning: null }
      const elapsed = now() - running.startedAt
      const limit = elapsed >= running.maxMs ? `The recording reached its ${clock(running.maxMs)} limit and has stopped: call stopRecording to keep it.` : null
      return { recording: true, seconds: Math.round(elapsed / 1000), warning: [watcher?.warning(), limit].filter(Boolean).join(" ") || null }
    },

    async stop() {
      if (!running || !browser) throw new Error("Nothing is recording. Call startRecording first.")
      const current = running
      const warning = watcher?.warning() ?? null
      if (!current.stopped) {
        // A limit may have stopped it already; its draft is the one this recording started.
        await deps.stop(browser).catch((error: unknown) => {
          if (!String(error).includes("No recording is running")) throw error
        })
        current.stopped = true
      }
      const recordingId = newId()
      const dir = join(deps.tempDir, recordingId)
      let meta: AutomationDraftMeta
      try {
        meta = await deps.read(browser, current.draftId, dir)
      } catch (error) {
        rmSync(dir, { recursive: true, force: true })
        throw new Error(`Couldn't read the recording (${error instanceof Error ? error.message : String(error)}). It is kept: call stopRecording again.`)
      }
      running = null
      if (meta.agentActions === 0) {
        rmSync(dir, { recursive: true, force: true })
        await deps.remove(browser, current.draftId)
        throw new Error(EMPTY_RECORDING)
      }
      const kept: StoredRecording = {
        recordingId,
        draftId: current.draftId,
        dir,
        mediaPath: join(dir, "media.webm"),
        debuggerPath: join(dir, "debugger.json.gz"),
        thumbnailPath: meta.sizes.thumbnail === null ? null : join(dir, "thumbnail.jpg"),
      }
      stored.set(recordingId, kept)
      return {
        recordingId,
        summary: summaryOf(meta),
        warning,
        endedBy: endedByOf(meta),
        recording: {
          mediaSize: meta.sizes.media,
          debuggerSize: meta.sizes.debugger,
          ...(meta.sizes.thumbnail === null ? {} : { thumbnailSize: meta.sizes.thumbnail }),
          durationMs: meta.durationMs,
          pageUrl: meta.pageUrl,
          pageTitle: meta.pageTitle,
          device: meta.device,
          debuggerSummary: meta.debuggerSummary,
        },
      }
    },

    async discard() {
      if (!running || !browser) return
      const { draftId } = running
      running = null
      await deps.stop(browser).catch(() => {})
      await deps.remove(browser, draftId)
    },

    take: (recordingId) => stored.get(recordingId) ?? null,

    async forget(recordingId) {
      const recording = stored.get(recordingId)
      if (!recording) return
      stored.delete(recordingId)
      rmSync(recording.dir, { recursive: true, force: true })
      if (browser) await deps.remove(browser, recording.draftId).catch(() => {})
    },

    async close() {
      const current = browser
      browser = null
      running = null
      if (current?.isOpen()) await current.close()
    },
  }
}
