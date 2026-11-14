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
   * With a `key`, the caller it names also stays within `maxActivePerKey` and `maxQueuedPerKey`.
   */
  run<T>(work: () => Promise<T>, signal?: AbortSignal, key?: string): Promise<T>
  stats(): { active: number; queued: number }
}

export interface BulkheadOptions {
  maxActive: number
  maxQueued: number
  queueTimeoutMs: number
  /** Places one key may hold at once; its further work waits while other keys run. Unset: no limit per key. */
  maxActivePerKey?: number
  /** Work of one key that may wait; more is turned away while other keys can still queue. Unset: no limit per key. */
  maxQueuedPerKey?: number
}

interface Waiter {
  key: string | undefined
  start: () => void
  reject: (reason: Rejected) => void
}

/**
 * Caps how much of one kind of work runs at once, so a flood of it (agents over MCP) cannot take the event loop
 * and the database from everything else. Callers past the queue get an immediate answer they can retry on,
 * rather than a request that hangs. The limits per key keep one caller from using up the places of all.
 */
export function createBulkhead(options: BulkheadOptions): Bulkhead {
  const maxActivePerKey = options.maxActivePerKey ?? Infinity
  const maxQueuedPerKey = options.maxQueuedPerKey ?? Infinity
  let active = 0
  const queue: Waiter[] = []
  const activeByKey = new Map<string, number>()

  const underItsShare = (key: string | undefined) => key === undefined || (activeByKey.get(key) ?? 0) < maxActivePerKey

  const take = (key: string | undefined) => {
    active++
    if (key !== undefined) activeByKey.set(key, (activeByKey.get(key) ?? 0) + 1)
  }

  const release = (key: string | undefined) => {
    active--
    if (key !== undefined) {
      const held = (activeByKey.get(key) ?? 1) - 1
      if (held > 0) activeByKey.set(key, held)
      else activeByKey.delete(key)
    }
    queue.find((waiter) => underItsShare(waiter.key))?.start()
  }

  const acquire = (signal: AbortSignal | undefined, key: string | undefined): Promise<void> => {
    if (signal?.aborted) return Promise.reject(new BulkheadRejected("aborted"))
    if (active < options.maxActive && underItsShare(key)) {
      take(key)
      return Promise.resolve()
    }
    if (queue.length >= options.maxQueued) return Promise.reject(new BulkheadRejected("full"))
    if (key !== undefined && queue.filter((waiter) => waiter.key === key).length >= maxQueuedPerKey) {
      return Promise.reject(new BulkheadRejected("full"))
    }

    return new Promise<void>((resolve, reject) => {
      const leave = () => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        const index = queue.indexOf(waiter)
        if (index !== -1) queue.splice(index, 1)
      }
      const waiter: Waiter = {
        key,
        // The place is handed over directly, so a newcomer cannot slip in between release and start.
        start: () => {
          leave()
          take(key)
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
    async run(work, signal, key) {
      await acquire(signal, key)
      try {
        return await work()
      } finally {
        release(key)
      }
    },
    stats: () => ({ active, queued: queue.length }),
  }
}
