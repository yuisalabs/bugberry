import { browser } from "wxt/browser"
import { createIndexedDbDraftStore } from "../../lib/draft-store"
import { isOffscreenMessage, type OffscreenMessage, type RecordingEndedNotice } from "../../lib/messages"
import { type Recording, type RecordingDeps, type RecordingEndReason, startRecording } from "../../lib/recorder"
import { type OpenedStream, openRecordingStream, type StreamDeps } from "../../lib/recording-stream"
import { withWebmDuration } from "../../lib/webm-duration"

/**
 * Offscreen document: the only extension context that may call getUserMedia for a tab stream in MV3.
 * The finished video goes straight into the draft in IndexedDB; runtime messages cannot carry Blobs.
 */
const store = createIndexedDbDraftStore()

const deps: RecordingDeps = {
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

/** Chrome's tab-capture constraints are not in the standard MediaTrackConstraints type. */
function tabConstraints(streamId: string): MediaStreamConstraints {
  const mandatory = { chromeMediaSource: "tab", chromeMediaSourceId: streamId }
  return { audio: { mandatory }, video: { mandatory } } as unknown as MediaStreamConstraints
}

const streamDeps: StreamDeps = {
  tabStream: (streamId) => navigator.mediaDevices.getUserMedia(tabConstraints(streamId)),
  displayStream: (surface, systemAudio) =>
    navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: surface },
      audio: systemAudio,
      // Chrome-only options: tick "Also share system audio", and let the reporter pick the browser's own windows.
      systemAudio: systemAudio ? "include" : "exclude",
      selfBrowserSurface: "include",
    } as DisplayMediaStreamOptions),
  micStream: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  playBack: (stream) => {
    const context = new AudioContext()
    context.createMediaStreamSource(stream).connect(context.destination)
    return () => void context.close().catch(() => {})
  },
  mixAudio: (streams) => {
    const context = new AudioContext()
    const destination = context.createMediaStreamDestination()
    for (const stream of streams) context.createMediaStreamSource(stream).connect(destination)
    const [track] = destination.stream.getAudioTracks()
    return { track: track as MediaStreamTrack, close: () => void context.close().catch(() => {}) }
  },
  compose: (tracks) => new MediaStream(tracks),
}

type Reply =
  | { ok: true; micOn?: boolean; micAvailable?: boolean; startedAt?: number; durationMs?: number }
  | { ok: false; error: string; code?: "cancelled" }

/** The stream from `open`, and the take running on it since `begin` (null before it, and after a Restart). */
let opened: { draftId: string; stream: OpenedRecording; maxBytes: number; recording: Recording | null } | null = null
type OpenedRecording = Extract<OpenedStream, { kind: "ok" }>

const noticeEnded = (reason: RecordingEndReason) => {
  const notice: RecordingEndedNotice = { type: "bugberry:recording-ended", reason }
  // Nobody may be listening (the background restarted); that must not become an unhandled rejection.
  browser.runtime.sendMessage(notice).catch(() => {})
}

async function handle(message: OffscreenMessage): Promise<Reply> {
  switch (message.type) {
    case "bugberry:offscreen-open": {
      if (opened) return { ok: false, error: "Another recording is still running" }
      const stream = await openRecordingStream(message.capture, message.mic, streamDeps)
      if (stream.kind === "cancelled") return { ok: false, error: "Cancelled", code: "cancelled" }
      opened = { draftId: message.draftId, stream, maxBytes: message.maxBytes, recording: null }
      return { ok: true, micOn: stream.micOn, micAvailable: stream.micAvailable }
    }
    case "bugberry:offscreen-begin": {
      if (!opened || opened.recording) return { ok: false, error: "Nothing to begin" }
      opened.recording = startRecording(opened.stream.stream, deps, noticeEnded, { maxBytes: opened.maxBytes })
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
        const draft = await store.get(stopping.draftId)
        if (draft?.captureType !== "video") return { ok: false, error: "Recording draft not found" }
        await store.put({ ...draft, video, durationMs })
        return { ok: true, durationMs }
      } finally {
        stopping.stream.release()
        // Released only once the video is saved, so no new recording can start in between.
        opened = null
      }
    }
  }
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isOffscreenMessage(message)) return undefined
  handle(message).then(sendResponse, (error: unknown) =>
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
  return true // keeps the channel open for the async response
})
