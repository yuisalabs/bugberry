/** Why the bulkhead turned work away instead of running it. */
export type Rejected = "full" | "timeout" | "aborted"

export class BulkheadRejected extends Error {
  constructor(readonly reason: Rejected) {
    super(`Bulkhead rejected work: ${reason}`)
    this.name = "BulkheadRejected"
  }
}

export interface Bulkhead {
  /**
   * Runs `work` once one of `maxActive` places is free. Throws BulkheadRejected without running it when
   * `maxQueued` callers already wait, when the wait passes `queueTimeoutMs`, or when `signal` aborts first.
   */
  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>
  stats(): { active: number; queued: number }
}

interface Waiter {
  start: () => void
  reject: (reason: Rejected) => void
}

/**
 * Caps how much of one kind of work runs at once, so a flood of it (agents over MCP) cannot take the event loop
 * and the database from everything else. Callers past the queue get an immediate answer they can retry on,
 * rather than a request that hangs.
 */
export function createBulkhead(options: { maxActive: number; maxQueued: number; queueTimeoutMs: number }): Bulkhead {
  let active = 0
  const queue: Waiter[] = []

  const release = () => {
    active--
    const next = queue.shift()
    if (next) next.start()
  }

  const acquire = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) return Promise.reject(new BulkheadRejected("aborted"))
    if (active < options.maxActive) {
      active++
      return Promise.resolve()
    }
    if (queue.length >= options.maxQueued) return Promise.reject(new BulkheadRejected("full"))

    return new Promise<void>((resolve, reject) => {
      const leave = () => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        const index = queue.indexOf(waiter)
        if (index !== -1) queue.splice(index, 1)
      }
      const waiter: Waiter = {
        // The place is handed over directly, so a newcomer cannot slip in between release and start.
        start: () => {
          leave()
          active++
          resolve()
        },
        reject: (reason) => {
          leave()
          reject(new BulkheadRejected(reason))
        },
      }
      const onAbort = () => waiter.reject("aborted")
      const timer = setTimeout(() => waiter.reject("timeout"), options.queueTimeoutMs)
      signal?.addEventListener("abort", onAbort, { once: true })
      queue.push(waiter)
    })
  }

  return {
    async run(work, signal) {
      await acquire(signal)
      try {
        return await work()
      } finally {
        release()
      }
    },
    stats: () => ({ active, queued: queue.length }),
  }
}
