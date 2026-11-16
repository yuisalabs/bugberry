import { describe, expect, mock, test } from "bun:test"
import { CaptureDenied, type CaptureDeps, captureSupport, EmptyRecording, startRecording, takeScreenshot } from "../src/features/requests/screen-capture"

class FakeTrack {
  kind: "video" | "audio"
  readyState: "live" | "ended" = "live"
  private listeners: Array<() => void> = []
  constructor(kind: "video" | "audio") {
    this.kind = kind
  }
  stop() {
    this.readyState = "ended"
  }
  addEventListener(_type: "ended", run: () => void) {
    this.listeners.push(run)
  }
  /** What the browser does when the person presses its own "Stop sharing". */
  endFromBrowser() {
    this.readyState = "ended"
    for (const run of this.listeners) run()
  }
}

class FakeStream {
  tracks: FakeTrack[]
  constructor(tracks: FakeTrack[]) {
    this.tracks = tracks
  }
  getTracks() {
    return this.tracks
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video")
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio")
  }
  addTrack(track: FakeTrack) {
    this.tracks.push(track)
  }
}

class FakeRecorder {
  state: "inactive" | "recording" = "inactive"
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start = mock(() => {
    this.state = "recording"
  })
  stop = mock(() => {
    if (this.state === "inactive") return
    this.state = "inactive"
    this.emit(new Blob([new Uint8Array(2)]))
    this.onstop?.()
  })
  emit(data: Blob) {
    this.ondataavailable?.({ data })
  }
}

function setup(opts: { micRefused?: boolean; pickerCancelled?: boolean } = {}) {
  const video = new FakeTrack("video")
  const display = new FakeStream([video])
  const mic = new FakeTrack("audio")
  const recorder = new FakeRecorder()
  let clock = 1000
  const timers: Array<{ run: () => void; ms: number; cleared: boolean }> = []
  const deps = {
    getDisplayMedia: mock(async () => {
      if (opts.pickerCancelled) throw new DOMException("Permission denied", "NotAllowedError")
      return display as unknown as MediaStream
    }),
    getUserMedia: mock(async () => {
      if (opts.micRefused) throw new DOMException("Permission denied", "NotAllowedError")
      return new FakeStream([mic]) as unknown as MediaStream
    }),
    createRecorder: mock((_stream: MediaStream, _options: MediaRecorderOptions) => recorder as unknown as MediaRecorder),
    now: () => clock,
    setTimeout: (run: () => void, ms: number) => {
      const timer = { run, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimeout: (id: unknown) => {
      ;(id as { cleared: boolean }).cleared = true
    },
  } satisfies CaptureDeps
  return {
    deps,
    video,
    display,
    mic,
    recorder,
    timers,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const limits = { mic: false, maxMs: 300_000, maxBytes: 1000 }

describe("what the browser can do", () => {
  test("no getDisplayMedia: none; no WebM: screenshot; both: video", () => {
    expect(captureSupport({})).toBe("none")
    const mediaDevices = { getDisplayMedia: async () => ({}) as MediaStream }
    expect(captureSupport({ mediaDevices, isTypeSupported: () => false })).toBe("screenshot")
    expect(captureSupport({ mediaDevices })).toBe("screenshot")
    expect(captureSupport({ mediaDevices, isTypeSupported: (type) => type.startsWith("video/webm") })).toBe("video")
  })
})

describe("recording", () => {
  test("the page's Stop button ends the recording and stops every track", async () => {
    const s = setup()
    const handle = await startRecording(s.deps, { ...limits, mic: true })
    s.recorder.emit(new Blob([new Uint8Array(10)]))
    s.advance(4000)
    handle.stop()
    const done = await handle.done
    expect(done.stoppedBy).toBe("button")
    expect(done.durationMs).toBe(4000)
    expect(done.video.size).toBe(12)
    expect(s.video.readyState).toBe("ended")
    expect(s.mic.readyState).toBe("ended")
    expect(s.timers.every((timer) => timer.cleared)).toBe(true)
  })

  test("the browser's Stop sharing ends it the same way and keeps what was recorded", async () => {
    const s = setup()
    const handle = await startRecording(s.deps, limits)
    s.recorder.emit(new Blob([new Uint8Array(10)]))
    s.video.endFromBrowser()
    expect((await handle.done).stoppedBy).toBe("browser")
    expect((await handle.done).video.size).toBeGreaterThan(0)
  })

  test("it stops by itself at maxMs", async () => {
    const s = setup()
    const handle = await startRecording(s.deps, { ...limits, maxMs: 120_000 })
    const timer = s.timers.find((candidate) => candidate.ms === 120_000)
    expect(timer).toBeTruthy()
    s.advance(120_030)
    timer?.run()
    const done = await handle.done
    expect(done.stoppedBy).toBe("limit")
    // A timer never fires early, so the clock runs past the limit; the recording is the limit long.
    expect(done.durationMs).toBe(120_000)
  })

  test("a recorder that stops by itself keeps the time recorded and stops the tracks", async () => {
    const s = setup()
    const handle = await startRecording(s.deps, limits)
    s.recorder.emit(new Blob([new Uint8Array(10)]))
    s.advance(3000)
    s.recorder.state = "inactive"
    s.recorder.onstop?.()
    const done = await handle.done
    expect(done.durationMs).toBe(3000)
    expect(done.stoppedBy).toBe("browser")
    expect(s.video.readyState).toBe("ended")
  })

  test("a recording stopped before its first chunk is refused as empty", async () => {
    const s = setup()
    s.recorder.stop.mockImplementation(() => {
      s.recorder.state = "inactive"
      s.recorder.onstop?.()
    })
    const handle = await startRecording(s.deps, limits)
    handle.stop()
    await expect(handle.done).rejects.toBeInstanceOf(EmptyRecording)
  })

  test("a recorder that won't start stops the shared screen", async () => {
    const s = setup()
    s.deps.createRecorder.mockImplementationOnce(() => {
      throw new DOMException("codec", "NotSupportedError")
    })
    await expect(startRecording(s.deps, { ...limits, mic: true })).rejects.toThrow()
    expect(s.video.readyState).toBe("ended")
    expect(s.mic.readyState).toBe("ended")
  })

  test("it stops by itself when the chunks near maxBytes", async () => {
    const s = setup()
    const handle = await startRecording(s.deps, limits)
    s.recorder.emit(new Blob([new Uint8Array(500)]))
    expect(s.recorder.state).toBe("recording")
    s.recorder.emit(new Blob([new Uint8Array(460)]))
    const done = await handle.done
    expect(done.stoppedBy).toBe("limit")
    expect(done.video.size).toBeLessThanOrEqual(1000)
  })

  test("the recorder is asked for 2 Mbit/s WebM", async () => {
    const s = setup()
    await startRecording(s.deps, limits)
    expect(s.deps.createRecorder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ videoBitsPerSecond: 2_000_000 }))
    expect(s.deps.createRecorder.mock.calls[0]?.[1]).toMatchObject({ mimeType: expect.stringContaining("video/webm") })
  })

  test("a cancelled picker rejects with CaptureDenied and leaves no track running", async () => {
    const s = setup({ pickerCancelled: true })
    await expect(startRecording(s.deps, { ...limits, mic: true })).rejects.toBeInstanceOf(CaptureDenied)
    expect(s.deps.getUserMedia).not.toHaveBeenCalled()
    expect(s.deps.createRecorder).not.toHaveBeenCalled()
  })

  test("a refused microphone records without sound instead of failing", async () => {
    const s = setup({ micRefused: true })
    const handle = await startRecording(s.deps, { ...limits, mic: true })
    expect(s.display.getAudioTracks()).toEqual([])
    handle.stop()
    expect((await handle.done).stoppedBy).toBe("button")
  })
})

describe("a screenshot", () => {
  test("a screenshot stops the capture as soon as the frame is taken", async () => {
    const s = setup()
    const png = new Blob([new Uint8Array(3)], { type: "image/png" })
    const toPng = mock(async (track: MediaStreamTrack) => {
      expect((track as unknown as FakeTrack).readyState).toBe("live")
      return png
    })
    expect(await takeScreenshot(s.deps, toPng)).toBe(png)
    expect(s.video.readyState).toBe("ended")
  })

  test("a cancelled picker rejects with CaptureDenied", async () => {
    const s = setup({ pickerCancelled: true })
    await expect(takeScreenshot(s.deps, async () => new Blob())).rejects.toBeInstanceOf(CaptureDenied)
  })
})
