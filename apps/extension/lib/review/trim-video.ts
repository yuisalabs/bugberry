import { BlobSource, BufferTarget, Conversion, Input, Output, WEBM, WebMOutputFormat } from "mediabunny"
import { AUDIO_BITS_PER_SECOND, VIDEO_BITS_PER_SECOND } from "../recording/recorder"
import type { TrimRange } from "./review-data"

/** The range as mediabunny takes it: seconds. */
export function conversionTrim(range: TrimRange): { start: number; end: number } {
  return { start: range.startMs / 1000, end: range.endMs / 1000 }
}

/**
 * What a conversion would leave out, or null. Any track counts, sound included: a trimmed video that silently
 * lost the reporter's narration is worse than the choice to send the full one.
 */
export function lostTracks(discarded: ReadonlyArray<{ type: string; reason: string }>): string | null {
  return discarded.length > 0 ? discarded.map((track) => `${track.type}: ${track.reason}`).join(", ") : null
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
    const lost = lostTracks(conversion.discardedTracks.map((discarded) => ({ type: discarded.track.type, reason: discarded.reason })))
    if (!conversion.isValid || lost) throw new Error(lost ?? "this browser can't encode the video")
    if (onProgress) conversion.onProgress = (fraction) => onProgress(fraction)
    await conversion.execute()
    if (!target.buffer) throw new Error("the encoder produced no video")
    return new Blob([target.buffer], { type: "video/webm" })
  } finally {
    input.dispose()
  }
}
