import { S3Client } from "bun"
import { assertSafeKey } from "./keys"
import { presignUrl } from "./presign"
import type { ObjectInfo, StorageDriver, UploadTarget } from "./types"

export interface S3StorageOptions {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  virtualHostedStyle: boolean
  uploadTtlSeconds: number
  readTtlSeconds: number
}

/**
 * Works with AWS S3, MinIO, RustFS and Cloudflare R2 (R2: endpoint https://<account_id>.r2.cloudflarestorage.com,
 * region "auto"). Upload links sign the exact content-length and content-type, so the storage refuses any other
 * file; finalize still compares the stored size as a second check.
 */
export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client

  constructor(private readonly options: S3StorageOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      bucket: options.bucket,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      virtualHostedStyle: options.virtualHostedStyle,
    })
  }

  /** `maxBytes` is the declared size; the link accepts exactly that many bytes of exactly that type. */
  async createUploadTarget(key: string, opts: { contentType: string; maxBytes: number }): Promise<UploadTarget> {
    assertSafeKey(key)
    const url = presignUrl({
      method: "PUT",
      endpoint: this.options.endpoint,
      bucket: this.options.bucket,
      key,
      region: this.options.region,
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey,
      virtualHostedStyle: this.options.virtualHostedStyle,
      expiresIn: this.options.uploadTtlSeconds,
      // The browser sets content-length from the body itself; only content-type is sent by hand.
      headers: { "content-length": String(opts.maxBytes), "content-type": opts.contentType },
    })
    return { method: "PUT", url, headers: { "content-type": opts.contentType } }
  }

  async read(key: string): Promise<Blob | null> {
    assertSafeKey(key)
    const file = this.client.file(key)
    return (await file.exists()) ? file : null
  }

  async head(key: string): Promise<ObjectInfo | null> {
    assertSafeKey(key)
    const file = this.client.file(key)
    if (!(await file.exists())) return null
    const stat = await file.stat()
    return { size: stat.size }
  }

  async getReadUrl(key: string, opts: { contentType: string; expiresInSeconds?: number }): Promise<string> {
    assertSafeKey(key)
    return this.client.presign(key, {
      method: "GET",
      expiresIn: opts.expiresInSeconds ?? this.options.readTtlSeconds,
      type: opts.contentType,
    })
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key)
    await this.client.delete(key)
  }
}
