import { describe, expect, mock, test } from "bun:test"
import type { OffscreenMessage } from "../lib/messages"
import type { RecordingDeps } from "../lib/recorder"
import { createRecorderHandler } from "../lib/recorder-handler"
import type { StreamDeps } from "../lib/recording-stream"
import type { ReportDraft } from "../lib/types"

class FakeTrack {
  stopped = false
  enabled = true
  constructor(readonly kind: "audio" | "video") {}
  stop() {
    this.stopped = true
  }
  addEventListener() {}
}

function fakeStream(...tracks: FakeTrack[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
  } as unknown as MediaStream
}

function setup(stream: Partial<StreamDeps> = {}) {
  const video = new FakeTrack("video")
  const drafts = new Map<string, ReportDraft>([["d1", { id: "d1", captureType: "video", video: null, durationMs: null } as unknown as ReportDraft]])
  const recording: RecordingDeps = {
    createRecorder: (_stream, _options, handlers) => {
      const recorder = {
        state: "inactive",
        start: () => void (recorder.state = "recording"),
        pause: () => void (recorder.state = "paused"),
        resume: () => void (recorder.state = "recording"),
        stop: () => {
          recorder.state = "inactive"
          handlers.onData(new Blob(["frames"], { type: "video/webm" }))
          handlers.onStop()
        },
      }
      return recorder
    },
    isTypeSupported: () => true,
    fixDuration: async (blob) => blob,
    now: () => 1000,
    setTimer: () => () => {},
  }
  const streamDeps: StreamDeps = {
    tabStream: mock(async () => fakeStream(video)),
    displayStream: mock(async () => fakeStream(video)),
    micStream: mock(async () => {
      throw new Error("no microphone")
    }),
    playBack: () => () => {},
    mixAudio: () => ({ track: new FakeTrack("audio") as unknown as MediaStreamTrack, close: () => {} }),
    compose: (tracks) => fakeStream(...(tracks as unknown as FakeTrack[])),
    ...stream,
  }
  const handler = createRecorderHandler({
    store: { get: async (id) => drafts.get(id) ?? null, put: async (draft) => void drafts.set(draft.id, draft) },
    recording,
    stream: streamDeps,
    noticeEnded: () => {},
  })
  return { handler, drafts, video }
}

const open: OffscreenMessage = {
  type: "bugberry:offscreen-open",
  draftId: "d1",
  capture: { kind: "display", surface: "window", systemAudio: false },
  mic: false,
  micDeviceId: null,
  maxBytes: 1_000_000,
}

describe("createRecorderHandler", () => {
  test("open then begin then stop saves the video into the draft", async () => {
    const { handler, drafts } = setup()
    expect(await handler.handle(open)).toMatchObject({ ok: true })
    expect(await handler.handle({ type: "bugberry:offscreen-begin" })).toMatchObject({ ok: true, startedAt: 1000 })
    const stopped = await handler.handle({ type: "bugberry:offscreen-stop" })
    expect(stopped).toEqual({ ok: true, durationMs: 0 })
    const draft = drafts.get("d1") as unknown as { video: Blob | null; durationMs: number | null }
    expect(draft.video).toBeInstanceOf(Blob)
    expect(draft.durationMs).toBe(0)
  })

  test("a second open while one is running is refused", async () => {
    const { handler } = setup()
    await handler.handle(open)
    expect(await handler.handle(open)).toEqual({ ok: false, error: "Another recording is still running" })
  })

  test("a cancelled picker answers cancelled", async () => {
    const { handler } = setup({
      displayStream: mock(async () => {
        throw new DOMException("", "NotAllowedError")
      }),
    })
    expect(await handler.handle(open)).toEqual({ ok: false, error: "Cancelled", code: "cancelled" })
  })

  test("discard releases the stream and allows a new open", async () => {
    const { handler, video } = setup()
    await handler.handle(open)
    expect(await handler.handle({ type: "bugberry:offscreen-discard" })).toEqual({ ok: true })
    expect(video.stopped).toBe(true)
    expect(await handler.handle(open)).toMatchObject({ ok: true })
  })
})
