import { BlobSource, BufferTarget, Conversion, Input, Output, WEBM, WebMOutputFormat } from "mediabunny"
import { AUDIO_BITS_PER_SECOND, VIDEO_BITS_PER_SECOND } from "./recorder"
import type { TrimRange } from "./review-data"

/** The range as mediabunny takes it: seconds. */
export function conversionTrim(range: TrimRange): { start: number; end: number } {
  return { start: range.startMs / 1000, end: range.endMs / 1000 }
}

/**
 * The recording cut to `range`, as a new WebM. Every frame is encoded again (WebCodecs, through mediabunny): a
 * copy could only cut at keyframes, which MediaRecorder puts far apart. mediabunny writes the Duration itself, so
 * this is not run through withWebmDuration, which would move the bytes its SeekHead and Cues point at.
 */
export async function trimVideo(video: Blob, range: TrimRange, onProgress?: (fraction: number) => void): Promise<Blob> {
  const input = new Input({ source: new BlobSource(video), formats: [WEBM] })
  try {
    const target = new BufferTarget()
    const conversion = await Conversion.init({
      input,
      output: new Output({ format: new WebMOutputFormat(), target }),
      trim: conversionTrim(range),
      video: { forceTranscode: true, bitrate: VIDEO_BITS_PER_SECOND },
      audio: { forceTranscode: true, bitrate: AUDIO_BITS_PER_SECOND },
    })
    const lostVideo = conversion.discardedTracks.filter((discarded) => discarded.track.type === "video")
    if (!conversion.isValid || lostVideo.length > 0) {
      const reasons = conversion.discardedTracks.map((discarded) => `${discarded.track.type}: ${discarded.reason}`)
      throw new Error(reasons.join(", ") || "this browser can't encode the video")
    }
    if (onProgress) conversion.onProgress = (fraction) => onProgress(fraction)
    await conversion.execute()
    if (!target.buffer) throw new Error("the encoder produced no video")
    return new Blob([target.buffer], { type: "video/webm" })
  } finally {
    input.dispose()
  }
}
