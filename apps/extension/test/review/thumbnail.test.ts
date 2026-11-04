import { describe, expect, test } from "bun:test"
import { MAX_THUMBNAIL_BYTES } from "@bugberry/shared"
import { frameSeconds, lastFrameJpeg, makeThumbnail, type ThumbnailDeps, thumbnailSize } from "../../lib/review/thumbnail"

describe("thumbnailSize", () => {
  test("scales wide sources down to 640 px, keeping the ratio", () => {
    expect(thumbnailSize({ width: 1920, height: 1080 })).toEqual({ width: 640, height: 360 })
  })

  test("never scales a small source up", () => {
    expect(thumbnailSize({ width: 300, height: 200 })).toEqual({ width: 300, height: 200 })
  })

  test("keeps at least one pixel of height", () => {
    expect(thumbnailSize({ width: 10_000, height: 1 })).toEqual({ width: 640, height: 1 })
  })
})

describe("frameSeconds", () => {
  test("takes the frame at one second, or the first frame for short or unknown videos", () => {
    expect(frameSeconds(12_000)).toBe(1)
    expect(frameSeconds(1000)).toBe(0)
    expect(frameSeconds(400)).toBe(0)
    expect(frameSeconds(null)).toBe(0)
  })
})

function fakeDeps(overrides: Partial<ThumbnailDeps> = {}) {
  const calls: string[] = []
  const deps: ThumbnailDeps = {
    decodeImage: async () => {
      calls.push("decode")
      return { width: 1280, height: 800, close: () => void calls.push("close") }
    },
    videoFrame: async (_blob, at) => {
      calls.push(`frame:${at}`)
      return { width: 1920, height: 1080 }
    },
    encodeJpeg: async (_source, size, quality) => {
      calls.push(`encode:${size.width}x${size.height}@${quality}`)
      return new Blob(["jpg"], { type: "image/jpeg" })
    },
    ...overrides,
  }
  return { deps, calls }
}

describe("makeThumbnail", () => {
  test("encodes a screenshot at 640 px and releases the decoded image", async () => {
    const { deps, calls } = fakeDeps()
    const thumbnail = await makeThumbnail(new Blob(["png"]), { captureType: "screenshot", durationMs: null }, deps)
    expect(thumbnail?.type).toBe("image/jpeg")
    expect(calls).toEqual(["decode", "encode:640x400@0.7", "close"])
  })

  test("a replay's preview is its last frame; without one there is none", async () => {
    const { deps, calls } = fakeDeps()
    const lastFrame = new Blob(["jpg"], { type: "image/jpeg" })
    expect(await makeThumbnail(new Blob(["gz"]), { captureType: "replay", durationMs: 5_000, lastFrame }, deps)).not.toBeNull()
    expect(calls).toEqual(["decode", "encode:640x400@0.7", "close"])
    const none = fakeDeps()
    expect(await makeThumbnail(new Blob(["gz"]), { captureType: "replay", durationMs: 5_000, lastFrame: null }, none.deps)).toBeNull()
    expect(none.calls).toEqual([])
  })

  test("takes a video frame at one second", async () => {
    const { deps, calls } = fakeDeps()
    await makeThumbnail(new Blob(["webm"]), { captureType: "video", durationMs: 5000 }, deps)
    expect(calls).toEqual(["frame:1", "encode:640x360@0.7"])
  })

  test("returns null instead of throwing when the frame cannot be read", async () => {
    const { deps } = fakeDeps({
      videoFrame: async () => {
        throw new Error("seek timeout")
      },
    })
    expect(await makeThumbnail(new Blob(["webm"]), { captureType: "video", durationMs: 5000 }, deps)).toBeNull()
  })

  test("drops a thumbnail larger than the server accepts", async () => {
    const { deps } = fakeDeps({ encodeJpeg: async () => new Blob([new Uint8Array(MAX_THUMBNAIL_BYTES + 1)]) })
    expect(await makeThumbnail(new Blob(["png"]), { captureType: "screenshot", durationMs: null }, deps)).toBeNull()
  })
})

describe("lastFrameJpeg", () => {
  test("the last frame's base64 as a JPEG blob; none without frames", async () => {
    const blob = lastFrameJpeg([{ atMs: 0, jpeg: btoa("first") }, { atMs: 5_000, jpeg: btoa("last") }])
    expect(blob?.type).toBe("image/jpeg")
    expect(await blob?.text()).toBe("last")
    expect(lastFrameJpeg([])).toBeNull()
    expect(lastFrameJpeg(undefined)).toBeNull()
  })
})
