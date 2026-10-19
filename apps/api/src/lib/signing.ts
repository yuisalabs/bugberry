import { createHmac, timingSafeEqual } from "node:crypto"

function mac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url")
}

/** Encodes a payload as `<base64url json>.<base64url hmac>`. */
export function sign(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${body}.${mac(body, secret)}`
}

export function verify<T>(token: string, secret: string): T | null {
  const [body, signature, extra] = token.split(".")
  if (!body || !signature || extra !== undefined) return null
  const expected = Buffer.from(mac(body, secret))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T
  } catch {
    return null
  }
}
