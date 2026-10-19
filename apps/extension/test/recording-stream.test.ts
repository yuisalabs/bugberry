import { describe, expect, mock, test } from "bun:test"
import { openRecordingStream, type StreamDeps } from "../lib/recording-stream"

class FakeTrack {
  stopped = false
  enabled = true
  constructor(
    readonly kind: "audio" | "video",
    readonly id: string,
  ) {}
  stop() {
    this.stopped = true
  }
}

function fakeStream(...tracks: FakeTrack[]) {
  return {
    tracks,
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
  } as unknown as MediaStream & { tracks: FakeTrack[] }
}

function setup(overrides: Partial<StreamDeps> = {}) {
  const tabVideo = new FakeTrack("video", "tab-video")
  const tabAudio = new FakeTrack("audio", "tab-audio")
  const screenVideo = new FakeTrack("video", "screen-video")
  const systemAudio = new FakeTrack("audio", "system-audio")
  const micAudio = new FakeTrack("audio", "mic")
  const mixed = new FakeTrack("audio", "mixed")
  const closeMix = mock()
  const stopPlayback = mock()
  const deps = {
    tabStream: mock(async () => fakeStream(tabVideo, tabAudio)),
    displayStream: mock(async (_surface: "monitor" | "window", withAudio: boolean) =>
      withAudio ? fakeStream(screenVideo, systemAudio) : fakeStream(screenVideo),
    ),
    micStream: mock(async () => fakeStream(micAudio)),
    playBack: mock(() => stopPlayback),
    mixAudio: mock(() => ({ track: mixed as unknown as MediaStreamTrack, close: closeMix })),
    compose: mock((tracks: MediaStreamTrack[]) => fakeStream(...(tracks as unknown as FakeTrack[]))),
    ...overrides,
  }
  return { deps, tabVideo, tabAudio, screenVideo, systemAudio, micAudio, mixed, closeMix, stopPlayback }
}

const idsOf = (stream: MediaStream) => stream.getTracks().map((track) => track.id)

describe("openRecordingStream", () => {
  test("a tab keeps its sound, mixed with the microphone, and the reporter still hears the tab", async () => {
    const s = setup()
    const opened = await openRecordingStream({ kind: "tab", streamId: "s1" }, true, s.deps)
    if (opened.kind !== "ok") throw new Error("expected a stream")
    expect(s.deps.tabStream).toHaveBeenCalledWith("s1")
    expect(s.deps.playBack).toHaveBeenCalledTimes(1)
    const mixedFrom = (s.deps.mixAudio as ReturnType<typeof mock>).mock.calls[0]?.[0] as Array<MediaStream & { tracks: FakeTrack[] }>
    expect(mixedFrom.map((stream) => stream.tracks.map((track) => track.id))).toEqual([["tab-video", "tab-audio"], ["mic"]])
    expect(idsOf(opened.stream)).toEqual(["tab-video", "mixed"])
    expect(opened.micOn).toBe(true)
  })

  test("a screen with system audio and the microphone", async () => {
    const s = setup()
    const opened = await openRecordingStream({ kind: "display", surface: "monitor", systemAudio: true }, true, s.deps)
    expect(s.deps.displayStream).toHaveBeenCalledWith("monitor", true)
    expect(opened).toMatchObject({ kind: "ok", micOn: true })
    expect(s.deps.playBack).not.toHaveBeenCalled()
  })

  test("a cancelled share picker is not an error", async () => {
    const s = setup({
      displayStream: mock(async () => {
        throw new DOMException("Permission denied", "NotAllowedError")
      }),
    })
    expect(await openRecordingStream({ kind: "display", surface: "window", systemAudio: false }, true, s.deps)).toEqual({
      kind: "cancelled",
    })
    expect(s.deps.micStream).not.toHaveBeenCalled()
  })

  test("a blocked or busy microphone records without it", async () => {
    const s = setup({
      micStream: mock(async () => {
        throw new DOMException("Permission denied", "NotAllowedError")
      }),
    })
    const opened = await openRecordingStream({ kind: "tab", streamId: "s1" }, true, s.deps)
    expect(opened).toMatchObject({ kind: "ok", micOn: false })
  })

  test("with no sound at all the stream is the video alone", async () => {
    const s = setup({
      micStream: mock(async () => {
        throw new DOMException("Requested device not found", "NotFoundError")
      }),
    })
    const opened = await openRecordingStream({ kind: "display", surface: "window", systemAudio: false }, false, s.deps)
    if (opened.kind !== "ok") throw new Error("expected a stream")
    expect(s.deps.mixAudio).not.toHaveBeenCalled()
    expect(idsOf(opened.stream)).toEqual(["screen-video"])
    expect(opened).toMatchObject({ micOn: false, micAvailable: false })
    expect(opened.setMic(true)).toBe(false)
  })

  test("a microphone that may be used is opened muted, so it can be turned on mid-recording", async () => {
    const s = setup()
    const opened = await openRecordingStream({ kind: "tab", streamId: "s1" }, false, s.deps)
    if (opened.kind !== "ok") throw new Error("expected a stream")
    expect(s.deps.micStream).toHaveBeenCalledTimes(1)
    expect(opened).toMatchObject({ micOn: false, micAvailable: true })
    expect(s.micAudio.enabled).toBe(false)
    expect(opened.setMic(true)).toBe(true)
    expect(s.micAudio.enabled).toBe(true)
    expect(opened.setMic(false)).toBe(false)
    expect(s.micAudio.enabled).toBe(false)
  })

  test("release stops every source and the mixer", async () => {
    const s = setup()
    const opened = await openRecordingStream({ kind: "tab", streamId: "s1" }, true, s.deps)
    if (opened.kind !== "ok") throw new Error("expected a stream")
    opened.release()
    expect([s.tabVideo, s.tabAudio, s.micAudio].every((track) => track.stopped)).toBe(true)
    expect(s.closeMix).toHaveBeenCalledTimes(1)
    expect(s.stopPlayback).toHaveBeenCalledTimes(1)
  })
})
