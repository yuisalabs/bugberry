/**
 * Hands on only the answer to the latest request: a slow answer for an earlier choice (another workspace, say)
 * that lands after a newer one is dropped.
 */
export function latestOnly<T>(apply: (value: T) => void): (work: Promise<T>) => Promise<void> {
  let latest = 0
  return async (work) => {
    const mine = ++latest
    const value = await work
    if (mine === latest) apply(value)
  }
}
