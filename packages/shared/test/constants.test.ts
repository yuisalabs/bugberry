import { describe, expect, test } from "bun:test"
import { CAPTURE_TYPES, defaultReportTitle, isRecordingType, MEDIA_TYPES, PRIORITIES, PRIORITY_RANK, RECORDING_TYPES, SHARE_SLUG_LENGTH } from "../src"

describe("shared constants", () => {
  test("an untitled report is a Bugshoot or a Bugcord by its reporter", () => {
    expect(defaultReportTitle("screenshot", "Yuisa Labs")).toBe("Bugshoot by Yuisa Labs")
    expect(defaultReportTitle("video", " Ana ")).toBe("Bugcord by Ana")
    expect(defaultReportTitle("video", "")).toBe("Bugcord by someone")
    expect(defaultReportTitle("screenshot", "x".repeat(300))).toHaveLength(200)
  })

  test("video and replay are recordings, a screenshot is not", () => {
    expect(RECORDING_TYPES).toEqual(["video", "replay"])
    expect(CAPTURE_TYPES.filter(isRecordingType)).toEqual(["video", "replay"])
  })

  test("an untitled replay is a Bugflash", () => {
    expect(defaultReportTitle("replay", "Ana")).toBe("Bugflash by Ana")
  })

  test("priority rank follows PRIORITIES order", () => {
    expect(PRIORITIES.map((priority) => PRIORITY_RANK[priority])).toEqual([0, 1, 2, 3, 4])
  })

  test("each capture type has exactly one media type", () => {
    expect(MEDIA_TYPES).toEqual({ screenshot: "image/png", video: "video/webm", replay: "application/gzip" })
  })

  test("share slug length", () => {
    expect(SHARE_SLUG_LENGTH).toBe(12)
  })
})
