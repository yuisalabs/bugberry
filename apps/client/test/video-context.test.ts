import { describe, expect, mock, test } from "bun:test"
import { playAt } from "../src/components/report/video-context"

describe("playAt", () => {
  test("seeks the video, plays it and brings it into view", () => {
    const video = { currentTime: 0, play: mock(() => Promise.resolve()), scrollIntoView: mock() }
    playAt(video as unknown as HTMLVideoElement, 52_000, 116_000)
    expect(video.currentTime).toBe(52)
    expect(video.play).toHaveBeenCalled()
    expect(video.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" })
  })

  test("a time past the end stops at the end; no video does nothing", () => {
    const video = { currentTime: 0, play: mock(() => Promise.resolve()), scrollIntoView: mock() }
    playAt(video as unknown as HTMLVideoElement, 500_000, 116_000)
    expect(video.currentTime).toBe(116)
    expect(() => playAt(null, 1000, 116_000)).not.toThrow()
  })
})
