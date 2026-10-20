import type { RecordOptions } from "./messages"

export type ScreenshotMode = "visible" | "area"
export type RecordSource = "tab" | "screen" | "window"

/** What the popup's rows are set to; the keyboard shortcuts use the same choices. */
export interface CapturePrefs {
  screenshotMode: ScreenshotMode
  recordSource: RecordSource
  mic: boolean
  systemAudio: boolean
  /** 3-2-1 on the page before recording starts. */
  countdown: boolean
}

export const DEFAULT_CAPTURE_PREFS: CapturePrefs = {
  screenshotMode: "visible",
  recordSource: "tab",
  mic: false,
  systemAudio: true,
  countdown: true,
}

const SCREENSHOT_MODES: readonly string[] = ["visible", "area"]
const RECORD_SOURCES: readonly string[] = ["tab", "screen", "window"]

/** Each missing or unknown field falls back to its default, so an old or damaged value never blocks the popup. */
export function capturePrefsFrom(raw: unknown): CapturePrefs {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    screenshotMode: SCREENSHOT_MODES.includes(value.screenshotMode as string)
      ? (value.screenshotMode as ScreenshotMode)
      : DEFAULT_CAPTURE_PREFS.screenshotMode,
    recordSource: RECORD_SOURCES.includes(value.recordSource as string)
      ? (value.recordSource as RecordSource)
      : DEFAULT_CAPTURE_PREFS.recordSource,
    mic: typeof value.mic === "boolean" ? value.mic : DEFAULT_CAPTURE_PREFS.mic,
    systemAudio: typeof value.systemAudio === "boolean" ? value.systemAudio : DEFAULT_CAPTURE_PREFS.systemAudio,
    countdown: typeof value.countdown === "boolean" ? value.countdown : DEFAULT_CAPTURE_PREFS.countdown,
  }
}

/** Without a tab recorder (Firefox) a tab can't be recorded on its own: the reporter picks a window instead. */
export function effectiveSource(source: RecordSource, tabRecorder: boolean): RecordSource {
  return !tabRecorder && source === "tab" ? "window" : source
}

/** What a recording starts with; without a tab recorder there is no system audio either (Firefox can't share it). */
export function recordOptionsFor(
  prefs: Pick<CapturePrefs, "recordSource" | "mic" | "systemAudio" | "countdown">,
  tabRecorder: boolean,
): RecordOptions {
  return {
    source: effectiveSource(prefs.recordSource, tabRecorder),
    mic: prefs.mic,
    systemAudio: tabRecorder && prefs.systemAudio,
    countdown: prefs.countdown,
  }
}

export interface CapturePrefsStorage {
  get(): Promise<CapturePrefs>
  set(patch: Partial<CapturePrefs>): Promise<CapturePrefs>
}

const KEY = "capturePrefs"

export function createCapturePrefsStorage(area: {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}): CapturePrefsStorage {
  const get = async () => capturePrefsFrom((await area.get(KEY))[KEY])
  return {
    get,
    async set(patch) {
      const next = capturePrefsFrom({ ...(await get()), ...patch })
      await area.set({ [KEY]: next })
      return next
    },
  }
}
