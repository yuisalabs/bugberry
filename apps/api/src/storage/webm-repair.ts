const EBML = 0x1a45dfa3
const SEGMENT = 0x18538067
const INFO = 0x1549a966
const CLUSTER = 0x1f43b675
const MUXING_APP = 0x4d80
const WRITING_APP = 0x5741

/** Enough for the EBML header, the Segment's Info and Tracks and the first Cluster's header. */
export const WEBM_HEAD_BYTES = 64 * 1024

export interface WebmPatch {
  offset: number
  bytes: Uint8Array<ArrayBuffer>
}

export type WebmRepairPlan =
  | { status: "repair"; patches: WebmPatch[] }
  | { status: "ok" }
  | { status: "unrecognized"; reason: string }

interface Element {
  id: number
  start: number
  body: number
  /** Where the size field starts, and how many bytes it has. */
  sizeAt: number
  sizeLength: number
  size: number | null
}

function readElement(bytes: Uint8Array, at: number): Element | null {
  const readVint = (from: number, keepMarker: boolean) => {
    const first = bytes[from]
    if (first === undefined || first === 0) return null
    const length = Math.clz32(first) - 23
    if (from + length > bytes.length) return null
    let value = keepMarker ? first : first & (0xff >> length)
    let allOnes = value === 0xff >> length
    for (let i = 1; i < length; i++) {
      const byte = bytes[from + i] ?? 0
      value = value * 256 + byte
      allOnes &&= byte === 0xff
    }
    return { value, length, unknown: !keepMarker && allOnes }
  }
  const id = readVint(at, true)
  if (!id) return null
  const size = readVint(at + id.length, false)
  if (!size) return null
  return {
    id: id.value,
    start: at,
    sizeAt: at + id.length,
    sizeLength: size.length,
    body: at + id.length + size.length,
    size: size.unknown ? null : size.value,
  }
}

const end = (element: Element) => element.body + (element.size ?? Number.POSITIVE_INFINITY)

/** The size field's own length, all value bits set: EBML's "unknown size". */
function unknownSize(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length).fill(0xff)
  bytes[0] = 0xff >> (length - 1)
  return bytes
}

function writtenByChrome(head: Uint8Array, info: Element): boolean {
  for (let at = info.body; at < end(info); ) {
    const child = readElement(head, at)
    if (!child || child.size === null) return false
    if (child.id === MUXING_APP || child.id === WRITING_APP) {
      if (new TextDecoder().decode(head.subarray(child.body, end(child))) !== "Chrome") return false
    }
    at = end(child)
  }
  return true
}

/**
 * Recordings made before the extension stopped using fix-webm-duration: that library gave Chrome's
 * unknown-size Segment and first Cluster a size running to the end of the file, so every later Cluster
 * sits inside the first. Chrome and Firefox play that; Safari reads the header and never plays.
 *
 * The repair puts the unknown size back into those two size fields, keeping their byte length, so the
 * file keeps its length and every other byte. Only `head` (the start of the file) is read; anything that
 * does not look exactly like such a recording is left alone.
 */
export function planWebmRepair(head: Uint8Array, fileSize: number): WebmRepairPlan {
  const unrecognized = (reason: string): WebmRepairPlan => ({ status: "unrecognized", reason })

  const ebml = readElement(head, 0)
  if (!ebml || ebml.id !== EBML || ebml.size === null) return unrecognized("not a WebM file")
  const segment = readElement(head, end(ebml))
  if (!segment || segment.id !== SEGMENT) return unrecognized("no Segment after the EBML header")
  if (segment.size === null) return { status: "ok" }
  if (end(segment) !== fileSize) return unrecognized("the Segment does not end where the file ends")

  let info: Element | null = null
  for (let at = segment.body; at < head.length; ) {
    const child = readElement(head, at)
    if (!child) return unrecognized("the start of the Segment is unreadable")
    if (child.id === INFO) info = child
    if (child.id === CLUSTER) {
      if (!info || !writtenByChrome(head, info)) return unrecognized("not written by Chrome's MediaRecorder")
      if (child.size === null) return unrecognized("a finite Segment around an unknown-size Cluster")
      // A first Cluster ending before the Segment does is a properly sized file (a remux, for one).
      if (end(child) !== end(segment)) return { status: "ok" }
      return {
        status: "repair",
        patches: [
          { offset: segment.sizeAt, bytes: unknownSize(segment.sizeLength) },
          { offset: child.sizeAt, bytes: unknownSize(child.sizeLength) },
        ],
      }
    }
    if (child.size === null) return unrecognized("an unknown-size element before the first Cluster")
    at = end(child)
  }
  return unrecognized("no Cluster near the start of the file")
}

/** A copy of `file` with `patches` written over it. */
export function applyWebmPatches(file: Uint8Array, patches: WebmPatch[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(file)
  for (const patch of patches) out.set(patch.bytes, patch.offset)
  return out
}
