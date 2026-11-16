import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { frameToPng, videoThumbnail } from "../src/features/requests/frames"

const restore: Array<() => void> = []

function stub<T extends object, K extends keyof T>(target: T, key: K, value: T[K]) {
  const had = Object.getOwnPropertyDescriptor(target, key)
  Object.defineProperty(target, key, { value, configurable: true, writable: true })
  restore.push(() => (had ? Object.defineProperty(target, key, had) : delete (target as Record<PropertyKey, unknown>)[key]))
}

beforeEach(() => {
  const media = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "srcObject")
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", { configurable: true, get: () => null, set: () => undefined })
  restore.push(() => media && Object.defineProperty(HTMLMediaElement.prototype, "srcObject", media))
  stub(globalThis as Record<string, unknown>, "MediaStream", class {
    constructor(public tracks: unknown[]) {}
  })
  stub(HTMLMediaElement.prototype, "play", async () => undefined)
  stub(HTMLCanvasElement.prototype, "toBlob", function (this: HTMLCanvasElement, done: BlobCallback) {
    done(new Blob([new Uint8Array(3)], { type: "image/png" }))
  })
})

afterEach(() => {
  while (restore.length > 0) restore.pop()?.()
})

describe("a screenshot's frame", () => {
  test("is taken while the request tab is hidden, when animation frames never run", async () => {
    stub(globalThis, "requestAnimationFrame", (() => 0) as typeof requestAnimationFrame)
    const png = await frameToPng({} as MediaStreamTrack)
    expect(png.size).toBe(3)
  })
})

describe("the thumbnail", () => {
  test("gives up after its time, lets go of the video and stops working on it", async () => {
    const created: HTMLVideoElement[] = []
    const make = document.createElement.bind(document)
    const spy = spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const element = make(tag)
      if (tag === "video") created.push(element as HTMLVideoElement)
      return element
    }) as typeof document.createElement)
    restore.push(() => spy.mockRestore())

    expect(await videoThumbnail(new Blob([new Uint8Array(4)], { type: "video/webm" }), 10)).toBeNull()
    const [video] = created
    expect(video?.getAttribute("src")).toBeNull()
    video?.dispatchEvent(new Event("loadeddata"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(video?.currentTime).toBe(0)
  })
})
