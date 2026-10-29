/**
 * Part size for uploads in parts: far under Cloudflare's 100 MB body limit and above S3's 5 MiB minimum. Finalize
 * expects these sizes, so changing it fails the uploads still in progress when the new server starts.
 */
export const PART_BYTES = 16 * 1024 * 1024

/** The sizes of the parts of a `size`-byte file: all `partBytes` long, the last one holding the rest. */
export function partSizes(size: number, partBytes = PART_BYTES): number[] {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error(`Invalid file size: ${size}`)
  const count = Math.ceil(size / partBytes)
  return Array.from({ length: count }, (_, index) => (index < count - 1 ? partBytes : size - partBytes * (count - 1)))
}
