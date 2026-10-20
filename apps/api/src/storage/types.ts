export interface UploadTarget {
  method: "PUT"
  url: string
  /** Headers the client must send with the PUT request. */
  headers: Record<string, string>
}

export interface ObjectInfo {
  size: number
}

export interface StorageDriver {
  createUploadTarget(key: string, opts: { contentType: string; maxBytes: number }): Promise<UploadTarget>
  head(key: string): Promise<ObjectInfo | null>
  /** The object's bytes, or null when it does not exist. */
  read(key: string): Promise<Blob | null>
  /** `expiresInSeconds` overrides READ_URL_TTL_SECONDS for this link. */
  getReadUrl(key: string, opts: { contentType: string; expiresInSeconds?: number }): Promise<string>
  /** Overwrites an existing object (maintenance scripts; uploads go through createUploadTarget). */
  replace(key: string, body: Uint8Array<ArrayBuffer>, contentType: string): Promise<void>
  delete(key: string): Promise<void>
}
