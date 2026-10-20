/** Small WebM files in the layouts Chrome, fix-webm-duration and a remux produce. */
const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]

function size(length: number, bytes = 0): number[] {
  let width = bytes || 1
  while (!bytes && length >= 2 ** (7 * width) - 1) width++
  const out: number[] = []
  let value = length
  for (let i = 0; i < width; i++) {
    out.unshift(value % 256)
    value = Math.floor(value / 256)
  }
  out[0] = (out[0] ?? 0) | (0x80 >> (width - 1))
  return out
}

const text = (value: string) => [...new TextEncoder().encode(value)]
export const element = (id: number[], body: number[], sizeBytes = 0) => [...id, ...size(body.length, sizeBytes), ...body]
export const unknownSized = (id: number[], body: number[]) => [...id, ...UNKNOWN_SIZE, ...body]

export const EBML = [0x1a, 0x45, 0xdf, 0xa3]
export const SEGMENT = [0x18, 0x53, 0x80, 0x67]
export const INFO = [0x15, 0x49, 0xa9, 0x66]
export const MUXING_APP = [0x4d, 0x80]
export const WRITING_APP = [0x57, 0x41]
export const TRACKS = [0x16, 0x54, 0xae, 0x6b]
export const CLUSTER = [0x1f, 0x43, 0xb6, 0x75]

export const header = element(EBML, element([0x42, 0x82], text("webm")))
export const info = (app = "Chrome") => element(INFO, [...element(MUXING_APP, text(app)), ...element(WRITING_APP, text(app))])
export const tracks = element(TRACKS, element([0xae], element([0x86], text("V_VP9"))))
export const blocks = (timecode: number) => [0xe7, 0x81, timecode, 0xa3, 0x84, 0x81, 0x00, 0x00, 0x80]

/** What Chrome's MediaRecorder streams: Segment and every Cluster of unknown size. */
export function chromeOriginal(app = "Chrome"): number[] {
  return [...header, ...unknownSized(SEGMENT, [...info(app), ...tracks, ...unknownSized(CLUSTER, blocks(0)), ...unknownSized(CLUSTER, blocks(1))])]
}

/**
 * What fix-webm-duration made of it: the Segment and the first Cluster got finite sizes running to the end of
 * the file, so the second Cluster sits inside the first. Sizes use 3 bytes, as in the real recordings.
 */
export function damaged(app = "Chrome"): number[] {
  const firstCluster = element(CLUSTER, [...blocks(0), ...unknownSized(CLUSTER, blocks(1))], 3)
  return [...header, ...element(SEGMENT, [...info(app), ...tracks, ...firstCluster], 3)]
}

