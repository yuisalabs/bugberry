import { createHash, createHmac } from "node:crypto"

export interface PresignInput {
  method: "GET" | "PUT"
  /** e.g. https://<account_id>.r2.cloudflarestorage.com or http://localhost:9000 */
  endpoint: string
  bucket: string
  key: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  virtualHostedStyle: boolean
  expiresIn: number
  /**
   * Headers the request must carry with exactly these values (lowercase names). They are signed, so
   * the storage rejects a request whose content-length or content-type differs.
   */
  headers?: Record<string, string>
  now?: Date
}

/** RFC 3986 encoding as SigV4 wants it; `/` is kept in paths. */
function uriEncode(value: string, keepSlash: boolean): string {
  return Array.from(new TextEncoder().encode(value), (byte) => {
    const char = String.fromCharCode(byte)
    if (/[A-Za-z0-9\-_.~]/.test(char) || (keepSlash && char === "/")) return char
    return `%${byte.toString(16).toUpperCase().padStart(2, "0")}`
  }).join("")
}

const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest()
const sha256Hex = (data: string) => createHash("sha256").update(data).digest("hex")

/**
 * Presigned URL with AWS Signature Version 4 (query-string authentication), as S3, R2, MinIO and
 * RustFS accept it. Bun's presign signs only the host, so a PUT could carry any size or type; signing
 * content-length and content-type here makes the storage itself refuse anything but the declared file.
 */
export function presignUrl(input: PresignInput): string {
  const endpoint = new URL(input.endpoint)
  const host = input.virtualHostedStyle ? `${input.bucket}.${endpoint.host}` : endpoint.host
  const path = input.virtualHostedStyle
    ? `/${uriEncode(input.key, true)}`
    : `/${uriEncode(input.bucket, false)}/${uriEncode(input.key, true)}`

  const now = input.now ?? new Date()
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
  const date = amzDate.slice(0, 8)
  const scope = `${date}/${input.region}/s3/aws4_request`

  const headers: Record<string, string> = { ...input.headers, host }
  const headerNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort()
  const signedHeaders = headerNames.join(";")
  const canonicalHeaders = headerNames.map((name) => `${name}:${String(headers[name]).trim()}\n`).join("")

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresIn),
    "X-Amz-SignedHeaders": signedHeaders,
  }
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${uriEncode(name, false)}=${uriEncode(query[name] ?? "", false)}`)
    .join("&")

  const canonicalRequest = [input.method, path, canonicalQuery, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join(
    "\n",
  )
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n")
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), "s3"), "aws4_request")
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex")

  return `${endpoint.protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`
}
