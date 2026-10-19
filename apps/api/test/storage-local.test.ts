import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { newId } from "../src/lib/ids"
import { debuggerKeyFor, mediaKeyFor, thumbnailKeyFor } from "../src/storage/keys"
import { LocalStorageDriver } from "../src/storage/local"

const SECRET = "storage-secret"
let dir: string
let driver: LocalStorageDriver

function makeDriver(now: () => number = Date.now) {
  return new LocalStorageDriver({
    dir,
    publicBaseUrl: "http://localhost:3000",
    secret: SECRET,
    uploadTtlSeconds: 3600,
    readTtlSeconds: 3600,
    now,
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bugberry-local-"))
  driver = makeDriver()
})

describe("storage keys", () => {
  test("builds keys per capture type", () => {
    expect(mediaKeyFor("r1", "screenshot")).toBe("reports/r1/media.png")
    expect(mediaKeyFor("r1", "video")).toBe("reports/r1/media.webm")
    expect(debuggerKeyFor("r1")).toBe("reports/r1/debugger.json.gz")
    expect(thumbnailKeyFor("r1")).toBe("reports/r1/thumbnail.jpg")
  })
})

describe("LocalStorageDriver", () => {
  test("upload target points at the local upload route and carries its claims", async () => {
    const key = mediaKeyFor(newId(), "screenshot")
    const target = await driver.createUploadTarget(key, { contentType: "image/png", maxBytes: 50 })
    expect(target.method).toBe("PUT")
    expect(target.url.startsWith("http://localhost:3000/api/uploads/local/")).toBe(true)
    expect(target.headers).toEqual({ "content-type": "image/png" })
    const token = target.url.split("/").at(-1) ?? ""
    expect(driver.verifyUploadToken(token)).toMatchObject({ k: key, t: "image/png", m: 50 })
  })

  test("rejects expired tokens and read tokens used for upload", async () => {
    const key = mediaKeyFor(newId(), "screenshot")
    const expired = makeDriver(() => Date.now() - 2 * 3600 * 1000)
    const oldTarget = await expired.createUploadTarget(key, { contentType: "image/png", maxBytes: 50 })
    expect(driver.verifyUploadToken(oldTarget.url.split("/").at(-1) ?? "")).toBeNull()

    const readUrl = await driver.getReadUrl(key, { contentType: "image/png" })
    expect(driver.verifyUploadToken(readUrl.split("/").at(-1) ?? "")).toBeNull()
    expect(driver.verifyReadToken(readUrl.split("/").at(-1) ?? "")).toMatchObject({ k: key, t: "image/png" })
  })

  test("writes, measures, reads and deletes objects", async () => {
    const key = debuggerKeyFor(newId())
    expect(await driver.head(key)).toBeNull()
    expect(await driver.writeObject(key, new Uint8Array([1, 2, 3, 4]))).toBe(4)
    expect(await driver.head(key)).toEqual({ size: 4 })
    expect(new Uint8Array(await driver.openObject(key).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
    await driver.delete(key)
    expect(await driver.head(key)).toBeNull()
    await driver.delete(key) // deleting twice is fine
  })

  test("refuses keys outside the reports layout", async () => {
    for (const key of ["../etc/passwd", "reports/a/../../x", "reports/a/media.exe", "/abs/reports/a/media.png"]) {
      await expect(driver.createUploadTarget(key, { contentType: "image/png", maxBytes: 1 })).rejects.toThrow(/storage key/)
    }
  })
})

describe("LocalStorageDriver interrupted writes", () => {
  test("a body that fails mid-stream leaves no object behind", async () => {
    const key = mediaKeyFor(newId(), "video")
    let chunks = 0
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks += 1
        if (chunks > 3) controller.error(new Error("connection dropped"))
        else controller.enqueue(new Uint8Array(64 * 1024))
      },
    })
    await expect(driver.writeObject(key, failing)).rejects.toThrow()
    expect(await driver.head(key)).toBeNull()
  })
})

describe("LocalStorageDriver.read", () => {
  test("reads stored objects back and returns null for missing ones", async () => {
    const key = debuggerKeyFor(newId())
    expect(await driver.read(key)).toBeNull()
    await driver.writeObject(key, new Uint8Array([5, 6, 7]))
    expect(new Uint8Array(await ((await driver.read(key)) as Blob).arrayBuffer())).toEqual(new Uint8Array([5, 6, 7]))
  })
})
