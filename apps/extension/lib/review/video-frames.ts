const FRAME_HEIGHT = 48

/**
 * `count` small frames of the video, evenly spaced, as data URLs for the Trim strip. Never rejects: a video that
 * won't load or seek gives none, and the strip shows plain blocks.
 */
export async function videoFrames(video: Blob, durationMs: number, count: number): Promise<string[]> {
  const url = URL.createObjectURL(video)
  const element = document.createElement("video")
  element.muted = true
  element.preload = "auto"
  element.src = url
  const once = (event: "loadeddata" | "seeked") =>
    new Promise<void>((resolve, reject) => {
      element.addEventListener(event, () => resolve(), { once: true })
      element.addEventListener("error", () => reject(new Error("video error")), { once: true })
    })
  try {
    await once("loadeddata")
    const width = Math.max(1, Math.round((element.videoWidth / Math.max(1, element.videoHeight)) * FRAME_HEIGHT))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = FRAME_HEIGHT
    const context = canvas.getContext("2d")
    if (!context) return []
    const frames: string[] = []
    for (let index = 0; index < count; index++) {
      const seeked = once("seeked")
      // The middle of each slice, so the first frame isn't the blank one a recording often starts with.
      element.currentTime = ((index + 0.5) * durationMs) / count / 1000
      await seeked
      context.drawImage(element, 0, 0, width, FRAME_HEIGHT)
      frames.push(canvas.toDataURL("image/jpeg", 0.6))
    }
    return frames
  } catch {
    return []
  } finally {
    element.removeAttribute("src")
    URL.revokeObjectURL(url)
  }
}
