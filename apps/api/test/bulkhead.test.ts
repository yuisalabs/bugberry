import { describe, expect, test } from "bun:test"
import { BulkheadRejected, createBulkhead } from "../src/lib/bulkhead"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof BulkheadRejected ? error.reason : "other"),
  )

describe("createBulkhead", () => {
  test("runs at most maxActive at once and starts the next in order", async () => {
    const bulkhead = createBulkhead({ maxActive: 2, maxQueued: 10, queueTimeoutMs: 1000 })
    const gates = [deferred(), deferred(), deferred()]
    const started: number[] = []
    const runs = gates.map((gate, index) =>
      bulkhead.run(async () => {
        started.push(index)
        await gate.promise
        return index
      }),
    )
    await Bun.sleep(0)
    expect(started).toEqual([0, 1])
    expect(bulkhead.stats()).toEqual({ active: 2, queued: 1 })

    gates[0]?.resolve()
    await runs[0]
    await Bun.sleep(0)
    expect(started).toEqual([0, 1, 2])

    gates[1]?.resolve()
    gates[2]?.resolve()
    expect(await Promise.all(runs)).toEqual([0, 1, 2])
    expect(bulkhead.stats()).toEqual({ active: 0, queued: 0 })
  })

  test("turns work away at once when the queue is full", async () => {
    const bulkhead = createBulkhead({ maxActive: 1, maxQueued: 1, queueTimeoutMs: 1000 })
    const gate = deferred()
    const first = bulkhead.run(() => gate.promise)
    const second = bulkhead.run(async () => "queued")
    let ran = false
    const third = bulkhead.run(async () => {
      ran = true
    })
    expect(await rejection(third)).toBe("full")
    expect(ran).toBe(false)
    gate.resolve()
    await first
    expect(await second).toBe("queued")
  })

  test("a caller that waits too long is turned away and leaves the queue", async () => {
    const bulkhead = createBulkhead({ maxActive: 1, maxQueued: 5, queueTimeoutMs: 20 })
    const gate = deferred()
    const first = bulkhead.run(() => gate.promise)
    expect(await rejection(bulkhead.run(async () => "late"))).toBe("timeout")
    expect(bulkhead.stats()).toEqual({ active: 1, queued: 0 })
    gate.resolve()
    await first
  })

  test("an aborted caller leaves the queue without running", async () => {
    const bulkhead = createBulkhead({ maxActive: 1, maxQueued: 5, queueTimeoutMs: 1000 })
    const gate = deferred()
    const first = bulkhead.run(() => gate.promise)
    const controller = new AbortController()
    const waiting = bulkhead.run(async () => "ran", controller.signal)
    controller.abort()
    expect(await rejection(waiting)).toBe("aborted")
    expect(bulkhead.stats().queued).toBe(0)
    gate.resolve()
    await first
  })

  test("a failing piece of work frees its place", async () => {
    const bulkhead = createBulkhead({ maxActive: 1, maxQueued: 0, queueTimeoutMs: 1000 })
    await expect(bulkhead.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom")
    expect(await bulkhead.run(async () => "next")).toBe("next")
  })
})
