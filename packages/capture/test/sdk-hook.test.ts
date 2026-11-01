import { describe, expect, test } from "bun:test"
import type { CaptureEvent } from "../src/events"
import { installSdkHook, SDK_GLOBAL_KEY, type SdkHost } from "../src/hooks/sdk"
import { MAX_ARG_CHARS } from "../src/limits"

const STACK = "Error\n    at pay (https://shop.test/checkout.js:40:3)"
const queued = (host: SdkHost) => (host as Record<string, { queue: unknown[]; push: (entry: unknown) => void }>)[SDK_GLOBAL_KEY]!

function hostWithQueue(entries: unknown[]): SdkHost {
  const host: SdkHost = {}
  ;(host as Record<string, unknown>)[SDK_GLOBAL_KEY] = { v: 1, metadata: null, queue: [...entries], push: (entry: unknown) => queued(host).queue.push(entry) }
  return host
}

describe("installSdkHook", () => {
  test("drains queued entries into sdk events, keeping their own time", () => {
    const events: CaptureEvent[] = []
    const host = hostWithQueue([{ t: 500, level: "info", message: "Checkout started", data: { orderId: 8812 }, stack: STACK }])
    installSdkHook(host, (event) => events.push(event), () => 9000)
    expect(events).toEqual([{ kind: "sdk", t: 500, level: "info", message: "Checkout started", data: '{"orderId":8812}', stack: STACK, source: "checkout.js:40" }])
    expect(queued(host).queue).toEqual([])
  })

  test("later pushes go straight to emit", () => {
    const events: CaptureEvent[] = []
    const host = hostWithQueue([])
    installSdkHook(host, (event) => events.push(event), () => 9000)
    queued(host).push({ t: 600, level: "error", message: "Payment declined" })
    expect(events).toEqual([{ kind: "sdk", t: 600, level: "error", message: "Payment declined" }])
    expect(queued(host).queue).toEqual([])
  })

  test("creates the global when the SDK has not run yet", () => {
    const events: CaptureEvent[] = []
    const host: SdkHost = {}
    installSdkHook(host, (event) => events.push(event), () => 9000)
    queued(host).push({ t: 1, level: "warn", message: "late" })
    expect(events).toHaveLength(1)
  })

  test("bad entries are coerced: missing t, unknown level, non-string message, huge data", () => {
    const events: CaptureEvent[] = []
    const host = hostWithQueue([{ level: "verbose", message: 42, data: "x".repeat(1024 * 1024) }])
    installSdkHook(host, (event) => events.push(event), () => 9000)
    const [event] = events as [Extract<CaptureEvent, { kind: "sdk" }>]
    expect(event).toMatchObject({ t: 9000, level: "info", message: "42" })
    expect(event.data!.length).toBeLessThan(MAX_ARG_CHARS + 40)
    expect(event.data).toContain("…[truncated")
  })

  test("an undefined message reads \"undefined\"", () => {
    const events: CaptureEvent[] = []
    installSdkHook(hostWithQueue([{ t: 1, level: "info", message: undefined }]), (event) => events.push(event), () => 9000)
    expect(events).toEqual([{ kind: "sdk", t: 1, level: "info", message: "undefined" }])
  })

  test("entries that are not objects are ignored", () => {
    const events: CaptureEvent[] = []
    const host = hostWithQueue(["junk", null, 7])
    installSdkHook(host, (event) => events.push(event), () => 9000)
    expect(events).toEqual([])
  })

  test("uninstall puts a queueing push back", () => {
    const events: CaptureEvent[] = []
    const host = hostWithQueue([])
    const uninstall = installSdkHook(host, (event) => events.push(event), () => 9000)
    uninstall()
    queued(host).push({ t: 1, level: "info", message: "after stop" })
    expect(events).toEqual([])
    expect(queued(host).queue).toHaveLength(1)
  })

  test("uninstall on a global capture created still queues, at most 50", () => {
    const host: SdkHost = {}
    installSdkHook(host, () => {}, () => 9000)()
    for (let n = 0; n < 55; n++) queued(host).push({ t: n, level: "info", message: `m${n}` })
    expect(queued(host).queue).toHaveLength(50)
  })

  test("throws on a host whose global is unusable", () => {
    const text: SdkHost = {}
    ;(text as Record<string, unknown>)[SDK_GLOBAL_KEY] = "nope"
    expect(() => installSdkHook(text, () => {}, () => 0)).toThrow()
    expect(() => installSdkHook(Object.freeze({}) as SdkHost, () => {}, () => 0)).toThrow()
    const frozen: SdkHost = {}
    ;(frozen as Record<string, unknown>)[SDK_GLOBAL_KEY] = Object.freeze({ v: 1, metadata: null, queue: [], push() {} })
    expect(() => installSdkHook(frozen, () => {}, () => 0)).toThrow()
  })
})
