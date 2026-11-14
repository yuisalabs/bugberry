import { hashToken, TOKEN_PREFIX } from "../modules/tokens/token"

const UNAUTHORIZED_MS = 10_000
const LIMITED_MS = 5_000
const IP_WINDOW_MS = 60_000

export interface Refusals {
  /** The answer this token or address got a moment ago and would get again, or null when it must be checked. */
  recall(token: string, ip: string): 401 | 429 | null
  /** This token failed sign-in from this address. */
  unauthorized(token: string, ip: string): void
  /** The person behind this token is past their calls a minute. */
  limited(token: string): void
}

/**
 * Refusals MCP gave a moment ago, answered again from memory instead of with a token lookup and a count in Postgres.
 * An address past its failed personal tokens a minute is refused whatever it sends, which also shuts out a valid
 * caller behind the same address.
 */
export function createRefusals(options: { failedSignInsPerIp?: number; maxKeys?: number; now?: () => number } = {}): Refusals {
  const failedSignInsPerIp = options.failedSignInsPerIp ?? 30
  const maxKeys = options.maxKeys ?? 10_000
  const now = options.now ?? (() => Date.now())
  const tokens = new Map<string, { status: 401 | 429; since: number; until: number }>()
  const failures = new Map<string, { count: number; since: number; until: number }>()

  const remember = <V>(map: Map<string, V>, key: string, value: V) => {
    map.delete(key)
    if (map.size >= maxKeys) {
      const oldest = map.keys().next().value
      if (oldest !== undefined) map.delete(oldest)
    }
    map.set(key, value)
  }

  const live = <V extends { since: number; until: number }>(map: Map<string, V>, key: string): V | null => {
    const entry = map.get(key)
    const at = now()
    // `since` is checked too: after the clock is set back, `until` alone would keep a refusal for that long.
    if (entry && entry.since <= at && at < entry.until) return entry
    map.delete(key)
    return null
  }
  const lasting = (ms: number) => ({ since: now(), until: now() + ms })

  return {
    recall(token, ip) {
      const failed = live(failures, ip)
      if (failed && failed.count > failedSignInsPerIp) return 429
      return live(tokens, hashToken(token))?.status ?? null
    },
    unauthorized(token, ip) {
      remember(tokens, hashToken(token), { status: 401, ...lasting(UNAUTHORIZED_MS) })
      // Only a made-up personal token costs a lookup, and many people's AI apps send OAuth tokens from one address.
      if (ip === "unknown" || !token.startsWith(TOKEN_PREFIX)) return
      const failed = live(failures, ip)
      if (failed) failed.count++
      else remember(failures, ip, { count: 1, ...lasting(IP_WINDOW_MS) })
    },
    limited(token) {
      remember(tokens, hashToken(token), { status: 429, ...lasting(LIMITED_MS) })
    },
  }
}
