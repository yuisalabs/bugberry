const FRAME_LINE = /:\d+:\d+\)?$/

/**
 * `stack` without its first frame (the SDK function the app called), so the call site read later is the
 * app's. Undefined when no frame is left. V8 starts with an "Error" header line; Firefox has none.
 */
export function withoutSdkFrame(stack: string | undefined): string | undefined {
  if (typeof stack !== "string" || !stack) return undefined
  const lines = stack.split("\n")
  const first = lines.findIndex((line) => FRAME_LINE.test(line.trim()))
  if (first === -1) return undefined
  lines.splice(first, 1)
  if (!lines.some((line) => FRAME_LINE.test(line.trim()))) return undefined
  return lines.join("\n")
}

/** At most `perSecond` stacks per second, so an app logging in a tight loop does not pay for a stack each time. */
export function createStackBudget(now: () => number = Date.now, perSecond = 100): () => boolean {
  let windowStart = Number.NEGATIVE_INFINITY
  let used = 0
  return () => {
    const t = now()
    if (t - windowStart >= 1000) {
      windowStart = t
      used = 0
    }
    if (used >= perSecond) return false
    used += 1
    return true
  }
}
