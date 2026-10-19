import { describe, expect, test } from "bun:test"
import { formatDateTime, formatDuration, formatLength, formatOffset, formatRelative, formatTimestamp } from "../src/lib/format"

describe("format", () => {
  test("formatTimestamp shows the date, time and GMT offset in a time zone", () => {
    expect(formatTimestamp("2026-10-17T07:22:00Z", "Asia/Jakarta")).toBe("17 October 2026, 14:22 GMT+7")
    expect(formatTimestamp("2026-10-17T07:22:00Z", "UTC")).toBe("17 October 2026, 07:22 GMT")
    expect(formatTimestamp("nonsense")).toBe("-")
  })

  test("formatOffset shows signed minutes and seconds", () => {
    expect(formatOffset(-12_400)).toBe("-0:12")
    expect(formatOffset(65_000)).toBe("1:05")
    expect(formatOffset(-400)).toBe("0:00")
    expect(formatOffset(-3_723_000)).toBe("-1:02:03")
  })

  test("formatDuration", () => {
    expect(formatDuration(null)).toBe("-")
    expect(formatDuration(87)).toBe("87 ms")
    expect(formatDuration(1530)).toBe("1.5 s")
  })

  test("formatDateTime tolerates bad input", () => {
    expect(formatDateTime("nope")).toBe("-")
    expect(formatDateTime(new Date("2026-10-16T08:00:00Z"))).toContain("2026")
  })

  test("formatLength shows minutes and seconds", () => {
    expect([formatLength(0), formatLength(22_000), formatLength(60_000), formatLength(3_723_000)]).toEqual([
      "0:00",
      "0:22",
      "1:00",
      "1:02:03",
    ])
  })

  test("formatRelative counts back from now, then shows the date", () => {
    const now = new Date("2026-10-17T12:00:00Z").getTime()
    expect(formatRelative(now - 20_000, now)).toBe("just now")
    expect(formatRelative(now - 5 * 60_000, now)).toBe("5 minutes ago")
    expect(formatRelative(now - 17 * 3_600_000, now)).toBe("17 hours ago")
    expect(formatRelative("2026-10-09T08:00:00Z", now)).toBe("Oct 9")
    expect(formatRelative("2025-10-09T08:00:00Z", now)).toBe("Oct 9, 2025")
    expect(formatRelative("not a date", now)).toBe("-")
  })
})
