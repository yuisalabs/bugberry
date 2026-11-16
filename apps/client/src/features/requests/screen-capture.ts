import { withWebmDuration } from "@bugberry/capture"
import { REQUEST_VIDEO_BITS_PER_SECOND } from "@bugberry/shared"

export type CaptureSupport = "video" | "screenshot" | "none"

const WEBM = "video/webm"
/** The last chunk lands after the stop, so recording ends a little before the cap to stay under it. */
const BYTES_MARGIN = 0.95

/** What this browser can do: "none" without getDisplayMedia, "screenshot" when it records no WebM. */
export function captureSupport(env: {
  mediaDevices?: Pick<MediaDevices, "getDisplayMedia">
  isTypeSupported?(type: string): boolean
}): CaptureSupport {
  if (typeof env.mediaDevices?.getDisplayMedia !== "function") return "none"
  return env.isTypeSupported?.(WEBM) ? "video" : "screenshot"
}

export interface CaptureDeps {
  getDisplayMedia(constraints: DisplayMediaStreamOptions): Promise<MediaStream>
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
  createRecorder(stream: MediaStream, options: MediaRecorderOptions): MediaRecorder
  now(): number
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
}

export interface Recording {
  video: Blob
  durationMs: number
  stoppedBy: "button" | "browser" | "limit"
}

export interface RecordingHandle {
  stop(): void
  done: Promise<Recording>
  stream: MediaStream
}

/** The recording stopped before the recorder handed over any of it. */
export class EmptyRecording extends Error {
  constructor() {
    super("Nothing was recorded")
    this.name = "EmptyRecording"
  }
}

/** The person closed the browser's picker, or refused to share. */
export class CaptureDenied extends Error {
  constructor() {
    super("Screen sharing was cancelled")
    this.name = "CaptureDenied"
  }
}

async function pickScreen(deps: Pick<CaptureDeps, "getDisplayMedia">, audio: boolean): Promise<MediaStream> {
  try {
    return await deps.getDisplayMedia({ video: true, audio })
  } catch {
    throw new CaptureDenied()
  }
}

/** Starts recording what the person picks, with their microphone when `mic`. Rejects with CaptureDenied when they cancel the browser's picker. */
export async function startRecording(
  deps: CaptureDeps,
  options: { mic: boolean; maxMs: number; maxBytes: number },
): Promise<RecordingHandle> {
  const stream = await pickScreen(deps, false)
  const extra: MediaStream[] = []
  if (options.mic) {
    // A refused microphone costs the sound, never the recording.
    const voice = await deps.getUserMedia({ audio: true }).catch(() => null)
    if (voice) {
      extra.push(voice)
      for (const track of voice.getAudioTracks()) stream.addTrack(track)
    }
  }

  const stopAll = () => {
    for (const track of [...stream.getTracks(), ...extra.flatMap((voice) => voice.getTracks())]) track.stop()
  }
  let recorder: MediaRecorder
  try {
    recorder = deps.createRecorder(stream, { mimeType: WEBM, videoBitsPerSecond: REQUEST_VIDEO_BITS_PER_SECOND })
  } catch (error) {
    // The person already picked what to share: never leave it shared behind an error.
    stopAll()
    throw error
  }
  const chunks: Blob[] = []
  let bytes = 0
  let stoppedBy: Recording["stoppedBy"] | null = null
  const startedAt = deps.now()
  let stoppedAt = startedAt

  const stop = (reason: Recording["stoppedBy"]) => {
    if (stoppedBy) return
    stoppedBy = reason
    stoppedAt = deps.now()
    deps.clearTimeout(timer)
    if (recorder.state !== "inactive") recorder.stop()
    stopAll()
  }

  const done = new Promise<Recording>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return
      chunks.push(event.data)
      bytes += event.data.size
      if (bytes >= options.maxBytes * BYTES_MARGIN) stop("limit")
    }
    recorder.onstop = () => {
      // The recorder can stop by itself, before the track's ended listener runs: the time is taken here then.
      stop("browser")
      if (chunks.length === 0) {
        reject(new EmptyRecording())
        return
      }
      // A timer fires late, never early: a recording the limit stopped is the limit long.
      const durationMs = Math.min(stoppedAt - startedAt, options.maxMs)
      const raw = new Blob(chunks, { type: WEBM })
      // Players need the length written in to show it and seek; a file the fix can't read is kept as it is.
      void withWebmDuration(raw, durationMs)
        .catch(() => raw)
        .then((video) => resolve({ video, durationMs, stoppedBy: stoppedBy ?? "browser" }))
    }
  })

  const timer = deps.setTimeout(() => stop("limit"), options.maxMs)
  for (const track of stream.getVideoTracks()) track.addEventListener("ended", () => stop("browser"))
  try {
    recorder.start(1000)
  } catch (error) {
    deps.clearTimeout(timer)
    stopAll()
    throw error
  }
  return { stop: () => stop("button"), done, stream }
}

/** One PNG of what the person picks. */
export async function takeScreenshot(
  deps: Pick<CaptureDeps, "getDisplayMedia">,
  toPng: (track: MediaStreamTrack) => Promise<Blob>,
): Promise<Blob> {
  const stream = await pickScreen(deps, false)
  try {
    const [track] = stream.getVideoTracks()
    if (!track) throw new CaptureDenied()
    return await toPng(track)
  } finally {
    for (const track of stream.getTracks()) track.stop()
  }
}
