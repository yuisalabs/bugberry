import { describe, expect, test } from "bun:test"
import { recordingByteBudget, uploadLimitMb } from "../lib/upload-limit"

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
