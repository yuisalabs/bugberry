import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const VERSION = "v1"

export class SecretError extends Error {
  override name = "SecretError"
}

/** Shown when a stored token cannot be decrypted (ENCRYPTION_KEY changed or data corrupted). */
export const SECRET_UNREADABLE =
  "The saved token can't be read with the current ENCRYPTION_KEY. Save the token again in the integration settings."

/** AES-256-GCM for tracker tokens at rest. Output: `v1.<iv>.<tag>.<ciphertext>` in base64url. */
export function createSecretBox(base64Key: string) {
  const key = Buffer.from(base64Key, "base64")
  if (key.length !== 32) throw new SecretError("Encryption key must be 32 bytes")

  return {
    seal(plain: string): string {
      const iv = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", key, iv)
      const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
      return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(
        ".",
      )
    },
    open(sealed: string): string {
      const [version, iv, tag, data, extra] = sealed.split(".")
      if (version !== VERSION || !iv || !tag || data === undefined || extra !== undefined) {
        throw new SecretError("Unrecognised secret format")
      }
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"))
        decipher.setAuthTag(Buffer.from(tag, "base64url"))
        return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")
      } catch {
        throw new SecretError("Secret cannot be decrypted with the current ENCRYPTION_KEY")
      }
    },
  }
}

export type SecretBox = ReturnType<typeof createSecretBox>
