import { beforeEach, describe, expect, test } from "bun:test"
import { newId } from "../src/lib/ids"
import { mediaKeyFor } from "../src/storage/keys"
import { LocalStorageDriver } from "../src/storage/local"
import { setupTestApp } from "./helpers"

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let local: LocalStorageDriver

beforeEach(async () => {
  ctx = await setupTestApp()
  if (!(ctx.storage instanceof LocalStorageDriver)) throw new Error("expected local storage in tests")
  local = ctx.storage
})

function put(url: string, body: Uint8Array<ArrayBuffer>, contentType = "image/png") {
  return ctx.app.handle(new Request(url, { method: "PUT", headers: { "content-type": contentType }, body }))
}

describe("local upload route", () => {
  test("stores the file once and refuses reuse of the link", async () => {
    const key = mediaKeyFor(newId(), "screenshot")
    const target = await local.createUploadTarget(key, { contentType: "image/png", maxBytes: 10 })
    const first = await put(target.url, new Uint8Array([1, 2, 3]))
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ ok: true, size: 3 })
    expect(await local.head(key)).toEqual({ size: 3 })

    const second = await put(target.url, new Uint8Array([4]))
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ code: "already_uploaded" })
  })

  test("two uploads racing on the same link: one wins, the other is refused, the file is not replaced", async () => {
    const key = mediaKeyFor(newId(), "screenshot")
    const target = await local.createUploadTarget(key, { contentType: "image/png", maxBytes: 10 })
    const responses = await Promise.all([put(target.url, new Uint8Array([1, 1, 1])), put(target.url, new Uint8Array([2, 2]))])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])

    const winner = responses.find((response) => response.status === 200)
    const { size } = (await winner?.json()) as { size: number }
    expect(await local.head(key)).toEqual({ size })
  })

  test("rejects the wrong content type", async () => {
    const target = await local.createUploadTarget(mediaKeyFor(newId(), "screenshot"), { contentType: "image/png", maxBytes: 10 })
    const response = await put(target.url, new Uint8Array([1]), "text/html")
    expect(response.status).toBe(415)
  })

  test("rejects files larger than allowed and keeps nothing", async () => {
    const key = mediaKeyFor(newId(), "screenshot")
    const target = await local.createUploadTarget(key, { contentType: "image/png", maxBytes: 2 })
    const response = await put(target.url, new Uint8Array([1, 2, 3, 4]))
    expect(response.status).toBe(413)
    expect(await local.head(key)).toBeNull()
  })

  test("rejects forged and expired links", async () => {
    expect((await put("http://localhost:3000/api/uploads/local/forged.token", new Uint8Array([1]))).status).toBe(401)

    if (ctx.config.storage.driver !== "local") throw new Error("expected local storage config")
    const stale = new LocalStorageDriver({
      dir: ctx.config.storage.dir,
      publicBaseUrl: ctx.config.appUrl,
      secret: `${ctx.config.authSecret}:storage`,
      uploadTtlSeconds: 60,
      readTtlSeconds: 60,
      now: () => Date.now() - 120_000,
    })
    const target = await stale.createUploadTarget(mediaKeyFor(newId(), "screenshot"), { contentType: "image/png", maxBytes: 10 })
    expect((await put(target.url, new Uint8Array([1]))).status).toBe(401)
  })
})

describe("local file route", () => {
  test("serves a stored file with its content type", async () => {
    const key = mediaKeyFor(newId(), "screenshot")
    await local.writeObject(key, new Uint8Array([9, 8]))
    const response = await ctx.app.handle(new Request(await local.getReadUrl(key, { contentType: "image/png" })))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("image/png")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 8]))
  })

  test("returns 404 for a missing file and 401 for a bad link", async () => {
    const missing = await local.getReadUrl(mediaKeyFor(newId(), "screenshot"), { contentType: "image/png" })
    expect((await ctx.app.handle(new Request(missing))).status).toBe(404)
    expect((await ctx.app.handle(new Request("http://localhost:3000/api/files/bad.token"))).status).toBe(401)
  })
})

describe("local files and HTTP Range", () => {
  test("serves byte ranges so the dashboard video player can seek", async () => {
    const key = mediaKeyFor(newId(), "video")
    await local.writeObject(key, new TextEncoder().encode("0123456789"))
    const path = new URL(await local.getReadUrl(key, { contentType: "video/webm" })).pathname
    const server = ctx.app.listen(0)
    try {
      const origin = `http://localhost:${server.server?.port}`
      const full = await fetch(`${origin}${path}`)
      expect(full.status).toBe(200)
      expect(full.headers.get("accept-ranges")).toBe("bytes")
      expect(full.headers.get("content-type")).toBe("video/webm")
      const partial = await fetch(`${origin}${path}`, { headers: { range: "bytes=2-5" } })
      expect(partial.status).toBe(206)
      expect(partial.headers.get("content-range")).toBe("bytes 2-5/10")
      expect(await partial.text()).toBe("2345")
    } finally {
      await server.stop()
    }
  })
})
