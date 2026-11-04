import { describe, expect, mock, test } from "bun:test"
import { playableVideo, playAt } from "../src/features/reports/detail/video-context"

describe("playAt", () => {
  test("seeks the video, plays it and brings it into view", () => {
    const video = { currentTime: 0, play: mock(() => Promise.resolve()), scrollIntoView: mock() }
    playAt(playableVideo(video as unknown as HTMLVideoElement), 52_000, 116_000)
    expect(video.currentTime).toBe(52)
    expect(video.play).toHaveBeenCalled()
    expect(video.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" })
  })

  test("a time past the end stops at the end; no video does nothing", () => {
    const video = { currentTime: 0, play: mock(() => Promise.resolve()), scrollIntoView: mock() }
    playAt(playableVideo(video as unknown as HTMLVideoElement), 500_000, 116_000)
    expect(video.currentTime).toBe(116)
    expect(() => playAt(playableVideo(null), 1000, 116_000)).not.toThrow()
  })

  test("drives any player the same way, a replay included", () => {
    const player = { seek: mock(), play: mock(), element: { scrollIntoView: mock() } as unknown as Element }
    playAt(player, 35_000, 40_000)
    expect(player.seek).toHaveBeenCalledWith(35_000)
    expect(player.play).toHaveBeenCalled()
  })
})
