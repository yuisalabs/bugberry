import { describe, expect, test } from "bun:test"
import { withWebmDuration } from "../../lib/recording/webm-duration"

const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]

function size(length: number): number[] {
  for (let bytes = 1; bytes <= 8; bytes++) {
    if (length < 2 ** (7 * bytes) - 1) {
      const out: number[] = []
      let value = length
      for (let i = 0; i < bytes; i++) {
        out.unshift(value % 256)
        value = Math.floor(value / 256)
      }
      out[0] = (out[0] ?? 0) | (0x80 >> (bytes - 1))
      return out
    }
  }
  throw new Error("too long")
}

const element = (id: number[], body: number[]) => [...id, ...size(body.length), ...body]
const unknownSized = (id: number[], body: number[]) => [...id, ...UNKNOWN_SIZE, ...body]
const uint = (id: number[], value: number) => element(id, [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff])
const float64 = (id: number[], value: number) => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setFloat64(0, value)
  return element(id, [...bytes])
}

const EBML = [0x1a, 0x45, 0xdf, 0xa3]
const SEGMENT = [0x18, 0x53, 0x80, 0x67]
const INFO = [0x15, 0x49, 0xa9, 0x66]
const TIMECODE_SCALE = [0x2a, 0xd7, 0xb1]
const DURATION = [0x44, 0x89]
const MUXING_APP = [0x4d, 0x80]
const TRACKS = [0x16, 0x54, 0xae, 0x6b]
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75]

const header = element(EBML, element([0x42, 0x82], [...new TextEncoder().encode("webm")]))
const tracks = element(TRACKS, element([0xae], element([0x86], [...new TextEncoder().encode("V_VP9")])))
// Two clusters the way Chrome's MediaRecorder streams them: size unknown, each one ending where the next begins.
const clusters = [
  ...unknownSized(CLUSTER, [0xe7, 0x81, 0x00, 0xa3, 0x84, 0x81, 0x00, 0x00, 0x80]),
  ...unknownSized(CLUSTER, [0xe7, 0x82, 0x03, 0xe8, 0xa3, 0x84, 0x81, 0x00, 0x00, 0x00]),
]

function chromeWebm(infoChildren: number[], segmentSize: "unknown" | "finite" = "unknown"): Uint8Array<ArrayBuffer> {
  const body = [...element(INFO, [...infoChildren, ...element(MUXING_APP, [0x43, 0x68])]), ...tracks, ...clusters]
  const segment = segmentSize === "unknown" ? unknownSized(SEGMENT, body) : element(SEGMENT, body)
  return new Uint8Array([...header, ...segment])
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

function indexOf(haystack: Uint8Array, needle: number[], from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/** Every Duration value in the file, read from its 8-byte float. */
function durations(bytes: Uint8Array): number[] {
  const found: number[] = []
  for (let at = indexOf(bytes, [...DURATION, 0x88]); at !== -1; at = indexOf(bytes, [...DURATION, 0x88], at + 1)) {
    found.push(new DataView(bytes.buffer, bytes.byteOffset + at + 3, 8).getFloat64(0))
  }
  return found
}

const webm = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes], { type: "video/webm" })

describe("withWebmDuration", () => {
  test("leaves Chrome's unknown-size clusters byte for byte, so Safari can still read them", async () => {
    const input = chromeWebm(uint(TIMECODE_SCALE, 1_000_000))

    const output = await bytesOf(await withWebmDuration(webm(input), 45_589))

    const from = indexOf(input, CLUSTER)
    expect([...output.slice(indexOf(output, CLUSTER))]).toEqual([...input.slice(from)])
  })

  test("keeps the Segment's unknown size", async () => {
    const output = await bytesOf(await withWebmDuration(webm(chromeWebm(uint(TIMECODE_SCALE, 1_000_000))), 1000))

    const at = indexOf(output, SEGMENT)
    expect([...output.slice(at + 4, at + 12)]).toEqual(UNKNOWN_SIZE)
  })

  test("writes the duration in milliseconds at the default timecode scale", async () => {
    const output = await bytesOf(await withWebmDuration(webm(chromeWebm(uint(TIMECODE_SCALE, 1_000_000))), 45_589))

    expect(durations(output)).toEqual([45_589])
  })

  test("writes the duration in the file's own timecode scale", async () => {
    const output = await bytesOf(await withWebmDuration(webm(chromeWebm(uint(TIMECODE_SCALE, 1000))), 2500))

    expect(durations(output)).toEqual([2_500_000])
  })

  test("replaces a duration the header already has", async () => {
    const input = chromeWebm([...uint(TIMECODE_SCALE, 1_000_000), ...float64(DURATION, 0)])

    const output = await bytesOf(await withWebmDuration(webm(input), 7000))

    expect(durations(output)).toEqual([7000])
  })

  test("grows a finite Segment size by what the Info gained", async () => {
    const input = chromeWebm(uint(TIMECODE_SCALE, 1_000_000), "finite")

    const output = await bytesOf(await withWebmDuration(webm(input), 1000))

    const at = indexOf(output, SEGMENT)
    const sizeByte = output[at + 4] ?? 0
    const sizeLength = Math.clz32(sizeByte) - 23
    let segmentSize = sizeByte & (0xff >> sizeLength)
    for (let i = 1; i < sizeLength; i++) segmentSize = segmentSize * 256 + (output[at + 4 + i] ?? 0)
    expect(at + 4 + sizeLength + segmentSize).toBe(output.length)
  })

  test("keeps the video's type", async () => {
    const output = await withWebmDuration(webm(chromeWebm(uint(TIMECODE_SCALE, 1_000_000))), 1000)

    expect(output.type).toBe("video/webm")
  })

  test("rejects a file that is not WebM", async () => {
    await expect(withWebmDuration(new Blob(["not a video"]), 1000)).rejects.toThrow()
  })
})
