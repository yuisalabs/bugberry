export const TOKEN_PREFIX = "fdb_"

export function generateApiToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return TOKEN_PREFIX + Buffer.from(bytes).toString("base64url")
}

export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex")
}
