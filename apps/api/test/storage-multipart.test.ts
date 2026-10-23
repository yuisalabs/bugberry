import { describe, expect, test } from "bun:test"
import { PART_BYTES, partSizes } from "../src/storage/multipart"
import { S3Multipart } from "../src/storage/s3-multipart"

const OPTIONS = {
  endpoint: "http://s3.test",
  region: "us-east-1",
  bucket: "fdebag",
  accessKeyId: "AK",
  secretAccessKey: "SK",
  virtualHostedStyle: false,
  uploadTtlSeconds: 3600,
  readTtlSeconds: 1800,
}
const KEY = "reports/r1/media.webm"

describe("partSizes", () => {
  test("splits a file into full parts and a last part with the rest", () => {
    expect(partSizes(10, 4)).toEqual([4, 4, 2])
    expect(partSizes(8, 4)).toEqual([4, 4])
    expect(partSizes(3, 4)).toEqual([3])
    expect(partSizes(PART_BYTES * 2 + 1)).toEqual([PART_BYTES, PART_BYTES, 1])
  })

  test("refuses sizes that are not a positive whole number", () => {
    for (const size of [0, -1, 1.5, Number.NaN]) expect(() => partSizes(size)).toThrow()
  })
})

interface Call {
  method: string
  url: URL
  body: string | null
  headers: Headers
}

/** A fetch that answers like S3, from a list of handlers tried in order. */
function fakeS3(answer: (call: Call) => Response | undefined) {
  const calls: Call[] = []
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      body: typeof init?.body === "string" ? init.body : null,
      headers: new Headers(init?.headers),
    }
    calls.push(call)
    return answer(call) ?? new Response("<Error><Code>Unexpected</Code></Error>", { status: 500 })
  }) as typeof fetch
  return { calls, multipart: new S3Multipart(OPTIONS, fetcher) }
}

const xml = (body: string, status = 200) => new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { status })
const listParts = (parts: Array<[number, number, string]>, extra = "") =>
  xml(
    `<ListPartsResult><IsTruncated>false</IsTruncated><PartNumberMarker>0</PartNumberMarker>${extra}${parts
      .map(([number, size, etag]) => `<Part><ETag>${etag}</ETag><PartNumber>${number}</PartNumber><Size>${size}</Size></Part>`)
      .join("")}</ListPartsResult>`,
  )
const noSuchUpload = () => xml("<Error><Code>NoSuchUpload</Code></Error>", 404)

describe("S3Multipart", () => {
  test("create starts the upload with the content type and signs one link per part, locked to its size", async () => {
    const { calls, multipart } = fakeS3((call) =>
      call.method === "POST" && call.url.searchParams.has("uploads")
        ? xml("<InitiateMultipartUploadResult><UploadId>up&amp;1</UploadId></InitiateMultipartUploadResult>")
        : undefined,
    )
    const { uploadId, parts } = await multipart.create(KEY, { contentType: "video/webm", partSizes: [5, 5, 2] })

    expect(uploadId).toBe("up&1")
    expect(calls[0]?.headers.get("content-type")).toBe("video/webm")
    expect(calls[0]?.url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host")
    expect(parts).toHaveLength(3)
    const urls = parts.map((part) => new URL(part.url))
    expect(urls.map((url) => url.searchParams.get("partNumber"))).toEqual(["1", "2", "3"])
    expect(urls.every((url) => url.searchParams.get("uploadId") === "up&1")).toBe(true)
    expect(urls.every((url) => url.searchParams.get("X-Amz-SignedHeaders") === "content-length;host")).toBe(true)
    expect(urls.every((url) => url.searchParams.get("X-Amz-Expires") === "3600")).toBe(true)
    expect(parts.every((part) => part.method === "PUT" && Object.keys(part.headers).length === 0)).toBe(true)
  })

  test("create refuses a key outside the report layout, and fails when the storage gives no upload id", async () => {
    const { multipart } = fakeS3(() => xml("<Error><Code>AccessDenied</Code></Error>", 403))
    await expect(multipart.create("../etc/passwd", { contentType: "video/webm", partSizes: [1] })).rejects.toThrow("Invalid storage key")
    await expect(multipart.create(KEY, { contentType: "video/webm", partSizes: [1] })).rejects.toThrow("HTTP 403 AccessDenied")
  })

  test("complete joins the parts the storage lists, with their ETags", async () => {
    const { calls, multipart } = fakeS3((call) => {
      if (call.method === "GET") return listParts([[1, 5, '"e1"'], [2, 2, "&quot;e2&quot;"]])
      if (call.method === "POST") return xml("<CompleteMultipartUploadResult><ETag>x</ETag></CompleteMultipartUploadResult>")
    })
    expect(await multipart.complete(KEY, "up1", [5, 2])).toBe("completed")
    const complete = calls.find((call) => call.method === "POST")
    expect(complete?.url.searchParams.get("uploadId")).toBe("up1")
    expect(complete?.body).toBe(
      "<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>&quot;e1&quot;</ETag></Part>" +
        "<Part><PartNumber>2</PartNumber><ETag>&quot;e2&quot;</ETag></Part></CompleteMultipartUpload>",
    )
  })

  test("complete leaves the upload open while a part is missing, and never joins parts of another size", async () => {
    const missing = fakeS3((call) => (call.method === "GET" ? listParts([[1, 5, '"e1"']]) : undefined))
    expect(await missing.multipart.complete(KEY, "up1", [5, 2])).toBe("incomplete")
    expect(missing.calls.some((call) => call.method === "POST")).toBe(false)

    const wrongSize = fakeS3((call) => (call.method === "GET" ? listParts([[1, 5, '"e1"'], [2, 3, '"e2"']]) : undefined))
    expect(await wrongSize.multipart.complete(KEY, "up1", [5, 2])).toBe("mismatch")
    expect(wrongSize.calls.some((call) => call.method === "POST")).toBe(false)
  })

  test("complete reads every page of the part list", async () => {
    const { multipart } = fakeS3((call) => {
      if (call.method === "POST") return xml("<CompleteMultipartUploadResult/>")
      if (call.url.searchParams.get("part-number-marker") === "1") return listParts([[2, 2, '"e2"']])
      return xml(
        `<ListPartsResult><IsTruncated>true</IsTruncated><NextPartNumberMarker>1</NextPartNumberMarker><Part><ETag>"e1"</ETag><PartNumber>1</PartNumber><Size>5</Size></Part></ListPartsResult>`,
      )
    })
    expect(await multipart.complete(KEY, "up1", [5, 2])).toBe("completed")
  })

  test("complete answers gone for an upload the storage no longer knows", async () => {
    expect(await fakeS3(() => noSuchUpload()).multipart.complete(KEY, "up1", [5])).toBe("gone")
    const joinedMeanwhile = fakeS3((call) => (call.method === "GET" ? listParts([[1, 5, '"e1"']]) : noSuchUpload()))
    expect(await joinedMeanwhile.multipart.complete(KEY, "up1", [5])).toBe("gone")
  })

  test("complete throws on an error, including one S3 sends with status 200", async () => {
    const inBody = fakeS3((call) =>
      call.method === "GET" ? listParts([[1, 5, '"e1"']]) : xml("<Error><Code>InternalError</Code></Error>"),
    )
    await expect(inBody.multipart.complete(KEY, "up1", [5])).rejects.toThrow("InternalError")
    await expect(fakeS3(() => xml("<Error><Code>AccessDenied</Code></Error>", 403)).multipart.complete(KEY, "up1", [5])).rejects.toThrow(
      "HTTP 403",
    )
  })

  test("abort accepts an upload that is already gone", async () => {
    const { calls, multipart } = fakeS3(() => noSuchUpload())
    await multipart.abort(KEY, "up1")
    expect(calls[0]?.method).toBe("DELETE")
    await expect(fakeS3(() => new Response(null, { status: 204 })).multipart.abort(KEY, "up1")).resolves.toBeUndefined()
    await expect(fakeS3(() => xml("<Error><Code>AccessDenied</Code></Error>", 403)).multipart.abort(KEY, "up1")).rejects.toThrow()
  })

  test("abortStale aborts only report uploads started before the cutoff, across pages", async () => {
    const upload = (key: string, id: string, initiated: string) =>
      `<Upload><Initiated>${initiated}</Initiated><Key>${key}</Key><UploadId>${id}</UploadId></Upload>`
    const { calls, multipart } = fakeS3((call) => {
      if (call.method === "DELETE") return new Response(null, { status: 204 })
      if (call.url.searchParams.get("key-marker") === "reports/b/media.webm") {
        return xml(`<ListMultipartUploadsResult><IsTruncated>false</IsTruncated>${upload("reports/c/media.webm", "c1", "2026-10-01T00:00:00Z")}</ListMultipartUploadsResult>`)
      }
      return xml(
        `<ListMultipartUploadsResult><IsTruncated>true</IsTruncated><NextKeyMarker>reports/b/media.webm</NextKeyMarker><NextUploadIdMarker>b1</NextUploadIdMarker>${upload(
          "reports/a/media.webm",
          "a1",
          "2026-10-01T00:00:00Z",
        )}${upload("reports/b/media.webm", "b1", "2026-10-23T00:00:00Z")}</ListMultipartUploadsResult>`,
      )
    })

    expect(await multipart.abortStale(new Date("2026-10-20T00:00:00Z"))).toBe(2)
    const listings = calls.filter((call) => call.method === "GET")
    expect(listings.every((call) => call.url.pathname === "/fdebag" && call.url.searchParams.get("prefix") === "reports/")).toBe(true)
    expect(listings[1]?.url.searchParams.get("upload-id-marker")).toBe("b1")
    const aborted = calls.filter((call) => call.method === "DELETE").map((call) => [call.url.pathname, call.url.searchParams.get("uploadId")])
    expect(aborted).toEqual([
      ["/fdebag/reports/a/media.webm", "a1"],
      ["/fdebag/reports/c/media.webm", "c1"],
    ])
  })

  test("abortStale stops when a storage says truncated without moving on", async () => {
    const { calls, multipart } = fakeS3(() =>
      xml("<ListMultipartUploadsResult><IsTruncated>true</IsTruncated></ListMultipartUploadsResult>"),
    )
    expect(await multipart.abortStale(new Date())).toBe(0)
    expect(calls).toHaveLength(1)
  })
})
