import { describe, expect, test } from "bun:test"
import type { ReplayEvent } from "@bugberry/shared"
import { createReplayBuffer, eventBytes } from "../../lib/replay/replay-buffer"

const meta = (timestamp: number): ReplayEvent => ({ type: 4, timestamp, data: {} })
const snap = (timestamp: number): ReplayEvent => ({ type: 2, timestamp, data: {} })
const inc = (timestamp: number): ReplayEvent => ({ type: 3, timestamp, data: {} })
const big = (timestamp: number, n: number): ReplayEvent => ({ type: 3, timestamp, data: { s: "x".repeat(n) } })

describe("the replay buffer", () => {
  test("keeps the two most recent segments", () => {
    const b = createReplayBuffer({ maxBytes: 1 << 20 })
    b.push(meta(0), true)
    b.push(snap(0), true)
    b.push(inc(1_000), false)
    b.push(meta(60_000), true)
    b.push(snap(60_000), true)
    b.push(meta(120_000), true)
    b.push(snap(120_000), true)
    b.push(inc(121_000), false)
    const s = b.snapshot()
    expect(s.since).toBe(60_000)
    expect(s.events.map((e) => e.timestamp)).toEqual([60_000, 60_000, 120_000, 120_000, 121_000])
  })

  test("a segment starts at a Meta event, whatever isCheckout says; events before the first are dropped", () => {
    const b = createReplayBuffer({ maxBytes: 1 << 20 })
    b.push(inc(500), false)
    // rrweb's first emit is a Meta event without isCheckout, and a checkout's FullSnapshot carries isCheckout too.
    b.push(meta(1_000), false)
    b.push(snap(1_000), true)
    b.push(inc(2_000), false)
    expect(b.snapshot().events.map((e) => e.type)).toEqual([4, 2, 3])
    expect(b.lastCheckoutAt()).toBe(1_000)
  })

  test("over the byte cap the oldest segment goes and the buffer is degraded until a checkout that fits", () => {
    const b = createReplayBuffer({ maxBytes: 300 })
    b.push(meta(0), true)
    b.push(big(0, 200), false)
    b.push(meta(5_000), true)
    expect(b.degraded()).toBe(true)
    expect(b.snapshot().since).toBe(5_000)
    b.push(inc(6_000), false)
    b.push(meta(10_000), true)
    expect(b.degraded()).toBe(false)
    expect(b.snapshot().since).toBe(5_000)
  })

  test("a lone segment over the cap is kept whole and says so", () => {
    const b = createReplayBuffer({ maxBytes: 100 })
    b.push(meta(0), true)
    b.push(big(0, 200), false)
    expect(b.overCap()).toBe(true)
    expect(b.snapshot().events).toHaveLength(2)
  })

  test("snapshot reports the bytes held; an empty buffer has nothing", () => {
    const b = createReplayBuffer({ maxBytes: 1 << 20 })
    expect(b.snapshot()).toEqual({ events: [], since: 0, bytes: 0, degraded: false })
    expect(b.lastCheckoutAt()).toBeNull()
    b.push(meta(0), true)
    b.push(inc(1), false)
    expect(b.snapshot().bytes).toBe(eventBytes(meta(0)) + eventBytes(inc(1)))
  })

  test("clear empties it", () => {
    const b = createReplayBuffer({ maxBytes: 1 << 20 })
    b.push(meta(0), true)
    b.clear()
    expect(b.snapshot().events).toEqual([])
  })
})
