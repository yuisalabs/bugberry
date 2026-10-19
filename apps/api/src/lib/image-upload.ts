import type { StorageDriver } from "../storage/types"
import { imageType } from "./image-type"

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
