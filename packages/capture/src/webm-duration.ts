const SEGMENT = 0x18538067
const INFO = 0x1549a966
const CLUSTER = 0x1f43b675
const TIMECODE_SCALE = 0x2ad7b1
const DURATION = 0x4489
const DEFAULT_TIMECODE_SCALE = 1_000_000
/** Chrome puts the Info right after the EBML header; it always fits in the first few hundred bytes. */
const HEAD_BYTES = 64 * 1024

interface Vint {
  value: number
  length: number
  /** All value bits set: the element's size is unknown and it runs until its parent (or the file) ends. */
  unknown: boolean
}

function readVint(bytes: Uint8Array, at: number, keepMarker: boolean): Vint {
  const first = bytes[at]
  if (first === undefined || first === 0) throw new Error("Not a WebM file")
  const length = Math.clz32(first) - 23
  if (at + length > bytes.length) throw new Error("WebM header is cut short")
  let value = keepMarker ? first : first & (0xff >> length)
  let allOnes = value === 0xff >> length
  for (let i = 1; i < length; i++) {
    const byte = bytes[at + i] ?? 0
    value = value * 256 + byte
    allOnes &&= byte === 0xff
  }
  return { value, length, unknown: !keepMarker && allOnes }
}

function encodeSize(size: number, length = 0): number[] {
  let bytes = length || 1
  while (!length && size >= 2 ** (7 * bytes) - 1) bytes++
  if (bytes > 8 || size >= 2 ** (7 * bytes) - 1) throw new Error("WebM element too large")
  const out: number[] = []
  let value = size
  for (let i = 0; i < bytes; i++) {
    out.unshift(value % 256)
    value = Math.floor(value / 256)
  }
  out[0] = (out[0] ?? 0) | (0x80 >> (bytes - 1))
  return out
}

interface Element {
  id: number
  start: number
  body: number
  end: number
  size: Vint
}

function readElement(bytes: Uint8Array, at: number): Element {
  const id = readVint(bytes, at, true)
  const size = readVint(bytes, at + id.length, false)
  const body = at + id.length + size.length
  return { id: id.value, start: at, body, end: size.unknown ? Number.POSITIVE_INFINITY : body + size.value, size }
}

/**
 * Writes `durationMs` into the Info of a MediaRecorder WebM, so players show the length and can seek.
 *
 * Only the Info (and a finite Segment size) changes; every other byte stays as Chrome wrote it. Chrome
 * streams the Segment and its Clusters with an unknown size, and Safari only plays them that way: a
 * rewriter that gives the first Cluster a size up to the end of the file nests every later Cluster inside
 * it, which Chrome and Firefox tolerate and Safari does not (the video loads its header and never plays).
 */
export async function withWebmDuration(video: Blob, durationMs: number): Promise<Blob> {
  const head = new Uint8Array(await video.slice(0, HEAD_BYTES).arrayBuffer())

  const ebml = readElement(head, 0)
  if (ebml.id !== 0x1a45dfa3 || ebml.size.unknown) throw new Error("Not a WebM file")
  const segment = readElement(head, ebml.end)
  if (segment.id !== SEGMENT) throw new Error("WebM has no Segment")

  let info: Element | null = null
  for (let at = segment.body; at < Math.min(segment.end, head.length); ) {
    const child = readElement(head, at)
    if (child.id === INFO) {
      info = child
      break
    }
    if (child.id === CLUSTER || child.size.unknown) break
    at = child.end
  }
  if (!info || info.end > head.length) throw new Error("WebM has no Info near its start")

  let timecodeScale = DEFAULT_TIMECODE_SCALE
  const kept: number[] = []
  for (let at = info.body; at < info.end; ) {
    const child = readElement(head, at)
    if (child.size.unknown || child.end > info.end) throw new Error("WebM Info is malformed")
    if (child.id === TIMECODE_SCALE) timecodeScale = uintAt(head, child) || DEFAULT_TIMECODE_SCALE
    if (child.id !== DURATION) kept.push(...head.subarray(child.start, child.end))
    at = child.end
  }

  const duration = new Uint8Array(8)
  new DataView(duration.buffer).setFloat64(0, (durationMs * 1_000_000) / timecodeScale)
  const infoBody = [...kept, 0x44, 0x89, 0x88, ...duration]
  const newInfo = new Uint8Array([...head.subarray(info.start, info.body - info.size.length), ...encodeSize(infoBody.length), ...infoBody])

  const segmentSizeAt = segment.body - segment.size.length
  const segmentSize = segment.size.unknown
    ? head.subarray(segmentSizeAt, segment.body)
    : new Uint8Array(encodeSize(segment.size.value + newInfo.length - (info.end - info.start), segment.size.length))

  return new Blob(
    [head.subarray(0, segmentSizeAt), segmentSize, head.subarray(segment.body, info.start), newInfo, video.slice(info.end)],
    { type: video.type },
  )
}

function uintAt(bytes: Uint8Array, element: Element): number {
  let value = 0
  for (let i = element.body; i < element.end; i++) value = value * 256 + (bytes[i] ?? 0)
  return value
}
