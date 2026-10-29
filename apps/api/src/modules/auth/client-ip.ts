import type { Server } from "bun"
import { clientIp } from "../share"

/**
 * Better Auth rate-limits by X-Forwarded-For only when it holds exactly one address; behind Caddy and
 * nginx it holds more, which would put every visitor in one shared bucket. Hands it the single address
 * our own hop counting trusts, or none when the connection address is unknown.
 */
export function withClientIp(request: Request, server: Server<unknown> | null, proxyHops: number): Request {
  const headers = new Headers(request.headers)
  const ip = clientIp(request, server, proxyHops)
  if (ip === "unknown") headers.delete("x-forwarded-for")
  else headers.set("x-forwarded-for", ip)
  // Built from parts: Bun's new Request(request, { headers }) keeps the original headers when the
  // replacement Headers object is empty.
  const hasBody = request.method !== "GET" && request.method !== "HEAD"
  return new Request(request.url, {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    signal: request.signal,
    // @ts-expect-error duplex is required by Bun/undici for a streamed body but missing from RequestInit
    duplex: "half",
  })
}
