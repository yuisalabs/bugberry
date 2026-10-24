export const MAX_RECORDING_MS = 20 * 60 * 1000
/** A 20-minute recording with sound comes to about 245 MB, under the server's default MAX_UPLOAD_MB (300). */
export const VIDEO_BITS_PER_SECOND = 1_500_000
export const AUDIO_BITS_PER_SECOND = 128_000
const TIMESLICE_MS = 1000
/**
 * A keyframe every second (Chrome; others ignore it). Chrome otherwise puts them far apart, and every seek in the
 * review's player and Trim strip decodes from the last one: 50–150 ms per seek on a 40 s recording, against
 * 15–60 ms with this, for about 12% more bytes.
 */
const KEYFRAME_INTERVAL_MS = 1000
const MIME_TYPES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"] as const
/** With sound the audio codec must be named too: Firefox refuses to record an audio track into a video-only type. */
const MIME_TYPES_WITH_AUDIO = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"] as const

export type RecordingEndReason = "max-duration" | "size-limit" | "source-ended" | "error"

export interface RecorderHandlers {
  onData(chunk: Blob): void
  onStop(): void
  onError(): void
}

export interface RecorderLike {
  readonly state: string
  start(timesliceMs?: number): void
  pause(): void
  resume(): void
  stop(): void
}

export interface TrackLike {
  readonly kind?: string
  stop(): void
  addEventListener(type: "ended", listener: () => void): void
}

export interface StreamLike {
  getTracks(): TrackLike[]
}

export interface RecordingDeps {
  createRecorder(
    stream: StreamLike,
    options: { mimeType: string; videoBitsPerSecond: number; audioBitsPerSecond: number; videoKeyFrameIntervalDuration: number },
    handlers: RecorderHandlers,
  ): RecorderLike
  isTypeSupported(type: string): boolean
  /** Writes the duration into the WebM header so players can seek (MediaRecorder leaves it out). */
  fixDuration(video: Blob, durationMs: number): Promise<Blob>
  now(): number
  /** Returns a function that cancels the timer. */
  setTimer(callback: () => void, ms: number): () => void
}

export interface Recording {
  readonly startedAt: number
  /** Stops the recorder (if still running) and resolves with the finished video; safe to call twice. */
  stop(): Promise<{ video: Blob; durationMs: number }>
  /** Nothing is recorded, and the time limit waits, until `resume`. */
  pause(): void
  resume(): void
  /** Drops this take without touching the stream, so a new take can start on it (Restart). */
  cancel(): Promise<void>
}

export function pickMimeType(isTypeSupported: (type: string) => boolean, withAudio = false): string {
  return (withAudio ? MIME_TYPES_WITH_AUDIO : MIME_TYPES).find((type) => isTypeSupported(type)) ?? "video/webm"
}

/**
 * Records `stream` with MediaRecorder. `onEnded` fires once when the recording ends by itself
 * (time limit, video reached `maxBytes`, captured source gone, recorder error); the caller then
 * calls `stop()` to collect it.
 */
export function startRecording(
  stream: StreamLike,
  deps: RecordingDeps,
  onEnded: (reason: RecordingEndReason) => void,
  options: { maxBytes: number },
): Recording {
  const chunks: Blob[] = []
  let bytes = 0
  let endedAt: number | null = null
  let notified = false
  const notify = (reason: RecordingEndReason) => {
    if (notified) return
    notified = true
    onEnded(reason)
  }

  let markStopped = () => {}
  const stopped = new Promise<void>((resolve) => {
    markStopped = resolve
  })
  const withAudio = stream.getTracks().some((track) => track.kind === "audio")
  const recorder = deps.createRecorder(
    stream,
    {
      mimeType: pickMimeType(deps.isTypeSupported, withAudio),
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      videoKeyFrameIntervalDuration: KEYFRAME_INTERVAL_MS,
    },
    {
      onData: (chunk) => {
        if (chunk.size === 0) return
        chunks.push(chunk)
        bytes += chunk.size
        if (bytes >= options.maxBytes) notify("size-limit")
      },
      onStop: () => {
        endedAt ??= deps.now()
        markStopped()
      },
      onError: () => notify("error"),
    },
  )

  const startedAt = deps.now()
  // Only recording time counts, for the duration and for the time limit.
  let activeMs = 0
  let runningSince: number | null = startedAt
  let cancelTimer = deps.setTimer(() => notify("max-duration"), MAX_RECORDING_MS)
  for (const track of stream.getTracks()) track.addEventListener("ended", () => notify("source-ended"))
  recorder.start(TIMESLICE_MS)

  const pause = () => {
    if (runningSince === null || recorder.state !== "recording") return
    activeMs += deps.now() - runningSince
    runningSince = null
    cancelTimer()
    recorder.pause()
  }
  const resume = () => {
    if (runningSince !== null || recorder.state !== "paused") return
    runningSince = deps.now()
    cancelTimer = deps.setTimer(() => notify("max-duration"), Math.max(0, MAX_RECORDING_MS - activeMs))
    recorder.resume()
  }
  const cancel = async () => {
    notified = true // this take is over; its stream's end belongs to the next one
    cancelTimer()
    if (recorder.state !== "inactive") recorder.stop()
    await stopped
    chunks.length = 0
  }

  let result: Promise<{ video: Blob; durationMs: number }> | null = null
  const stop = () => {
    result ??= (async () => {
      cancelTimer()
      if (recorder.state !== "inactive") recorder.stop()
      await stopped
      for (const track of stream.getTracks()) track.stop()
      const durationMs = Math.max(0, activeMs + (runningSince === null ? 0 : (endedAt ?? deps.now()) - runningSince))
      const raw = new Blob(chunks, { type: "video/webm" })
      const video = await deps.fixDuration(raw, durationMs).catch(() => raw)
      return { video, durationMs }
    })()
    return result
  }

  return { startedAt, stop, pause, resume, cancel }
}
