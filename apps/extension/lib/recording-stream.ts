import type { CaptureSource } from "./messages"

/** The browser calls, injected so the choice of tracks can be tested without media devices. */
export interface StreamDeps {
  /** The tab's video and sound, from a tabCapture stream id. */
  tabStream(streamId: string): Promise<MediaStream>
  /** Chrome's share picker; rejects with NotAllowedError when the reporter cancels it. */
  displayStream(surface: "monitor" | "window", systemAudio: boolean): Promise<MediaStream>
  micStream(): Promise<MediaStream>
  /** Plays a captured tab's sound to the speakers: Chrome mutes a captured tab otherwise. Returns a stop function. */
  playBack(stream: MediaStream): () => void
  /** One audio track from the sound of every stream. */
  mixAudio(streams: MediaStream[]): { track: MediaStreamTrack; close(): void }
  compose(tracks: MediaStreamTrack[]): MediaStream
}

export type OpenedStream =
  | {
      kind: "ok"
      stream: MediaStream
      /** The microphone is heard in the recording now. */
      micOn: boolean
      /** A microphone track exists, so it can be turned on or off while recording. */
      micAvailable: boolean
      /** Turns the microphone on or off; returns whether it is on now (always false without one). */
      setMic(on: boolean): boolean
      release(): void
    }
  | { kind: "cancelled" }

function isCancel(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")
}

/** The stream to record: the source's video plus one mixed audio track, when there is any sound. */
export async function openRecordingStream(capture: CaptureSource, mic: boolean, deps: StreamDeps): Promise<OpenedStream> {
  let source: MediaStream
  let stopPlayback = () => {}
  if (capture.kind === "tab") {
    source = await deps.tabStream(capture.streamId)
    if (source.getAudioTracks().length > 0) stopPlayback = deps.playBack(source)
  } else {
    try {
      source = await deps.displayStream(capture.surface, capture.systemAudio)
    } catch (error) {
      if (isCancel(error)) return { kind: "cancelled" }
      throw error
    }
  }

  // Opened even when off, muted, so it can be turned on mid-recording. A microphone that is blocked,
  // unplugged or busy must not cost the reporter the recording.
  const micSource = await deps.micStream().catch(() => null)
  const setMic = (on: boolean) => {
    if (!micSource) return false
    for (const track of micSource.getAudioTracks()) track.enabled = on
    return on
  }
  setMic(mic)
  const sounding = [source, ...(micSource ? [micSource] : [])].filter((stream) => stream.getAudioTracks().length > 0)
  const mix = sounding.length > 0 ? deps.mixAudio(sounding) : null
  const stream = deps.compose([...source.getVideoTracks(), ...(mix ? [mix.track] : [])])

  return {
    kind: "ok",
    stream,
    micOn: micSource !== null && mic,
    micAvailable: micSource !== null,
    setMic,
    release: () => {
      for (const track of [...source.getTracks(), ...(micSource?.getTracks() ?? [])]) track.stop()
      mix?.close()
      stopPlayback()
    },
  }
}
