import { SHARE_SLUG_LENGTH } from "@bugberry/shared"

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
// Largest multiple of 62 below 256; bytes at or above it are discarded to avoid modulo bias.
const UNBIASED_LIMIT = 248

export function newId(): string {
  return Bun.randomUUIDv7()
}

export function newShareSlug(): string {
  let slug = ""
  while (slug.length < SHARE_SLUG_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(SHARE_SLUG_LENGTH * 2))) {
      if (byte >= UNBIASED_LIMIT) continue
      slug += ALPHABET[byte % ALPHABET.length]
      if (slug.length === SHARE_SLUG_LENGTH) break
    }
  }
  return slug
}
