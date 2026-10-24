import type { DraftStore } from "./draft-store"
import type { OffscreenMessage } from "./messages"
import { type Recording, type RecordingDeps, type RecordingEndReason, startRecording } from "./recorder"
import { type OpenedStream, openRecordingStream, type StreamDeps } from "./recording-stream"
import { withWebmDuration } from "./webm-duration"

/**
 * The recorder behind the `bugberry:offscreen-*` messages, wherever it runs: Chrome's offscreen document,
 * or Firefox's recorder window. The finished video goes straight into the draft in IndexedDB; runtime
 * messages cannot carry Blobs.
 */
export interface RecorderHandlerDeps {
  store: Pick<DraftStore, "get" | "put">
  recording: RecordingDeps
  stream: StreamDeps
  /** The recording ended by itself (time limit, size, source gone, error). */
  noticeEnded(reason: RecordingEndReason): void
}

export type RecorderReply =
  | { ok: true; micOn?: boolean; micAvailable?: boolean; startedAt?: number; durationMs?: number }
  | { ok: false; error: string; code?: "cancelled" }

type OpenedRecording = Extract<OpenedStream, { kind: "ok" }>

export function createRecorderHandler(deps: RecorderHandlerDeps) {
  /** The stream from `open`, and the take running on it since `begin` (null before it, and after a Restart). */
  let opened: { draftId: string; stream: OpenedRecording; maxBytes: number; maxMs: number; recording: Recording | null } | null = null

  async function handle(message: OffscreenMessage): Promise<RecorderReply> {
    switch (message.type) {
      case "bugberry:offscreen-open": {
        if (opened) return { ok: false, error: "Another recording is still running" }
        const stream = await openRecordingStream(message.capture, message.mic, deps.stream, message.micDeviceId)
        if (stream.kind === "cancelled") return { ok: false, error: "Cancelled", code: "cancelled" }
        opened = { draftId: message.draftId, stream, maxBytes: message.maxBytes, maxMs: message.maxMs, recording: null }
        return { ok: true, micOn: stream.micOn, micAvailable: stream.micAvailable }
      }
      case "bugberry:offscreen-begin": {
        if (!opened || opened.recording) return { ok: false, error: "Nothing to begin" }
        opened.recording = startRecording(opened.stream.stream, deps.recording, deps.noticeEnded, { maxBytes: opened.maxBytes, maxMs: opened.maxMs })
        return { ok: true, startedAt: opened.recording.startedAt }
      }
      case "bugberry:offscreen-pause":
        opened?.recording?.pause()
        return { ok: true }
      case "bugberry:offscreen-resume":
        opened?.recording?.resume()
        return { ok: true }
      case "bugberry:offscreen-mic":
        return { ok: true, micOn: opened?.stream.setMic(message.on) ?? false }
      case "bugberry:offscreen-restart":
        await opened?.recording?.cancel()
        if (opened) opened.recording = null
        return { ok: true }
      case "bugberry:offscreen-discard": {
        const dropping = opened
        opened = null
        await dropping?.recording?.cancel()
        dropping?.stream.release()
        return { ok: true }
      }
      case "bugberry:offscreen-stop": {
        const stopping = opened
        if (!stopping?.recording) return { ok: false, error: "No recording is running" }
        try {
          const { video, durationMs } = await stopping.recording.stop()
          const draft = await deps.store.get(stopping.draftId)
          if (draft?.captureType !== "video") return { ok: false, error: "Recording draft not found" }
          await deps.store.put({ ...draft, video, durationMs })
          return { ok: true, durationMs }
        } finally {
          stopping.stream.release()
          // Released only once the video is saved, so no new recording can start in between.
          opened = null
        }
      }
    }
  }

  return { handle }
}

/** Chrome's tab-capture constraints are not in the standard MediaTrackConstraints type. */
function tabConstraints(streamId: string): MediaStreamConstraints {
  const mandatory = { chromeMediaSource: "tab", chromeMediaSourceId: streamId }
  return { audio: { mandatory }, video: { mandatory } } as unknown as MediaStreamConstraints
}

/** The chosen microphone as `ideal`: one unplugged since it was chosen falls back to another instead of failing. */
export function micConstraints(deviceId: string | null): MediaStreamConstraints {
  return { audio: deviceId ? { deviceId: { ideal: deviceId } } : true }
}

/** MediaRecorder and media devices from the page's globals. */
export function createMediaDeps(): { recording: RecordingDeps; stream: StreamDeps } {
  const recording: RecordingDeps = {
    createRecorder: (stream, options, handlers) => {
      const recorder = new MediaRecorder(stream as unknown as MediaStream, options)
      recorder.ondataavailable = (event) => handlers.onData(event.data)
      recorder.onstop = () => handlers.onStop()
      recorder.onerror = () => handlers.onError()
      return recorder
    },
    isTypeSupported: (type) => MediaRecorder.isTypeSupported(type),
    fixDuration: withWebmDuration,
    now: Date.now,
    setTimer: (callback, ms) => {
      const id = setTimeout(callback, ms)
      return () => clearTimeout(id)
    },
  }

  const stream: StreamDeps = {
    tabStream: (streamId) => navigator.mediaDevices.getUserMedia(tabConstraints(streamId)),
    displayStream: (surface, systemAudio) =>
      navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: surface },
        audio: systemAudio,
        // Chrome-only options (other browsers ignore them): tick "Also share system audio", and let the
        // reporter pick the browser's own windows.
        systemAudio: systemAudio ? "include" : "exclude",
        selfBrowserSurface: "include",
      } as DisplayMediaStreamOptions),
    micStream: (deviceId) => navigator.mediaDevices.getUserMedia(micConstraints(deviceId)),
    playBack: (source) => {
      const context = new AudioContext()
      context.createMediaStreamSource(source).connect(context.destination)
      return () => void context.close().catch(() => {})
    },
    mixAudio: (streams) => {
      const context = new AudioContext()
      const destination = context.createMediaStreamDestination()
      for (const source of streams) context.createMediaStreamSource(source).connect(destination)
      const [track] = destination.stream.getAudioTracks()
      return { track: track as MediaStreamTrack, close: () => void context.close().catch(() => {}) }
    },
    compose: (tracks) => new MediaStream(tracks),
  }

  return { recording, stream }
}
