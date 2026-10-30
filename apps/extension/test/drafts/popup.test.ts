import { describe, expect, test } from "bun:test"
import { ApiError } from "../../lib/server/api"
import { DEFAULT_CAPTURE_PREFS } from "../../lib/capture/capture-prefs"
import {
  canDelete,
  captureCopy,
  choiceOf,
  controlError,
  countText,
  draftNote,
  isSignedOut,
  recordingLabel,
  recordStartNote,
  replyResult,
  uncapturableNote,
} from "../../lib/drafts/popup"
import type { ReportDraft } from "../../lib/shared/types"

const draft = (status: ReportDraft["status"]) => ({ id: "d1", status }) as ReportDraft
const recordingThis = { recording: true as const, draftId: "d1", tabId: 1, startedAt: 0 }

describe("draftNote and canDelete", () => {
  test("a recording draft cannot be deleted before the recording status is known", () => {
    expect(draftNote(draft("recording"), undefined)).toBe("(checking…)")
    expect(canDelete(draft("recording"), undefined)).toBe(false)
    expect(canDelete(draft("recording"), recordingThis)).toBe(false)
    expect(draftNote(draft("recording"), { recording: false })).toBe("(recording interrupted)")
    expect(canDelete(draft("recording"), { recording: false })).toBe(true)
  })

  test("an upload cut off by a closed editor says so", () => {
    expect(draftNote(draft("uploading"), { recording: false })).toBe("(upload interrupted)")
    expect(draftNote(draft("failed"), { recording: false })).toBe("(failed)")
    expect(draftNote(draft("editing"), { recording: false })).toBeNull()
  })
})

describe("replyResult", () => {
  test("a missing or malformed reply from the background is an error, not a crash", () => {
    expect(replyResult(undefined)).toEqual({ ok: false, error: "The extension didn't respond. Try again." })
    expect(replyResult({ nope: 1 })).toMatchObject({ ok: false })
    expect(replyResult({ ok: true, draftId: "d1" })).toEqual({ ok: true, draftId: "d1" })
    expect(replyResult({ ok: false, error: "No active tab" })).toEqual({ ok: false, error: "No active tab" })
  })
})

describe("isSignedOut", () => {
  test("only a 401 from the server means the session ended", () => {
    expect(isSignedOut(new ApiError(401, "unauthorized", "x"))).toBe(true)
    expect(isSignedOut(new ApiError(0, "network", "x"))).toBe(false)
    expect(isSignedOut(new ApiError(500, "internal", "x"))).toBe(false)
    expect(isSignedOut(new Error("x"))).toBe(false)
  })
})

describe("uncapturableNote", () => {
  test("the popup says so itself before closing for Select area", () => {
    expect(uncapturableNote("chrome://newtab/")).toBe("This page can't be captured. Open a regular web page (http/https).")
    expect(uncapturableNote(undefined)).toBe("This page can't be captured. Open a regular web page (http/https).")
    expect(uncapturableNote("https://app.kantor.test/checkout")).toBeNull()
  })
})

describe("recordStartNote", () => {
  test("a tab that can't be recorded is said in the popup; a screen can come from anywhere", () => {
    expect(recordStartNote("tab", "chrome://newtab/")).toBe("This page can't be recorded. Open a regular web page (http/https).")
    expect(recordStartNote("screen", "chrome://newtab/")).toBeNull()
    expect(recordStartNote("tab", "https://app.kantor.test/")).toBeNull()
  })
})

describe("popup copy", () => {
  test("screenshots", () => {
    expect(captureCopy({ kind: "screenshot", mode: "visible" }, null, true)).toEqual({
      caption: "Capture visible area",
      info: null,
      footer: "Console and network attached",
    })
    expect(captureCopy({ kind: "screenshot", mode: "area" }, null, true).caption).toBe("Select an area")
  })

  test("a tab, without and with a microphone", () => {
    expect(captureCopy({ kind: "record", source: "tab" }, null, true)).toEqual({
      caption: "Record this tab",
      info: "Only this tab is recorded. Other tabs and apps stay private.",
      footer: "Console and network attached",
    })
    expect(captureCopy({ kind: "record", source: "tab" }, "Realtek Audio", true).info).toBe(
      "Only this tab is recorded, with your voice from Realtek Audio. Other tabs and apps stay private.",
    )
  })

  test("a screen and a window", () => {
    expect(captureCopy({ kind: "record", source: "screen" }, null, true)).toEqual({
      caption: "Record your screen",
      info: "Your browser asks which screen to share. Logs come from this tab only.",
      footer: "Logs from this tab only",
    })
    expect(captureCopy({ kind: "record", source: "window" }, null, true)).toEqual({
      caption: "Record a window",
      info: "Your browser asks which window to share. Logs come from this tab only.",
      footer: "Logs from this tab only",
    })
  })

  test("a page without logs says so in the footer", () => {
    expect(captureCopy({ kind: "screenshot", mode: "visible" }, null, false).footer).toBe("Logs aren't available on this page")
    expect(captureCopy({ kind: "record", source: "screen" }, null, false).footer).toBe("Logs aren't available on this page")
  })

  test("what is being recorded", () => {
    expect(recordingLabel("tab", true)).toBe("Recording this tab")
    expect(recordingLabel("tab", false)).toBe("Recording another tab")
    expect(recordingLabel("screen", true)).toBe("Recording your screen")
    expect(recordingLabel("window", false)).toBe("Recording a window")
  })

  test("counts", () => {
    expect(countText(1, "error", "errors")).toBe("1 error")
    expect(countText(0, "error", "errors")).toBe("0 errors")
    expect(countText(9, "action", "actions")).toBe("9 actions")
  })

  test("the chosen row and tile", () => {
    expect(choiceOf(DEFAULT_CAPTURE_PREFS, true)).toEqual({ kind: "screenshot", mode: "visible" })
    expect(choiceOf({ ...DEFAULT_CAPTURE_PREFS, captureKind: "record", recordSource: "screen" }, true)).toEqual({ kind: "record", source: "screen" })
    expect(choiceOf({ ...DEFAULT_CAPTURE_PREFS, captureKind: "record", recordSource: "tab" }, false)).toEqual({ kind: "record", source: "window" })
  })
})

describe("controlError", () => {
  test("only a real failure is reported", () => {
    expect(controlError(undefined)).toBeNull()
    expect(controlError({ ok: true, draftId: "d" })).toBeNull()
    // Discard answers "cancelled": that is the recording thrown away, as asked.
    expect(controlError({ ok: false, code: "cancelled", error: "Discarded" })).toBeNull()
    expect(controlError({ ok: false, error: "No recording is running" })).toBe("No recording is running")
  })
})
