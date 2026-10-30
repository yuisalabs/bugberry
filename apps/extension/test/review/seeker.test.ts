import { describe, expect, test } from "bun:test"
import { createSeeker } from "../../lib/review/seeker"

/** A <video> as far as seeking goes: setting currentTime starts a seek, `finish()` ends it with "seeked". */
function fakeVideo() {
  const target = new EventTarget()
  const set: number[] = []
  const video = Object.defineProperty(target, "currentTime", {
    get: () => set.at(-1) ?? 0,
    set: (seconds: number) => void set.push(seconds),
  }) as EventTarget & { currentTime: number }
  return { video, set, finish: () => target.dispatchEvent(new Event("seeked")) }
}

describe("createSeeker", () => {
  test("the first seek goes at once", () => {
    const { video, set } = fakeVideo()
    createSeeker(video).seek(5)
    expect(set).toEqual([5])
  })

  test("while a seek runs, later ones wait, and only the last of them goes once it ends", () => {
    const { video, set, finish } = fakeVideo()
    const seeker = createSeeker(video)
    seeker.seek(5)
    seeker.seek(6)
    seeker.seek(7)
    seeker.seek(8)
    expect(set).toEqual([5])
    finish()
    expect(set).toEqual([5, 8])
    finish()
    expect(set).toEqual([5, 8])
  })

  test("after the last seek ends, the next goes at once again", () => {
    const { video, set, finish } = fakeVideo()
    const seeker = createSeeker(video)
    seeker.seek(5)
    finish()
    seeker.seek(9)
    expect(set).toEqual([5, 9])
  })
})

describe("a seek that never ends", () => {
  test("holds the next one back for a second at most", () => {
    const { video, set } = fakeVideo()
    let clock = 0
    const seeker = createSeeker(video, () => clock)
    seeker.seek(5)
    clock = 500
    seeker.seek(6)
    expect(set).toEqual([5])
    clock = 1500
    seeker.seek(7)
    expect(set).toEqual([5, 7])
  })
})
