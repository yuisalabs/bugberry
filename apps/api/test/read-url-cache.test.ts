import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { newId } from "../src/lib/ids"
import { thumbnailKeyFor } from "../src/storage/keys"
import { LocalStorageDriver } from "../src/storage/local"
import { ReadUrlCache } from "../src/storage/read-url-cache"

describe("ReadUrlCache", () => {
  test("hands out the same link for a quarter of its lifetime, then a fresh one", async () => {
    let now = 1_000_000
    let signed = 0
    const cache = new ReadUrlCache(() => now)
    const get = () => cache.get("reports/a.jpg", "image/jpeg", 3600, () => `link-${++signed}`)

    expect(await get()).toBe("link-1")
    now += 15 * 60_000 - 1
    expect(await get()).toBe("link-1")
    now += 1
    expect(await get()).toBe("link-2")
  })

  test("keeps links apart by object, type and lifetime", async () => {
    let signed = 0
    const cache = new ReadUrlCache(() => 0)
    const sign = () => `link-${++signed}`

    expect(await cache.get("a", "image/png", 3600, sign)).toBe("link-1")
    expect(await cache.get("b", "image/png", 3600, sign)).toBe("link-2")
    expect(await cache.get("a", "image/jpeg", 3600, sign)).toBe("link-3")
    expect(await cache.get("a", "image/png", 300, sign)).toBe("link-4")
    expect(await cache.get("a", "image/png", 3600, sign)).toBe("link-1")
  })

  test("the local driver repeats a preview link, and the repeated link still opens the file", async () => {
    let now = Date.now()
    const driver = new LocalStorageDriver({
      dir: mkdtempSync(join(tmpdir(), "bugberry-read-urls-")),
      publicBaseUrl: "http://localhost:3000",
      secret: "storage-secret",
      uploadTtlSeconds: 600,
      readTtlSeconds: 3600,
      now: () => now,
    })
    const key = thumbnailKeyFor(newId())
    const first = await driver.getReadUrl(key, { contentType: "image/jpeg" })
    now += 10 * 60_000
    const again = await driver.getReadUrl(key, { contentType: "image/jpeg" })

    expect(again).toBe(first)
    expect(driver.verifyReadToken(first.split("/").pop() ?? "")).not.toBeNull()
  })
})
