import { describe, expect, test } from "bun:test"
import { MAX_RECORDING_MS } from "../lib/recorder"
import { clientConfigInTime, recordingByteBudget, recordingLengthMs, uploadLimitMb, workspaceLimitsInTime } from "../lib/upload-limit"

describe("uploadLimitMb", () => {
  test("uses the server's number", () => {
    expect(uploadLimitMb({ extensionInstallUrl: null, maxUploadMb: 300 })).toBe(300)
  })

  test("an older server, no answer or a bad value falls back to 200 MB", () => {
    expect(uploadLimitMb({ extensionInstallUrl: null })).toBe(200)
    expect(uploadLimitMb(null)).toBe(200)
    expect(uploadLimitMb({ maxUploadMb: -5 })).toBe(200)
    expect(uploadLimitMb({ maxUploadMb: "300" })).toBe(200)
  })
})

describe("reading in time", () => {
  test("the answer, or null on failure or when it doesn't come in time", async () => {
    expect(await clientConfigInTime(async () => ({ maxUploadMb: 1 }))).toEqual({ maxUploadMb: 1 })
    expect(await clientConfigInTime(() => Promise.reject(new Error("offline")))).toBeNull()
    expect(await clientConfigInTime(() => new Promise(() => {}), 10)).toBeNull()
    expect(await workspaceLimitsInTime(async () => ({ limited: false }))).toEqual({ limited: false })
    expect(await workspaceLimitsInTime(() => Promise.reject(new Error("offline")))).toBeNull()
    expect(await workspaceLimitsInTime(() => new Promise(() => {}), 10)).toBeNull()
  })
})

test("the byte budget keeps 5% of the upload limit free", () => {
  expect(recordingByteBudget(300)).toBe(298_844_160)
})

describe("recordingLengthMs", () => {
  const counts = { screenshots: { used: 0, max: 5 }, recordings: { used: 0, max: 5 } }

  test("the workspace's length, or 20 minutes when it isn't limited", () => {
    expect(recordingLengthMs({ limited: true, ...counts, maxRecordingMs: 120_000 }, { maxRecordingSeconds: 300 })).toBe(120_000)
    expect(recordingLengthMs({ limited: false }, { maxRecordingSeconds: 120 })).toBe(MAX_RECORDING_MS)
  })

  test("signed out or unknown: the server's account length, else 20 minutes", () => {
    expect(recordingLengthMs(null, { maxRecordingSeconds: 120 })).toBe(120_000)
    expect(recordingLengthMs(null, { maxRecordingSeconds: null })).toBe(MAX_RECORDING_MS)
    expect(recordingLengthMs(null, null)).toBe(MAX_RECORDING_MS)
  })

  test("a 0.7.0 server names no length: 20 minutes", () => {
    expect(recordingLengthMs({ limited: true, ...counts }, {})).toBe(MAX_RECORDING_MS)
  })

  test("never past 20 minutes", () => {
    expect(recordingLengthMs(null, { maxRecordingSeconds: 7200 })).toBe(MAX_RECORDING_MS)
    expect(recordingLengthMs({ limited: true, ...counts, maxRecordingMs: 7_200_000 }, null)).toBe(MAX_RECORDING_MS)
  })
})
