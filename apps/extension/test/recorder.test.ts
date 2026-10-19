import { describe, expect, test } from "bun:test"
import {
  AUDIO_BITS_PER_SECOND,
  MAX_RECORDING_MS,
  pickMimeType,
  type RecorderHandlers,
  type RecordingDeps,
  type RecordingEndReason,
  startRecording,
  VIDEO_BITS_PER_SECOND,
} from "../lib/recorder"

class FakeTrack {
  stopped = false
  private listeners: Array<() => void> = []
  stop() {
    this.stopped = true
  }
  addEventListener(_type: "ended", listener: () => void) {
    this.listeners.push(listener)
  }
  end() {
    for (const listener of this.listeners) listener()
  }
}

class FakeRecorder {
  state: "inactive" | "recording" | "paused" = "inactive"
  timeslice: number | undefined
  stopCalls = 0
  constructor(
    readonly options: { mimeType: string; videoBitsPerSecond: number; audioBitsPerSecond: number },
    readonly handlers: RecorderHandlers,
  ) {}
  start(timeslice?: number) {
    this.state = "recording"
    this.timeslice = timeslice
    this.handlers.onData(new Blob(["chunk-1"]))
    this.handlers.onData(new Blob([]))
  }
  pause() {
    if (this.state === "recording") this.state = "paused"
  }
  resume() {
    if (this.state === "paused") this.state = "recording"
  }
  stop() {
    this.stopCalls += 1
    this.state = "inactive"
    this.handlers.onData(new Blob(["chunk-2"]))
    this.handlers.onStop()
  }
}

function setup(overrides: Partial<RecordingDeps> = {}, maxBytes = 1_000_000_000) {
  const track = new FakeTrack()
  const recorders: FakeRecorder[] = []
  const ended: RecordingEndReason[] = []
  const timers: Array<{ callback: () => void; ms: number; cancelled: boolean }> = []
  let clock = 1000
  const deps: RecordingDeps = {
    createRecorder: (_stream, options, handlers) => {
      const recorder = new FakeRecorder(options, handlers)
      recorders.push(recorder)
      return recorder
    },
    isTypeSupported: (type) => type === "video/webm;codecs=vp9",
    fixDuration: async (video) => new Blob([await video.text(), "+duration"], { type: "video/webm" }),
    now: () => clock,
    setTimer: (callback, ms) => {
      const timer = { callback, ms, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    ...overrides,
  }
  const start = () => startRecording({ getTracks: () => [track] }, deps, (reason) => ended.push(reason), { maxBytes })
  return { track, recorders, ended, timers, deps, start, advance: (ms: number) => (clock += ms) }
}

describe("pickMimeType", () => {
  test("prefers VP9, then VP8, then plain WebM", () => {
    expect(pickMimeType(() => true)).toBe("video/webm;codecs=vp9")
    expect(pickMimeType((type) => type !== "video/webm;codecs=vp9")).toBe("video/webm;codecs=vp8")
    expect(pickMimeType(() => false)).toBe("video/webm")
  })
})

describe("startRecording", () => {
  test("records at the capped bitrate and returns the whole video with its duration written in", async () => {
    const s = setup()
    const recording = s.start()
    expect(recording.startedAt).toBe(1000)
    expect(s.recorders[0]?.options).toEqual({
      mimeType: "video/webm;codecs=vp9",
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    })
    expect(VIDEO_BITS_PER_SECOND).toBe(1_500_000)
    expect(AUDIO_BITS_PER_SECOND).toBe(128_000)
    expect(s.recorders[0]?.timeslice).toBe(1000)
    s.advance(12_345)
    const result = await recording.stop()
    expect(result.durationMs).toBe(12_345)
    expect(await result.video.text()).toBe("chunk-1chunk-2+duration")
    expect(result.video.type).toBe("video/webm")
    expect(s.track.stopped).toBe(true)
    expect(s.timers[0]?.cancelled).toBe(true)
  })

  test("stopping twice gives the same result and stops the recorder once", async () => {
    const s = setup()
    const recording = s.start()
    const [first, second] = await Promise.all([recording.stop(), recording.stop()])
    expect(first).toBe(second)
    expect(s.recorders[0]?.stopCalls).toBe(1)
  })

  test("the time limit ends the recording once, even if the tab closes too", () => {
    const s = setup()
    s.start()
    expect(s.timers[0]?.ms).toBe(MAX_RECORDING_MS)
    expect(MAX_RECORDING_MS).toBe(20 * 60 * 1000)
    s.timers[0]?.callback()
    s.track.end()
    s.timers[0]?.callback()
    expect(s.ended).toEqual(["max-duration"])
  })

  test("the recording ends once its video reaches the byte budget", () => {
    const s = setup({}, 3000)
    s.start()
    const recorder = s.recorders[0] as FakeRecorder
    recorder.handlers.onData(new Blob(["x".repeat(1000)]))
    recorder.handlers.onData(new Blob(["x".repeat(1000)]))
    expect(s.ended).toEqual([])
    recorder.handlers.onData(new Blob(["x".repeat(1500)]))
    recorder.handlers.onData(new Blob(["x".repeat(1500)]))
    expect(s.ended).toEqual(["size-limit"])
  })

  test("a closed tab ends the recording", () => {
    const s = setup()
    s.start()
    s.track.end()
    expect(s.ended).toEqual(["source-ended"])
  })

  test("a recorder error ends the recording", () => {
    const s = setup()
    s.start()
    s.recorders[0]?.handlers.onError()
    expect(s.ended).toEqual(["error"])
  })

  test("when the duration fix fails, the raw recording is kept", async () => {
    const s = setup({
      fixDuration: async () => {
        throw new Error("bad ebml")
      },
    })
    const result = await s.start().stop()
    expect(await result.video.text()).toBe("chunk-1chunk-2")
  })
})

describe("pause, resume and cancel", () => {
  test("paused time is not part of the video", async () => {
    const s = setup()
    const recording = s.start()
    s.advance(10_000)
    recording.pause()
    s.advance(60_000)
    recording.resume()
    s.advance(5_000)
    expect((await recording.stop()).durationMs).toBe(15_000)
  })

  test("the time limit counts recording time only", () => {
    const s = setup()
    const recording = s.start()
    s.advance(10_000)
    recording.pause()
    expect(s.timers[0]?.cancelled).toBe(true)
    s.advance(60_000)
    recording.resume()
    expect(s.timers[1]?.ms).toBe(MAX_RECORDING_MS - 10_000)
    expect(s.timers[1]?.cancelled).toBe(false)
  })

  test("pausing twice, or resuming a running recording, changes nothing", () => {
    const s = setup()
    const recording = s.start()
    recording.resume()
    expect(s.timers).toHaveLength(1)
    recording.pause()
    recording.pause()
    expect(s.recorders[0]?.state).toBe("paused")
    recording.resume()
    recording.resume()
    expect(s.timers).toHaveLength(2)
    expect(s.recorders[0]?.state).toBe("recording")
  })

  test("cancel drops the take but leaves the stream running for the next one", async () => {
    const s = setup()
    const recording = s.start()
    await recording.cancel()
    expect(s.recorders[0]?.state).toBe("inactive")
    expect(s.track.stopped).toBe(false)
    s.track.end()
    s.timers[0]?.callback()
    expect(s.ended).toEqual([])
  })
})
