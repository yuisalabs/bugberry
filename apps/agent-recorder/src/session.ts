import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { DebuggerSummary, DeviceInfo } from "@bugberry/shared"
import type { AutomationDraft } from "../../extension/lib/automation-draft"
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
  read(browser: RecorderBrowser<P>, draftId: string): Promise<AutomationDraft>
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
  endedBy: "agent" | "limit"
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
}

export const EMPTY_RECORDING =
  "Nothing was recorded: no click, typing or page change happened in the recorded tab. Did you use the bugberry-browser " +
  "tools? Your other browser tools drive a different browser."

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
const clock = (ms: number) => {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function summaryOf(draft: AutomationDraft, endedBy: StopResult["endedBy"]): string {
  const s = draft.debuggerSummary
  return [
    `Recorded ${clock(draft.durationMs)} on ${draft.pageUrl}.`,
    endedBy === "limit" ? `The recording reached its ${clock(draft.stoppedAtLimitMs ?? draft.durationMs)} limit and stopped by itself.` : "",
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
  let running: { draftId: string; startedAt: number } | null = null
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

  const save = (recordingId: string, draftId: string, draft: AutomationDraft): StoredRecording => {
    const dir = join(deps.tempDir, recordingId)
    mkdirSync(dir, { recursive: true })
    const write = (name: string, base64: string) => {
      const path = join(dir, name)
      writeFileSync(path, Buffer.from(base64, "base64"))
      return path
    }
    const recording: StoredRecording = {
      recordingId,
      draftId,
      dir,
      mediaPath: write("media.webm", draft.videoBase64),
      debuggerPath: write("debugger.json.gz", draft.debuggerBase64),
      thumbnailPath: draft.thumbnailBase64 ? write("thumbnail.jpg", draft.thumbnailBase64) : null,
    }
    stored.set(recordingId, recording)
    return recording
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
      const { draftId } = await deps.start(current, page, await deps.caps())
      running = { draftId, startedAt: now() }
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
      return {
        recording: running !== null,
        seconds: running ? Math.round((now() - running.startedAt) / 1000) : 0,
        warning: running ? (watcher?.warning() ?? null) : null,
      }
    },

    async stop() {
      if (!running || !browser) throw new Error("Nothing is recording. Call startRecording first.")
      const { draftId } = running
      const warning = watcher?.warning() ?? null
      running = null
      // A limit may have stopped it already; its draft is the one this recording started.
      await deps.stop(browser).catch((error: unknown) => {
        if (!String(error).includes("No recording is running")) throw error
      })
      const draft = await deps.read(browser, draftId)
      if (draft.debuggerSummary.actions === 0) {
        await deps.remove(browser, draftId)
        throw new Error(EMPTY_RECORDING)
      }
      const endedBy = draft.stoppedAtLimitMs === null ? "agent" : "limit"
      const kept = save(newId(), draftId, draft)
      const media = Buffer.byteLength(draft.videoBase64, "base64")
      return {
        recordingId: kept.recordingId,
        summary: summaryOf(draft, endedBy),
        warning,
        endedBy,
        recording: {
          mediaSize: media,
          debuggerSize: Buffer.byteLength(draft.debuggerBase64, "base64"),
          ...(draft.thumbnailBase64 ? { thumbnailSize: Buffer.byteLength(draft.thumbnailBase64, "base64") } : {}),
          durationMs: draft.durationMs,
          pageUrl: draft.pageUrl,
          pageTitle: draft.pageTitle,
          device: draft.device,
          debuggerSummary: draft.debuggerSummary,
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
  }
}
