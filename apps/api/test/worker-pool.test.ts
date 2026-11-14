import { afterEach, describe, expect, test } from "bun:test"
import { createWorkerPool, WorkerTaskError, type WorkerPool } from "../src/lib/worker-pool"
import { parseDebuggerView, PayloadError } from "../src/workers/payloads"

const url = new URL("./fixtures/pool.worker.ts", import.meta.url)
let pool: WorkerPool | null = null
afterEach(() => pool?.terminate())

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof WorkerTaskError ? error.code : "other"),
  )

describe("createWorkerPool", () => {
  test("answers each task with its own result", async () => {
    pool = createWorkerPool({ url, size: 2, taskTimeoutMs: 5000 })
    const answers = await Promise.all([1, 2, 3, 4].map((value) => pool!.run({ kind: "echo", value })))
    expect(answers).toEqual([1, 2, 3, 4])
    expect(await code(pool.run({ kind: "fail" }))).toBe("too_large")
  })

  test("the request thread keeps answering while a worker is busy", async () => {
    pool = createWorkerPool({ url, size: 1, taskTimeoutMs: 5000 })
    await pool.run({ kind: "echo", value: "warm" })
    const busy = pool.run({ kind: "spin", ms: 300 })
    const started = performance.now()
    await Bun.sleep(10)
    // The timer fires on time: the 300 ms of work is not on this thread.
    expect(performance.now() - started).toBeLessThan(150)
    expect(await busy).toBe("spun")
  })

  test("a task that overruns fails, and its thread is replaced", async () => {
    pool = createWorkerPool({ url, size: 1, taskTimeoutMs: 50 })
    expect(await code(pool.run({ kind: "spin", ms: 500 }))).toBe("timeout")
    expect(await pool.run({ kind: "echo", value: "after" })).toBe("after")
  })

  test("a crashed thread fails its tasks and the next task gets a new one", async () => {
    pool = createWorkerPool({ url, size: 1, taskTimeoutMs: 5000 })
    expect(await code(pool.run({ kind: "crash" }))).toBe("worker_crashed")
    expect(await pool.run({ kind: "echo", value: "again" })).toBe("again")
  })
})

describe("payload workers", () => {
  test("parse a gzipped debugger payload, and tell broken from too large", async () => {
    const payload = { capturedAt: 1_700_000_000_000, events: [{ kind: "console", t: 1, level: "error", args: ["boom"] }] }
    const parsed = await parseDebuggerView(new Blob([Bun.gzipSync(JSON.stringify(payload))]))
    expect(parsed.bytes).toBe(JSON.stringify(payload).length)
    expect(parsed.view.events.length).toBe(1)

    const broken = await parseDebuggerView(new Blob([new Uint8Array([1, 2, 3])])).catch((error: unknown) => error)
    expect(broken).toBeInstanceOf(PayloadError)
    expect((broken as PayloadError).reason).toBe("unreadable")

    const huge = Bun.gzipSync("x".repeat(17 * 1024 * 1024))
    const tooLarge = await parseDebuggerView(new Blob([huge])).catch((error: unknown) => error)
    expect((tooLarge as PayloadError).reason).toBe("too_large")
  })
})
