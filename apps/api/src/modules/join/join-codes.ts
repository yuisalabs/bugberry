/** Letters and digits that can't be mistaken for each other: no 0/O and no 1/I. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
const CODE_LENGTH = 7

/** A new short code, shown as "7KX-29QF". */
export function newJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  const chars = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length])
  return `${chars.slice(0, 3).join("")}-${chars.slice(3).join("")}`
}

/** "7kx-29qf " → "7KX29QF": case, dashes and spaces never matter when someone types a code. */
export function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

/** Only a hash of a personal invite code is stored, like the invite token. */
export function hashCode(code: string): string {
  return new Bun.CryptoHasher("sha256").update(normalizeCode(code)).digest("hex")
}

export type JoinValue = { kind: "token"; token: string } | { kind: "share"; code: string } | { kind: "code"; code: string }

/** What someone pasted into "Invite link or code". */
export function parseJoinValue(value: string): JoinValue | null {
  const text = value.trim()
  const invite = /\/invite\/([A-Za-z0-9_-]+)\/?$/.exec(text)
  if (invite) return { kind: "token", token: invite[1] as string }
  const share = /\/join\/([A-Za-z0-9-]+)\/?$/.exec(text)
  if (share) {
    const code = normalizeCode(share[1] as string)
    return code.length === CODE_LENGTH ? { kind: "share", code } : null
  }
  const code = normalizeCode(text)
  return code.length === CODE_LENGTH ? { kind: "code", code } : null
}
