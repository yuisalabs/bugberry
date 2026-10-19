import { describe, expect, test } from "bun:test"
import { ApiError } from "../lib/api"
import { canDelete, draftNote, isSignedOut, recordStartNote, replyResult, uncapturableNote } from "../lib/popup"
import type { ReportDraft } from "../lib/types"

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
