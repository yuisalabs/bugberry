import { THUMBNAIL_CONTENT_TYPE, THUMBNAIL_MAX_WIDTH, THUMBNAIL_QUALITY } from "@bugberry/shared"
import type { UploadTarget } from "./request-upload"

const THUMBNAIL_TIMEOUT_MS = 5000

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The frame could not be drawn"))), type, quality)
  })
}

function drawn(video: HTMLVideoElement, maxWidth: number): HTMLCanvasElement {
  const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas
}

const once = (target: EventTarget, type: string) => new Promise<void>((resolve) => target.addEventListener(type, () => resolve(), { once: true }))

/** One PNG of the shared screen, at its full size. */
export async function frameToPng(track: MediaStreamTrack): Promise<Blob> {
  const video = document.createElement("video")
  video.muted = true
  video.srcObject = new MediaStream([track])
  await video.play()
  // The first frame can still be black when play() resolves.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const png = await canvasBlob(drawn(video, Number.POSITIVE_INFINITY), "image/png")
  video.srcObject = null
  return png
}

/** A small JPEG of the recording's first half second, for the list; null when the browser can't draw one in time. */
export async function videoThumbnail(video: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(video)
  const element = document.createElement("video")
  element.muted = true
  element.src = url
  const work = (async () => {
    await once(element, "loadeddata")
    element.currentTime = Math.min(0.5, Number.isFinite(element.duration) ? element.duration / 2 : 0.5)
    await once(element, "seeked")
    return canvasBlob(drawn(element, THUMBNAIL_MAX_WIDTH), THUMBNAIL_CONTENT_TYPE, THUMBNAIL_QUALITY)
  })()
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), THUMBNAIL_TIMEOUT_MS))
  try {
    return await Promise.race([work, timeout])
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** PUTs a file to a signed link, telling how much of it went up. */
export function putWithProgress(target: UploadTarget, body: Blob, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(target.method, target.url)
    for (const [name, value] of Object.entries(target.headers)) request.setRequestHeader(name, value)
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    request.onload = () => (request.status < 300 ? resolve() : reject(new Error(`The upload was refused (${request.status})`)))
    request.onerror = () => reject(new Error("The upload was cut off"))
    request.send(body)
  })
}
