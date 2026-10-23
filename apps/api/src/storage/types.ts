export interface UploadTarget {
  method: "PUT"
  url: string
  /** Headers the client must send with the PUT request. */
  headers: Record<string, string>
}

export interface ObjectInfo {
  size: number
}

/** How finishing an upload in parts went. */
export type MultipartCompletion =
  /** The parts are joined into the object. */
  | "completed"
  /** Some parts have not arrived yet; the client can still send them. */
  | "incomplete"
  /** A part has another size than its link allowed. */
  | "mismatch"
  /** The storage no longer knows the upload: finished by an earlier call, or aborted. */
  | "gone"

/** A file sent as several requests, each small enough for a proxy's body limit (Cloudflare: 100 MB). */
export interface MultipartStorage {
  /** Starts the upload and signs one PUT link per part; each link accepts exactly its part's size. */
  create(key: string, opts: { contentType: string; partSizes: number[] }): Promise<{ uploadId: string; parts: UploadTarget[] }>
  /** New links for an upload already started, for when the first ones expire before the last part is sent. */
  signParts(key: string, uploadId: string, partSizes: number[]): UploadTarget[]
  /** Checks every part against `partSizes`, as the storage lists them, and joins them only when all match. */
  complete(key: string, uploadId: string, partSizes: number[]): Promise<MultipartCompletion>
  /** Drops the parts sent so far; an upload the storage no longer knows is not an error. */
  abort(key: string, uploadId: string): Promise<void>
  /** Aborts report uploads started before `olderThan` and never finished; returns how many. */
  abortStale(olderThan: Date): Promise<number>
}

export interface StorageDriver {
  createUploadTarget(key: string, opts: { contentType: string; maxBytes: number }): Promise<UploadTarget>
  /** Present when the storage takes a file in parts (S3); without it every file goes up in one PUT. */
  multipart?: MultipartStorage
  head(key: string): Promise<ObjectInfo | null>
  /** The object's bytes, or null when it does not exist. */
  read(key: string): Promise<Blob | null>
  /** `expiresInSeconds` overrides READ_URL_TTL_SECONDS for this link. */
  getReadUrl(key: string, opts: { contentType: string; expiresInSeconds?: number }): Promise<string>
  /** Overwrites an existing object (maintenance scripts; uploads go through createUploadTarget). */
  replace(key: string, body: Uint8Array<ArrayBuffer>, contentType: string): Promise<void>
  delete(key: string): Promise<void>
}
