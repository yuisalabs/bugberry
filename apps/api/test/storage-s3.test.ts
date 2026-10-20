import { describe, expect, test } from "bun:test"
import { newId } from "../src/lib/ids"
import { mediaKeyFor } from "../src/storage/keys"
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
})
