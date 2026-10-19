import { describe, expect, test } from "bun:test"
import { createEventBuffer } from "../src/buffer"
import type { CaptureEvent, NetworkEvent } from "../src/events"
import { MAX_RESOURCE_EVENTS } from "../src/limits"

const log = (t: number, text = "x"): CaptureEvent => ({ kind: "console", t, level: "log", args: [text] })

const resource = (t: number): CaptureEvent => ({ kind: "resource", t, url: `https://shop.test/${t}.png`, initiatorType: "img" })
const click = (t: number): CaptureEvent => ({ kind: "action", t, type: "click", target: "button" })

describe("createEventBuffer", () => {
  test("resources never push out logs, errors or actions", () => {
    const buffer = createEventBuffer({ maxEvents: 10, now: () => 1000 })
    for (const t of [1, 2, 3]) buffer.push(log(t))
    for (let t = 10; t < 40; t++) buffer.push(resource(t))
    buffer.push(click(50))
    buffer.push(click(51))
    const kept = buffer.snapshot()
    expect(kept).toHaveLength(10)
    expect(kept.filter((event) => event.kind === "console")).toHaveLength(3)
    expect(kept.filter((event) => event.kind === "action")).toHaveLength(2)
    expect(kept.filter((event) => event.kind === "resource").map((event) => event.t)).toEqual([35, 36, 37, 38, 39])
  })

  test("at most MAX_RESOURCE_EVENTS resources are kept, newest first", () => {
    const buffer = createEventBuffer({ maxEvents: 1000, now: () => 1000 })
    for (let t = 0; t < MAX_RESOURCE_EVENTS + 20; t++) buffer.push(resource(t))
    const kept = buffer.snapshot()
    expect(MAX_RESOURCE_EVENTS).toBe(300)
    expect(kept).toHaveLength(300)
    expect(kept[0]?.t).toBe(20)
  })

  test("snapshot is ordered by event time even when events arrive out of order", () => {
    const buffer = createEventBuffer({ now: () => 100 })
    buffer.push(log(50, "later"))
    buffer.push(log(10, "earlier"))
    expect(buffer.snapshot().map((event) => event.t)).toEqual([10, 50])
  })

  test("has() tells whether an event is still kept", () => {
    let now = 0
    const buffer = createEventBuffer({ maxAgeMs: 1000, maxEvents: 2, now: () => now })
    const first = log(0)
    buffer.push(first)
    expect(buffer.has(first)).toBe(true)
    buffer.push(log(0))
    buffer.push(log(0))
    expect(buffer.has(first)).toBe(false)

    const recent = log(500)
    buffer.push(recent)
    now = 2000
    expect(buffer.has(recent)).toBe(false)
  })

  test("drops events older than the maximum age", () => {
    let now = 0
    const buffer = createEventBuffer({ maxAgeMs: 1000, now: () => now })
    buffer.push(log(0))
    now = 900
    buffer.push(log(900))
    now = 1500
    expect(buffer.snapshot().map((event) => event.t)).toEqual([900])
  })

  test("keeps at most maxEvents, dropping the oldest pushed", () => {
    const buffer = createEventBuffer({ maxEvents: 3, now: () => 10 })
    for (let i = 1; i <= 5; i++) buffer.push(log(i, `#${i}`))
    expect(buffer.size).toBe(3)
    expect(buffer.snapshot().map((event) => (event.kind === "console" ? event.args[0] : ""))).toEqual(["#3", "#4", "#5"])
  })

  test("snapshots are copies, but later updates to a pushed event are reflected", () => {
    const buffer = createEventBuffer({ now: () => 10 })
    const request: NetworkEvent = { kind: "network", t: 5, method: "GET", url: "https://a.test/" }
    buffer.push(request)
    const first = buffer.snapshot()
    ;(first[0] as NetworkEvent).url = "mutated"
    request.responseBody = "filled in later"
    const second = buffer.snapshot()[0] as NetworkEvent
    expect(second.url).toBe("https://a.test/")
    expect(second.responseBody).toBe("filled in later")
  })

  test("clear empties the buffer", () => {
    const buffer = createEventBuffer()
    buffer.push(log(Date.now()))
    buffer.clear()
    expect(buffer.snapshot()).toEqual([])
  })
})
