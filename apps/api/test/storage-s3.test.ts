import { describe, expect, test } from "bun:test"
import { newId } from "../src/lib/ids"
import { mediaKeyFor } from "../src/storage/keys"
import { partSizes } from "../src/storage/multipart"
import { S3StorageDriver } from "../src/storage/s3"

const endpoint = process.env.S3_TEST_ENDPOINT

describe.skipIf(!endpoint)("S3StorageDriver against MinIO", () => {
  const driver = new S3StorageDriver({
    endpoint: endpoint ?? "",
    region: "us-east-1",
    bucket: process.env.S3_TEST_BUCKET ?? "",
    accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? "",
    virtualHostedStyle: false,
    uploadTtlSeconds: 3600,
    readTtlSeconds: 1800,
  })

  test("presigned upload, head, presigned read, delete", async () => {
    const key = mediaKeyFor(newId(), "screenshot")
    const target = await driver.createUploadTarget(key, { contentType: "image/png", maxBytes: 3 })
    const put = await fetch(target.url, { method: target.method, headers: target.headers, body: new Uint8Array([7, 8, 9]) })
    expect(put.ok).toBe(true)
    expect(await driver.head(key)).toEqual({ size: 3 })

    const read = await fetch(await driver.getReadUrl(key, { contentType: "image/png" }))
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]))

    expect(new Uint8Array(await ((await driver.read(key)) as Blob).arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]))
    await driver.delete(key)
    expect(await driver.head(key)).toBeNull()
    expect(await driver.read(key)).toBeNull()
  })

  test("the upload link only accepts the declared size and content type", async () => {
    const key = mediaKeyFor(newId(), "screenshot")
    const target = await driver.createUploadTarget(key, { contentType: "image/png", maxBytes: 3 })
    const put = (body: Uint8Array<ArrayBuffer>, contentType = "image/png") =>
      fetch(target.url, { method: "PUT", headers: { "content-type": contentType }, body })

    expect((await put(new Uint8Array(5000))).ok).toBe(false)
    expect((await put(new Uint8Array([1, 2, 3]), "text/html")).ok).toBe(false)
    expect(await driver.head(key)).toBeNull()
    expect((await put(new Uint8Array([1, 2, 3]))).ok).toBe(true)
    await driver.delete(key)
  })

  test("replaces an object, keeping the content type it is served with", async () => {
    const key = mediaKeyFor(newId(), "video")
    const target = await driver.createUploadTarget(key, { contentType: "video/webm", maxBytes: 3 })
    await fetch(target.url, { method: target.method, headers: target.headers, body: new Uint8Array([1, 2, 3]) })

    await driver.replace(key, new Uint8Array([4, 5, 6]), "video/webm")

    const read = await fetch(await driver.getReadUrl(key, { contentType: "video/webm" }))
    expect(read.headers.get("content-type")).toBe("video/webm")
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]))
    await driver.delete(key)
  })

  test("presigned URLs use the configured lifetimes", async () => {
    const key = mediaKeyFor(newId(), "screenshot")
    const upload = await driver.createUploadTarget(key, { contentType: "image/png", maxBytes: 1 })
    expect(new URL(upload.url).searchParams.get("X-Amz-Expires")).toBe("3600")
    const read = await driver.getReadUrl(key, { contentType: "image/png" })
    expect(new URL(read).searchParams.get("X-Amz-Expires")).toBe("1800")
    const short = await driver.getReadUrl(key, { contentType: "image/png", expiresInSeconds: 300 })
    expect(new URL(short).searchParams.get("X-Amz-Expires")).toBe("300")
  })

  test("an upload in parts: each link takes only its part's size, and complete joins them", async () => {
    const multipart = driver.multipart
    const key = mediaKeyFor(newId(), "video")
    const MB = 1024 * 1024
    // S3 wants at least 5 MiB in every part but the last.
    const sizes = partSizes(10 * MB + 3, 5 * MB)
    const { uploadId, parts } = await multipart.create(key, { contentType: "video/webm", partSizes: sizes })
    const put = (index: number, size: number) =>
      fetch(parts[index]?.url ?? "", { method: "PUT", body: new Uint8Array(size).fill(index + 1) })

    expect((await put(0, (sizes[0] as number) + 1)).ok).toBe(false)
    expect((await put(0, sizes[0] as number)).ok).toBe(true)
    expect(await multipart.complete(key, uploadId, sizes)).toBe("incomplete")
    expect((await put(1, sizes[1] as number)).ok).toBe(true)
    // A link signed again later, as for a slow upload whose first links expired, works the same.
    const resigned = multipart.signParts(key, uploadId, sizes)[2]?.url ?? ""
    expect((await fetch(resigned, { method: "PUT", body: new Uint8Array(sizes[2] as number).fill(3) })).ok).toBe(true)
    expect(await driver.head(key)).toBeNull()

    expect(await multipart.complete(key, uploadId, sizes)).toBe("completed")
    expect(await driver.head(key)).toEqual({ size: 10 * MB + 3 })
    const read = await fetch(await driver.getReadUrl(key, { contentType: "video/webm" }))
    expect(read.headers.get("content-type")).toBe("video/webm")
    const bytes = new Uint8Array(await read.arrayBuffer())
    expect([bytes[0], bytes[5 * MB], bytes[10 * MB + 2]]).toEqual([1, 2, 3])
    // A second finalize after the first one's answer was lost: joined already, or gone; never an error.
    expect(["completed", "gone"]).toContain(await multipart.complete(key, uploadId, sizes))
    await driver.delete(key)
  })

  test("abort drops the parts, and abortStale finds uploads left behind", async () => {
    const multipart = driver.multipart
    const key = mediaKeyFor(newId(), "video")
    const first = await multipart.create(key, { contentType: "video/webm", partSizes: [3] })
    await fetch(first.parts[0]?.url ?? "", { method: "PUT", body: new Uint8Array(3) })
    await multipart.abort(key, first.uploadId)
    expect(await multipart.complete(key, first.uploadId, [3])).toBe("gone")
    await multipart.abort(key, first.uploadId)

    const left = await multipart.create(key, { contentType: "video/webm", partSizes: [3] })
    expect(await multipart.abortStale(new Date(Date.now() - 60_000))).toBe(0)
    expect(await multipart.abortStale(new Date(Date.now() + 60_000))).toBeGreaterThanOrEqual(1)
    expect(await multipart.complete(key, left.uploadId, [3])).toBe("gone")
  })
})
