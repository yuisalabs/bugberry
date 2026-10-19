export interface RateLimiter {
  /** Returns false when `key` has used up its allowance for the current window. */
  consume(key: string): boolean
}

const DEFAULT_MAX_KEYS = 10_000

/**
 * Fixed-window, in-memory limiter; enough for a single-process internal deployment.
 * At most `maxKeys` keys are tracked: the oldest one is evicted first, so many distinct keys cannot exhaust memory.
 */
export function createRateLimiter(options: {
  limit: number
  windowMs: number
  maxKeys?: number
  now?: () => number
}): RateLimiter {
  const now = options.now ?? Date.now
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS
  const windows = new Map<string, { count: number; resetAt: number }>()

  return {
    consume(key) {
      const current = now()
      const entry = windows.get(key)
      if (!entry || entry.resetAt <= current) {
        windows.delete(key)
        if (windows.size >= maxKeys) {
          const oldest = windows.keys().next().value
          if (oldest !== undefined) windows.delete(oldest)
        }
        windows.set(key, { count: 1, resetAt: current + options.windowMs })
        return true
      }
      if (entry.count >= options.limit) return false
      entry.count += 1
      return true
    },
  }
}
