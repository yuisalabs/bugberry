import { afterEach, describe, expect, mock, test } from "bun:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ReplayStrip } from "../../entrypoints/review/ReplayStrip"
import { replayStripFrames } from "../../lib/review/replay-strip-frames"

afterEach(cleanup)

const FRAMES = [
  { atMs: 0, jpeg: "A" },
  { atMs: 5_000, jpeg: "B" },
  { atMs: 30_000, jpeg: "C" },
]

function strip(overrides: { positionMs?: number } = {}) {
  const props = { durationMs: 42_000, frames: FRAMES, positionMs: 0, playing: false, onSeek: mock(), onPlay: mock(), ...overrides }
  return { props, ...render(<ReplayStrip {...props} />) }
}

describe("the replay's strip", () => {
  test("a click on the frames seeks the player there", () => {
    const { props } = strip()
    const track = screen.getByRole("group", { name: "Replay position" }).querySelector("[data-track]") as HTMLElement
    track.getBoundingClientRect = () => ({ left: 0, width: 420, top: 0, height: 48, right: 420, bottom: 48, x: 0, y: 0, toJSON() {} })
    fireEvent.pointerDown(track, { clientX: 105, pointerId: 1, pointerType: "mouse", button: 0 })
    fireEvent.pointerUp(track, { clientX: 105, pointerId: 1, pointerType: "mouse", button: 0 })
    expect(props.onSeek.mock.calls.at(-1)?.[0]).toBe(10_500)
  })

  test("the playhead stands where the player is, and moves anywhere in the replay", () => {
    const { props } = strip({ positionMs: 21_000 })
    const playhead = screen.getByLabelText("Playhead") as HTMLInputElement
    expect(playhead.value).toBe("21000")
    fireEvent.keyDown(playhead, { key: "End" })
    expect(props.onSeek.mock.calls.at(-1)?.[0]).toBe(42_000)
  })

  test("the play button plays, and reads Pause while the replay plays", () => {
    const { props, rerender } = strip()
    fireEvent.click(screen.getByRole("button", { name: "Play" }))
    expect(props.onPlay).toHaveBeenCalledTimes(1)
    rerender(<ReplayStrip {...props} playing />)
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy()
  })

  test("the line under it gives the whole replay, and there is nothing to trim", () => {
    strip()
    expect(screen.getByText("0:00 – 0:42 · 42 s")).toBeTruthy()
    expect(screen.queryByLabelText("Trim start")).toBeNull()
    expect(screen.queryByLabelText("Trim end")).toBeNull()
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull()
  })

  test("its frames fill the row", () => {
    const { container } = strip()
    expect(container.querySelectorAll("img")).toHaveLength(10)
  })
})

describe("replayStripFrames", () => {
  test("each slot shows the screenshot taken at or before its middle", () => {
    const frames = replayStripFrames(FRAMES, 40_000, 4)
    // Slot middles: 5 s, 15 s, 25 s, 35 s.
    expect(frames).toEqual(["data:image/jpeg;base64,B", "data:image/jpeg;base64,B", "data:image/jpeg;base64,B", "data:image/jpeg;base64,C"])
  })

  test("before the first screenshot a slot shows the first; with none there are none", () => {
    expect(replayStripFrames([{ atMs: 8_000, jpeg: "X" }], 40_000, 2)).toEqual(["data:image/jpeg;base64,X", "data:image/jpeg;base64,X"])
    expect(replayStripFrames([], 40_000, 10)).toEqual([])
  })
})
