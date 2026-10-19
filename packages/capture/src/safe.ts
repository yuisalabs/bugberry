/** Runs recording code; a failure there must never reach the page. */
export function safely(fn: () => void): void {
  try {
    fn()
  } catch {
    // Capture is best effort.
  }
}

export function attempt<T>(fn: () => T): T | null {
  try {
    return fn()
  } catch {
    return null
  }
}
