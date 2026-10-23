import { describe, expect, test } from "bun:test"
import { recordingByteBudget, uploadLimitMb, workspaceRecordingCap } from "../lib/upload-limit"

describe("uploadLimitMb", () => {
  test("uses the server's number", async () => {
    expect(await uploadLimitMb(async () => ({ extensionInstallUrl: null, maxUploadMb: 300 }))).toBe(300)
  })

  test("an older server, a failure or a bad value falls back to 200 MB", async () => {
    expect(await uploadLimitMb(async () => ({ extensionInstallUrl: null }))).toBe(200)
    expect(await uploadLimitMb(() => Promise.reject(new Error("offline")))).toBe(200)
    expect(await uploadLimitMb(async () => ({ maxUploadMb: -5 }))).toBe(200)
    expect(await uploadLimitMb(async () => ({ maxUploadMb: "300" }))).toBe(200)
  })

  test("a server that doesn't answer in time falls back to 200 MB", async () => {
    expect(await uploadLimitMb(() => new Promise(() => {}), 20)).toBe(200)
  })
})

test("the byte budget keeps 5% of the upload limit free", () => {
  expect(recordingByteBudget(300)).toBe(298_844_160)
})

describe("workspaceRecordingCap", () => {
  test("the default workspace's cap, or none when it can't be known in time", async () => {
    const limits = {
      limited: true as const,
      screenshots: { used: 0, max: 5 },
      recordings: { used: 0, max: 5 },
      storage: { used: 0, max: 250 * 1024 * 1024 },
      maxFileBytes: 50 * 1024 * 1024,
    }
    expect(await workspaceRecordingCap(async () => limits)).toBe(Math.floor(50 * 1024 * 1024 * 0.95))
    expect(await workspaceRecordingCap(() => Promise.reject(new Error("offline")))).toBeNull()
    expect(await workspaceRecordingCap(() => new Promise(() => {}), 10)).toBeNull()
  })
})
