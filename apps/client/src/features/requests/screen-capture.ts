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

  const recorder = deps.createRecorder(stream, { mimeType: WEBM, videoBitsPerSecond: REQUEST_VIDEO_BITS_PER_SECOND })
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
    for (const track of [...stream.getTracks(), ...extra.flatMap((voice) => voice.getTracks())]) track.stop()
  }

  const done = new Promise<Recording>((resolve) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return
      chunks.push(event.data)
      bytes += event.data.size
      if (bytes >= options.maxBytes * BYTES_MARGIN) stop("limit")
    }
    recorder.onstop = () => {
      const durationMs = stoppedAt - startedAt
      const raw = new Blob(chunks, { type: WEBM })
      // Players need the length written in to show it and seek; a file the fix can't read is kept as it is.
      void withWebmDuration(raw, durationMs)
        .catch(() => raw)
        .then((video) => resolve({ video, durationMs, stoppedBy: stoppedBy ?? "browser" }))
    }
  })

  const timer = deps.setTimeout(() => stop("limit"), options.maxMs)
  for (const track of stream.getVideoTracks()) track.addEventListener("ended", () => stop("browser"))
  recorder.start(1000)
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
