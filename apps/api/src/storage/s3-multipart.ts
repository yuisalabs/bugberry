import { assertSafeKey } from "./keys"
import { presignUrl } from "./presign"
import type { S3StorageOptions } from "./s3"
import type { MultipartCompletion, MultipartStorage, UploadTarget } from "./types"

/** Links the server signs for its own requests: used at once, so a short lifetime is enough. */
const SERVER_URL_TTL_SECONDS = 300
/** Joining a few hundred MB can take the storage a while; a dead connection must not hang finalize forever. */
const REQUEST_TIMEOUT_MS = 120_000
/** Only report files are ever sent in parts. */
const UPLOAD_PREFIX = "reports/"

type Method = "GET" | "PUT" | "POST" | "DELETE"

const ENTITIES: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'" }

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|quot|amp|lt|gt|apos);/g, (_, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    return ENTITIES[entity] ?? ""
  })
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&${({ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "apos" })[char]};`)
}

/** The text of the first `<name>` element in `xml`. S3's answers are flat and well formed, so no parser is needed. */
function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)
  return match?.[1] === undefined ? null : decodeXml(match[1])
}

/** The inner XML of every `<name>` element in `xml`. */
function blocks(xml: string, name: string): string[] {
  return Array.from(xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g")), (match) => match[1] ?? "")
}

/** The S3 calls behind uploads in parts, signed like the upload links (SigV4 in the query string). */
export class S3Multipart implements MultipartStorage {
  constructor(
    private readonly options: S3StorageOptions,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private sign(method: Method, key: string, query: Record<string, string>, opts: { headers?: Record<string, string>; expiresIn?: number } = {}) {
    return presignUrl({
      method,
      endpoint: this.options.endpoint,
      bucket: this.options.bucket,
      key,
      region: this.options.region,
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey,
      virtualHostedStyle: this.options.virtualHostedStyle,
      expiresIn: opts.expiresIn ?? SERVER_URL_TTL_SECONDS,
      headers: opts.headers,
      query,
    })
  }

  private async send(
    method: Method,
    key: string,
    query: Record<string, string>,
    init: { headers?: Record<string, string>; body?: string } = {},
  ): Promise<{ status: number; xml: string }> {
    const response = await this.fetcher(this.sign(method, key, query, { headers: init.headers }), {
      method,
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return { status: response.status, xml: await response.text() }
  }

  async create(key: string, opts: { contentType: string; partSizes: number[] }) {
    assertSafeKey(key)
    if (opts.partSizes.length === 0) throw new Error("An upload in parts needs at least one part")
    // The content type is set here, for the joined object; the parts themselves carry none.
    const { status, xml } = await this.send("POST", key, { uploads: "" }, { headers: { "content-type": opts.contentType } })
    const uploadId = status === 200 ? tag(xml, "UploadId") : null
    if (!uploadId) throw storageError("start an upload in parts", status, xml)
    return { uploadId, parts: this.signParts(key, uploadId, opts.partSizes) }
  }

  signParts(key: string, uploadId: string, partSizes: number[]): UploadTarget[] {
    assertSafeKey(key)
    return partSizes.map((size, index) => ({
      method: "PUT",
      // The signed content-length makes the storage refuse a part of any other size.
      url: this.sign("PUT", key, { partNumber: String(index + 1), uploadId }, {
        headers: { "content-length": String(size) },
        expiresIn: this.options.uploadTtlSeconds,
      }),
      headers: {},
    }))
  }

  async complete(key: string, uploadId: string, partSizes: number[]): Promise<MultipartCompletion> {
    assertSafeKey(key)
    const listed = await this.listParts(key, uploadId)
    if (listed === null) return "gone"
    const parts: string[] = []
    for (const [index, size] of partSizes.entries()) {
      const part = listed.get(index + 1)
      if (!part) return "incomplete"
      if (part.size !== size) return "mismatch"
      parts.push(`<Part><PartNumber>${index + 1}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`)
    }
    // Parts beyond the last are never signed, so none can exist; the request names exactly the expected ones.
    const body = `<CompleteMultipartUpload>${parts.join("")}</CompleteMultipartUpload>`
    const { status, xml } = await this.send("POST", key, { uploadId }, { body })
    // S3 can answer 200 and still report an error in the body.
    if (status === 200 && !xml.includes("<Error>")) return "completed"
    if (status === 404 && tag(xml, "Code") === "NoSuchUpload") return "gone"
    throw storageError("finish an upload in parts", status, xml)
  }

  async abort(key: string, uploadId: string) {
    assertSafeKey(key)
    const { status, xml } = await this.send("DELETE", key, { uploadId })
    if (status === 204 || status === 200 || (status === 404 && tag(xml, "Code") === "NoSuchUpload")) return
    throw storageError("abort an upload in parts", status, xml)
  }

  async abortStale(olderThan: Date) {
    let aborted = 0
    let keyMarker = ""
    let uploadIdMarker = ""
    for (;;) {
      const query: Record<string, string> = { uploads: "", prefix: UPLOAD_PREFIX }
      if (keyMarker) query["key-marker"] = keyMarker
      if (uploadIdMarker) query["upload-id-marker"] = uploadIdMarker
      const { status, xml } = await this.send("GET", "", query)
      if (status !== 200) throw storageError("list uploads in parts", status, xml)
      for (const upload of blocks(xml, "Upload")) {
        const key = tag(upload, "Key")
        const uploadId = tag(upload, "UploadId")
        const initiated = Date.parse(tag(upload, "Initiated") ?? "")
        if (!key || !uploadId || !(initiated < olderThan.getTime())) continue
        try {
          await this.abort(key, uploadId)
          aborted++
        } catch (error) {
          // A key outside BugBerry's own layout is not ours to touch (assertSafeKey), and one failure must not stop the rest.
          console.warn("cleanup: abort of an upload in parts failed", key, error)
        }
      }
      if (tag(xml, "IsTruncated") !== "true") return aborted
      const nextKey = tag(xml, "NextKeyMarker") ?? ""
      const nextUploadId = tag(xml, "NextUploadIdMarker") ?? ""
      // A storage that says "truncated" without moving the markers would loop forever.
      if (!nextKey || (nextKey === keyMarker && nextUploadId === uploadIdMarker)) return aborted
      keyMarker = nextKey
      uploadIdMarker = nextUploadId
    }
  }

  /** The parts the storage holds, by part number; null when it doesn't know the upload. */
  private async listParts(key: string, uploadId: string): Promise<Map<number, { etag: string; size: number }> | null> {
    const parts = new Map<number, { etag: string; size: number }>()
    let marker = ""
    for (;;) {
      const query: Record<string, string> = { uploadId, "max-parts": "1000" }
      if (marker) query["part-number-marker"] = marker
      const { status, xml } = await this.send("GET", key, query)
      if (status === 404 && tag(xml, "Code") === "NoSuchUpload") return null
      if (status !== 200) throw storageError("list the parts of an upload", status, xml)
      for (const part of blocks(xml, "Part")) {
        const number = Number(tag(part, "PartNumber"))
        const size = Number(tag(part, "Size"))
        const etag = tag(part, "ETag")
        if (Number.isSafeInteger(number) && Number.isSafeInteger(size) && etag) parts.set(number, { etag, size })
      }
      if (tag(xml, "IsTruncated") !== "true") return parts
      const next = tag(xml, "NextPartNumberMarker") ?? ""
      if (!next || next === marker) return parts
      marker = next
    }
  }
}

function storageError(action: string, status: number, xml: string): Error {
  const code = tag(xml, "Code")
  return new Error(`Storage could not ${action}: HTTP ${status}${code ? ` ${code}` : ""}`)
}
