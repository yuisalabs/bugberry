import { MAX_THUMBNAIL_BYTES, THUMBNAIL_MAX_WIDTH, THUMBNAIL_QUALITY } from "@bugberry/shared"

/** Something decoded that `encodeJpeg` can draw: an ImageBitmap in the browser, a plain object in tests. */
export interface ThumbnailSource {
  width: number
  height: number
  close?(): void
}

/** Browser work kept behind an interface, so the logic runs in Bun tests without a DOM. */
export interface ThumbnailDeps {
  decodeImage(blob: Blob): Promise<ThumbnailSource>
  videoFrame(blob: Blob, atSeconds: number): Promise<ThumbnailSource>
  encodeJpeg(source: ThumbnailSource, size: { width: number; height: number }, quality: number): Promise<Blob>
}

/** Fits the source into `maxWidth`, keeping its ratio; never scales up. */
export function thumbnailSize(
  source: { width: number; height: number },
  maxWidth = THUMBNAIL_MAX_WIDTH,
): { width: number; height: number } {
  if (source.width <= maxWidth) return { width: source.width, height: source.height }
  return { width: maxWidth, height: Math.max(1, Math.round((source.height * maxWidth) / source.width)) }
}

/** The very first frame is often still blank, so the preview comes from second 1 when the video is long enough. */
export function frameSeconds(durationMs: number | null): number {
  return durationMs !== null && durationMs > 1000 ? 1 : 0
}

/**
 * A small JPEG preview of the report's media, or null when one cannot be made. Never throws: a missing
 * preview must not stop the report from being sent.
 */
export async function makeThumbnail(
  media: Blob,
  capture: { captureType: "screenshot" | "video"; durationMs: number | null },
  deps: ThumbnailDeps,
): Promise<Blob | null> {
  let source: ThumbnailSource | null = null
  try {
    source =
      capture.captureType === "video"
        ? await deps.videoFrame(media, frameSeconds(capture.durationMs))
        : await deps.decodeImage(media)
    const thumbnail = await deps.encodeJpeg(source, thumbnailSize(source), THUMBNAIL_QUALITY)
    return thumbnail.size > 0 && thumbnail.size <= MAX_THUMBNAIL_BYTES ? thumbnail : null
  } catch (error) {
    console.warn("thumbnail failed", error)
    return null
  } finally {
    source?.close?.()
  }
}
