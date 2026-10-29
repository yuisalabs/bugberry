import { link, mkdir, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { BunFile } from "bun"
import { sign, verify } from "../lib/signing"
import { assertSafeKey } from "./keys"
import { ReadUrlCache } from "./read-url-cache"
import type { ObjectInfo, StorageDriver, UploadTarget } from "./types"

/** Thrown by an exclusive write when the object is already there. */
export class ObjectExistsError extends Error {
  override name = "ObjectExistsError"
  constructor(key: string) {
    super(`Object already exists: ${key}`)
  }
}

export interface LocalUploadClaims {
  p: "up"
  k: string
  t: string
  m: number
  exp: number
}

export interface LocalReadClaims {
  p: "rd"
  k: string
  t: string
  exp: number
}

export interface LocalStorageOptions {
  dir: string
  /** Origin the browser uses to reach this server, e.g. https://bugberry.kantor.com */
  publicBaseUrl: string
  secret: string
  uploadTtlSeconds: number
  readTtlSeconds: number
  now?: () => number
}

export class LocalStorageDriver implements StorageDriver {
  private readonly now: () => number
  private readonly readUrls: ReadUrlCache

  constructor(private readonly options: LocalStorageOptions) {
    this.now = options.now ?? Date.now
    this.readUrls = new ReadUrlCache(this.now)
  }

  async createUploadTarget(key: string, opts: { contentType: string; maxBytes: number }): Promise<UploadTarget> {
    assertSafeKey(key)
    const claims: LocalUploadClaims = {
      p: "up",
      k: key,
      t: opts.contentType,
      m: opts.maxBytes,
      exp: this.now() + this.options.uploadTtlSeconds * 1000,
    }
    return {
      method: "PUT",
      url: `${this.options.publicBaseUrl}/api/uploads/local/${sign(claims, this.options.secret)}`,
      headers: { "content-type": opts.contentType },
    }
  }

  async getReadUrl(key: string, opts: { contentType: string; expiresInSeconds?: number }): Promise<string> {
    assertSafeKey(key)
    const ttlSeconds = opts.expiresInSeconds ?? this.options.readTtlSeconds
    return this.readUrls.get(key, opts.contentType, ttlSeconds, () => {
      const claims: LocalReadClaims = { p: "rd", k: key, t: opts.contentType, exp: this.now() + ttlSeconds * 1000 }
      return `${this.options.publicBaseUrl}/api/files/${sign(claims, this.options.secret)}`
    })
  }

  verifyUploadToken(token: string): LocalUploadClaims | null {
    const claims = verify<LocalUploadClaims>(token, this.options.secret)
    return claims?.p === "up" && claims.exp > Date.now() ? claims : null
  }

  verifyReadToken(token: string): LocalReadClaims | null {
    const claims = verify<LocalReadClaims>(token, this.options.secret)
    return claims?.p === "rd" && claims.exp > Date.now() ? claims : null
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const file = this.openObject(key)
    return (await file.exists()) ? { size: file.size } : null
  }

  async read(key: string): Promise<Blob | null> {
    const file = this.openObject(key)
    return (await file.exists()) ? file : null
  }

  /**
   * Streams the body to a temp file and moves it into place when complete, so an interrupted upload leaves no partial
   * object; with `exclusive` an existing object is never replaced. Returns the bytes written.
   */
  async writeObject(
    key: string,
    body: ReadableStream | Blob | Uint8Array<ArrayBuffer>,
    opts: { exclusive?: boolean } = {},
  ): Promise<number> {
    const path = this.pathFor(key)
    const partialPath = `${path}.part-${crypto.randomUUID()}`
    await mkdir(dirname(path), { recursive: true })
    try {
      const size = await Bun.write(partialPath, new Response(body))
      if (opts.exclusive) {
        // link() fails if the object already exists, so of two racing uploads exactly one lands.
        try {
          await link(partialPath, path)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ObjectExistsError(key)
          throw error
        }
        await rm(partialPath, { force: true })
      } else {
        await rename(partialPath, path)
      }
      return size
    } catch (error) {
      await rm(partialPath, { force: true })
      throw error
    }
  }

  async replace(key: string, body: Uint8Array<ArrayBuffer>, _contentType: string): Promise<void> {
    await this.writeObject(key, body)
  }

  openObject(key: string): BunFile {
    return Bun.file(this.pathFor(key))
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true })
  }

  private pathFor(key: string): string {
    assertSafeKey(key)
    return join(this.options.dir, ...key.split("/"))
  }
}
