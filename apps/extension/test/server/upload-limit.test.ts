import { describe, expect, test } from "bun:test"
import { MAX_RECORDING_MS } from "../../lib/recording/recorder"
import { BUGBERRY_CLOUD_ORIGIN } from "../../lib/server/settings"
import {
  clientConfigInTime,
  expectedRecordingSeconds,
  recordingByteBudget,
  recordingLengthMs,
  signedOutForLength,
  uploadLimitMb,
  workspaceLimitsInTime,
} from "../../lib/server/upload-limit"

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
    expect(recordingLengthMs(null, { maxRecordingSeconds: 120 }, true)).toBe(120_000)
    expect(recordingLengthMs(null, { maxRecordingSeconds: null }, true)).toBe(MAX_RECORDING_MS)
    expect(recordingLengthMs(null, null, true)).toBe(MAX_RECORDING_MS)
  })

  test("signed in, with the workspace not known in time: 20 minutes, the server judges at Send", () => {
    expect(recordingLengthMs(null, { maxRecordingSeconds: 120 }, false)).toBe(MAX_RECORDING_MS)
  })

  test("signed out, with the server's answer not in time: the length the server is expected to name", () => {
    expect(recordingLengthMs(null, null, true, 120)).toBe(120_000)
    expect(recordingLengthMs(null, { maxRecordingSeconds: 300 }, true, 120)).toBe(300_000)
    expect(recordingLengthMs(null, null, false, 120)).toBe(MAX_RECORDING_MS)
  })

  test("a 0.7.0 server names no length: 20 minutes", () => {
    expect(recordingLengthMs({ limited: true, ...counts }, {})).toBe(MAX_RECORDING_MS)
  })

  test("never past 20 minutes", () => {
    expect(recordingLengthMs(null, { maxRecordingSeconds: 7200 }, true)).toBe(MAX_RECORDING_MS)
    expect(recordingLengthMs({ limited: true, ...counts, maxRecordingMs: 7_200_000 }, null)).toBe(MAX_RECORDING_MS)
  })
})

describe("expectedRecordingSeconds", () => {
  test("BugBerry cloud takes recordings up to 2 minutes; another server isn't known", () => {
    expect(expectedRecordingSeconds(BUGBERRY_CLOUD_ORIGIN)).toBe(120)
    expect(expectedRecordingSeconds("https://bugs.example.com")).toBeNull()
  })
})

describe("signedOutForLength", () => {
  const counts = { screenshots: { used: 0, max: 5 }, recordings: { used: 0, max: 5 } }

  test("a 401 says so", () => {
    expect(signedOutForLength(true, null, { kind: "signed-in", name: "A", email: "a@example.com" })).toBe(true)
  })

  test("without an answer from the server, the popup's last check says so", () => {
    expect(signedOutForLength(false, null, { kind: "signed-out" })).toBe(true)
    expect(signedOutForLength(false, null, { kind: "signed-in", name: "A", email: "a@example.com" })).toBe(false)
    expect(signedOutForLength(false, null, { kind: "unreachable", host: "bugs.example.com" })).toBe(false)
    expect(signedOutForLength(false, null, null)).toBe(false)
  })

  test("a workspace the server answered for means signed in", () => {
    expect(signedOutForLength(false, { limited: true, ...counts, maxRecordingMs: 120_000 }, { kind: "signed-out" })).toBe(false)
  })
})
