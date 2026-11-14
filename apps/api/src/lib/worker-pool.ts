/** What a worker posts back for one task. */
export type WorkerReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string }

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface Slot {
  worker: Worker
  pending: Map<number, Pending>
}

export class WorkerTaskError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "WorkerTaskError"
  }
}

export interface WorkerPool {
  /** Runs `task` on the least busy thread. Rejects with WorkerTaskError when the task fails or the thread dies. */
  run<T>(task: Record<string, unknown>, transfer?: Transferable[]): Promise<T>
  terminate(): void
}

/**
 * A few threads for CPU-heavy work, so parsing a large payload never holds up the request thread that serves the
 * dashboard. Threads start on first use, do not keep the process alive, and are replaced when one crashes or a
 * task overruns `taskTimeoutMs` (its other tasks fail with it).
 */
export function createWorkerPool(options: { url: URL; size: number; taskTimeoutMs: number }): WorkerPool {
  const slots: Array<Slot | null> = Array.from({ length: options.size }, () => null)
  let nextId = 1

  const fail = (slot: Slot, code: string) => {
    for (const pending of slot.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new WorkerTaskError(code))
    }
    slot.pending.clear()
  }

  const retire = (index: number, slot: Slot, code: string) => {
    if (slots[index] === slot) slots[index] = null
    fail(slot, code)
    slot.worker.terminate()
  }

  const spawn = (index: number): Slot => {
    const worker = new Worker(options.url.href)
    // Bun's Worker has unref(); the DOM typings in this project do not know it.
    ;(worker as unknown as { unref(): void }).unref()
    const slot: Slot = { worker, pending: new Map() }
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data
      const pending = slot.pending.get(reply.id)
      if (!pending) return
      slot.pending.delete(reply.id)
      clearTimeout(pending.timer)
      if (reply.ok) pending.resolve(reply.value)
      else pending.reject(new WorkerTaskError(reply.error))
    }
    worker.onerror = () => retire(index, slot, "worker_crashed")
    slots[index] = slot
    return slot
  }

  const pick = (): [number, Slot] => {
    let best = 0
    for (let index = 1; index < slots.length; index++) {
      if ((slots[index]?.pending.size ?? 0) < (slots[best]?.pending.size ?? 0)) best = index
    }
    return [best, slots[best] ?? spawn(best)]
  }

  return {
    run<T>(task: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
      const [index, slot] = pick()
      const id = nextId++
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => retire(index, slot, "timeout"), options.taskTimeoutMs)
        slot.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
        slot.worker.postMessage({ ...task, id }, transfer)
      })
    },
    terminate() {
      slots.forEach((slot, index) => slot && retire(index, slot, "terminated"))
    },
  }
}
