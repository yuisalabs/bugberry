export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** A random invitation token; only its SHA-256 is stored, so a database leak reveals no working link. */
export function newInviteToken(): { token: string; hash: string } {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
  return { token, hash: hashInviteToken(token) }
}

export function hashInviteToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex")
}

export function inviteUrl(appUrl: string, token: string): string {
  return `${appUrl}/invite/${token}`
}

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked"

export function invitationStatus(row: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now = new Date()): InvitationStatus {
  if (row.acceptedAt) return "accepted"
  if (row.revokedAt) return "revoked"
  return row.expiresAt <= now ? "expired" : "pending"
}
