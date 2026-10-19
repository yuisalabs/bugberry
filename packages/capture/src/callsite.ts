const FRAME = /\(?((?:https?|chrome-extension):\/\/[^\s)]+):(\d+):\d+\)?$/

/** A stack of the current call, for hooks that want to know which page code called them. */
export type StackOf = () => string | undefined

export const currentStack: StackOf = () => new Error().stack

/**
 * At most `perSecond` stacks per second; beyond that the call site is left out. A page that logs in a
 * tight loop must not pay for a stack on every call.
 */
export function createStackBudget(stackOf: StackOf, now: () => number, perSecond = 100): StackOf {
  let windowStart = Number.NEGATIVE_INFINITY
  let used = 0
  return () => {
    const t = now()
    if (t - windowStart >= 1000) {
      windowStart = t
      used = 0
    }
    if (used >= perSecond) return undefined
    used += 1
    return stackOf()
  }
}

/** "file.js:88": the first frame from the page itself, skipping BugBerry's own capture script. */
export function callSite(stack: string | undefined): string | undefined {
  // Error.prepareStackTrace lets a page make `stack` anything.
  if (typeof stack !== "string" || !stack) return undefined
  for (const line of stack.split("\n")) {
    const match = line.trim().match(FRAME)
    if (!match?.[1] || match[1].startsWith("chrome-extension://")) continue
    let url: URL
    try {
      url = new URL(match[1])
    } catch {
      continue
    }
    const file = url.pathname.split("/").filter(Boolean).at(-1) ?? url.host
    return `${file}:${match[2]}`
  }
  return undefined
}
