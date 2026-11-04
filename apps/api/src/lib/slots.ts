/** Runs at most `max` pieces of work at once across every request; the rest wait their turn in order. */
export function createSlots(max: number): <T>(work: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: Array<() => void> = []
  return async (work) => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve))
    active++
    try {
      return await work()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}
