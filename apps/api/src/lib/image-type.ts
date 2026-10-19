const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]

const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((byte, index) => bytes[index] === byte)

/** What an image really is, from its first bytes: names and declared types are not trusted. */
export function imageType(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (startsWith(bytes, PNG)) return "image/png"
  if (startsWith(bytes, JPEG)) return "image/jpeg"
  return null
}
