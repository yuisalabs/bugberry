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

  test("one caller holds at most its own share of the places, and others run past its waiting work", async () => {
    const bulkhead = createBulkhead({ maxActive: 3, maxQueued: 10, queueTimeoutMs: 1000, maxActivePerKey: 2 })
    const gates = [deferred(), deferred(), deferred(), deferred()]
    const started: string[] = []
    const run = (name: string, key: string, gate: ReturnType<typeof deferred>) =>
      bulkhead.run(
        async () => {
          started.push(name)
          await gate.promise
        },
        undefined,
        key,
      )
    const runs = [run("ana-1", "ana", gates[0]!), run("ana-2", "ana", gates[1]!), run("ana-3", "ana", gates[2]!), run("budi-1", "budi", gates[3]!)]
    await Bun.sleep(0)
    // A third place is free, but Ana already holds her two: her third call waits and Budi's runs.
    expect(started).toEqual(["ana-1", "ana-2", "budi-1"])
    expect(bulkhead.stats()).toEqual({ active: 3, queued: 1 })

    gates[0]!.resolve()
    await runs[0]
    await Bun.sleep(0)
    expect(started).toEqual(["ana-1", "ana-2", "budi-1", "ana-3"])
    for (const gate of gates) gate.resolve()
    await Promise.all(runs)
    expect(bulkhead.stats()).toEqual({ active: 0, queued: 0 })
  })

  test("a freed place goes to the first waiting caller that is under its share", async () => {
    const bulkhead = createBulkhead({ maxActive: 2, maxQueued: 10, queueTimeoutMs: 1000, maxActivePerKey: 1 })
    const gates = { ana1: deferred(), budi1: deferred(), ana2: deferred(), cici1: deferred() }
    const started: string[] = []
    const run = (name: keyof typeof gates, key: string) =>
      bulkhead.run(
        async () => {
          started.push(name)
          await gates[name].promise
        },
        undefined,
        key,
      )
    const runs = [run("ana1", "ana"), run("budi1", "budi"), run("ana2", "ana"), run("cici1", "cici")]
    await Bun.sleep(0)
    expect(started).toEqual(["ana1", "budi1"])

    // Budi's place comes free while Ana still holds hers: Cici is next, though Ana's second call waited longer.
    gates.budi1.resolve()
    await runs[1]
    await Bun.sleep(0)
    expect(started).toEqual(["ana1", "budi1", "cici1"])
    for (const gate of Object.values(gates)) gate.resolve()
    await Promise.all(runs)
    expect(started).toEqual(["ana1", "budi1", "cici1", "ana2"])
  })

  test("one caller fills at most its own share of the queue, leaving room for others", async () => {
    const bulkhead = createBulkhead({ maxActive: 1, maxQueued: 10, queueTimeoutMs: 1000, maxQueuedPerKey: 1 })
    const gate = deferred()
    const first = bulkhead.run(() => gate.promise, undefined, "ana")
    const waiting = bulkhead.run(async () => "ana waited", undefined, "ana")
    expect(await rejection(bulkhead.run(async () => "ana again", undefined, "ana"))).toBe("full")
    const other = bulkhead.run(async () => "budi waited", undefined, "budi")
    expect(bulkhead.stats()).toEqual({ active: 1, queued: 2 })
    gate.resolve()
    await first
    expect([await waiting, await other]).toEqual(["ana waited", "budi waited"])
  })

  test("a failing piece of work frees its place", async () => {
    const bulkhead = createBulkhead({ maxActive: 1, maxQueued: 0, queueTimeoutMs: 1000 })
    await expect(bulkhead.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom")
    expect(await bulkhead.run(async () => "next")).toBe("next")
  })
})
