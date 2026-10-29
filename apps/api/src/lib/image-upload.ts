import type { StorageDriver } from "../storage/types"
import { notFound, payloadTooLarge, tooManyRequests, unprocessable } from "./errors"
import { newId } from "./ids"
import { imageType } from "./image-type"
import { createRateLimiter } from "./rate-limit"

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
/** An uploaded image's id: random, with the extension that says what it must be. */
export const IMAGE_ID = /^[A-Za-z0-9-]{1,64}\.(png|jpg)$/
export const IMAGE_EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg" } as const
export const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg" } as const

/** The content type an image id promises, or null for an id that is not one of ours. */
export function imageIdType(imageId: string): "image/png" | "image/jpeg" | null {
  const match = IMAGE_ID.exec(imageId)
  return match ? IMAGE_TYPES[match[1] as keyof typeof IMAGE_TYPES] : null
}

/**
 * Checks an image someone just uploaded: it exists, is small enough, and its first bytes really are
 * the promised type. A file that fails is deleted, so nothing unchecked stays in storage.
 */
export async function checkUploadedImage(
  storage: StorageDriver,
  key: string,
  expected: "image/png" | "image/jpeg",
  maxBytes = MAX_IMAGE_BYTES,
): Promise<"ok" | "missing" | "too_large" | "invalid"> {
  const info = await storage.head(key)
  if (!info) return "missing"
  if (info.size > maxBytes) {
    await storage.delete(key)
    return "too_large"
  }
  const blob = await storage.read(key)
  const start = blob ? new Uint8Array(await blob.slice(0, 16).arrayBuffer()) : new Uint8Array()
  if (imageType(start) !== expected) {
    await storage.delete(key)
    return "invalid"
  }
  return "ok"
}

/** One kind of uploaded image (a person's photo, a workspace's or a project's logo) and how its owner stores it. */
export interface ImageSlot {
  storage: StorageDriver
  keyFor: (ownerId: string, imageId: string) => string
  /** The public link an image is served at; the image's id ends it. */
  urlFor: (ownerId: string, imageId: string) => string
  /** The owner's image link now; a pending upload that somehow became it is kept. */
  currentUrl: (ownerId: string) => Promise<string | null>
  /** The upload started but not confirmed yet: one per owner. */
  pending: {
    find: (ownerId: string) => Promise<string | null>
    set: (ownerId: string, imageId: string) => Promise<void>
    remove: (ownerId: string) => Promise<void>
  }
  /** Each upload target lets someone put up to `maxBytes` in storage, so they are capped per owner. */
  uploadsPerHour: number
  maxBytes?: number
  copy: { tooLarge: string; invalid: string; notFoundCode: string; notFound: string }
}

/** Starting, confirming and serving uploads of one kind of image. */
export function imageUploads(slot: ImageSlot) {
  const { storage } = slot
  const maxBytes = slot.maxBytes ?? MAX_IMAGE_BYTES
  const uploads = createRateLimiter({ limit: slot.uploadsPerHour, windowMs: 60 * 60 * 1000 })
  const missing = () => notFound(slot.copy.notFoundCode, slot.copy.notFound)
  /** The storage key behind one of the owner's image links, or null for none or a link from elsewhere. */
  const storedKey = (ownerId: string, url: string | null) => {
    const prefix = slot.urlFor(ownerId, "")
    if (!url?.startsWith(prefix)) return null
    const imageId = url.slice(prefix.length)
    return imageIdType(imageId) ? slot.keyFor(ownerId, imageId) : null
  }

  return {
    /** A target for a new upload; the previous unconfirmed one goes, unless it somehow became the image in use. */
    async start(ownerId: string, body: { contentType: "image/png" | "image/jpeg"; size: number }) {
      if (body.size > maxBytes) throw payloadTooLarge(slot.copy.tooLarge)
      if (!uploads.consume(ownerId)) throw tooManyRequests()
      const imageId = `${newId()}.${IMAGE_EXTENSIONS[body.contentType]}`
      const previous = await slot.pending.find(ownerId)
      if (previous && (await slot.currentUrl(ownerId)) !== slot.urlFor(ownerId, previous)) {
        await storage.delete(slot.keyFor(ownerId, previous)).catch(() => {})
      }
      await slot.pending.set(ownerId, imageId)
      const upload = await storage.createUploadTarget(slot.keyFor(ownerId, imageId), {
        contentType: body.contentType,
        maxBytes: body.size,
      })
      return { upload, imageId }
    },
    /** Checks the uploaded file and returns the link to store for it. */
    async confirm(ownerId: string, imageId: string): Promise<string> {
      const expected = imageIdType(imageId)
      if (!expected) throw missing()
      const verdict = await checkUploadedImage(storage, slot.keyFor(ownerId, imageId), expected, maxBytes)
      if (verdict === "missing") throw missing()
      if (verdict === "too_large") throw payloadTooLarge(slot.copy.tooLarge)
      if (verdict === "invalid") throw unprocessable("invalid_image", slot.copy.invalid)
      await slot.pending.remove(ownerId)
      return slot.urlFor(ownerId, imageId)
    },
    /** Deletes the file behind the link that was replaced, unless the new link is the same file. */
    async dropReplaced(ownerId: string, before: string | null, after: string | null): Promise<void> {
      const old = storedKey(ownerId, before)
      if (old && old !== storedKey(ownerId, after)) await storage.delete(old).catch(() => {})
    },
    /** A redirect to the image; the ids are random and the image is no secret. */
    async serve(ownerId: string, imageId: string): Promise<Response> {
      const contentType = imageIdType(imageId)
      if (!contentType || !/^[A-Za-z0-9-]{1,64}$/.test(ownerId)) throw missing()
      const key = slot.keyFor(ownerId, imageId)
      if (!(await storage.head(key))) throw missing()
      const location = await storage.getReadUrl(key, { contentType })
      return new Response(null, { status: 302, headers: { location, "cache-control": "private, max-age=300" } })
    },
  }
}
