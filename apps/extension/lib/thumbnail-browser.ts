import { THUMBNAIL_CONTENT_TYPE } from "@bugberry/shared"
import type { ThumbnailDeps, ThumbnailSource } from "./thumbnail"

const FRAME_TIMEOUT_MS = 5000

/** Seeks a detached <video> to `atSeconds` and captures that frame. */
async function videoFrame(blob: Blob, atSeconds: number): Promise<ThumbnailSource> {
  const url = URL.createObjectURL(blob)
  const video = document.createElement("video")
  video.muted = true
  video.preload = "auto"
  video.playsInline = true
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("video frame timed out")), FRAME_TIMEOUT_MS)
      video.addEventListener("error", () => {
        clearTimeout(timer)
        reject(new Error("video could not be decoded"))
      })
      video.addEventListener(
        "seeked",
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
      video.addEventListener(
        "loadeddata",
        () => {
          // Clamped, in case the duration is shorter than the header claimed.
          const end = Number.isFinite(video.duration) ? video.duration : atSeconds
          video.currentTime = Math.min(atSeconds, Math.max(0, end - 0.05))
        },
        { once: true },
      )
      video.src = url
    })
    return await createImageBitmap(video)
  } finally {
    video.removeAttribute("src")
    video.load()
    URL.revokeObjectURL(url)
  }
}

async function encodeJpeg(source: ThumbnailSource, size: { width: number; height: number }, quality: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(size.width, size.height)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("no 2d context")
  context.drawImage(source as ImageBitmap, 0, 0, size.width, size.height)
  return canvas.convertToBlob({ type: THUMBNAIL_CONTENT_TYPE, quality })
}

/** The real browser implementation, used by the editor page. */
export const browserThumbnailDeps: ThumbnailDeps = {
  decodeImage: (blob) => createImageBitmap(blob),
  videoFrame,
  encodeJpeg,
}
