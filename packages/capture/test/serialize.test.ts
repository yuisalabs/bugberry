import { describe, expect, test } from "bun:test"
import { stringifyArg } from "../src/serialize"

describe("stringifyArg", () => {
  test("primitives and errors", () => {
    expect(stringifyArg("plain")).toBe("plain")
    expect(stringifyArg(42)).toBe("42")
    expect(stringifyArg(undefined)).toBe("undefined")
    expect(stringifyArg(10n)).toBe("10")
    expect(stringifyArg(new TypeError("bad"))).toBe("TypeError: bad")
    expect(stringifyArg(function handler() {})).toBe("[Function handler]")
  })

  test("objects are JSON with secrets redacted", () => {
    expect(stringifyArg({ user: "ana", token: "t", n: 1n })).toBe('{"user":"ana","token":"[redacted]","n":"1"}')
  })

  test("circular references do not throw", () => {
    const node: Record<string, unknown> = { name: "root" }
    node.self = node
    expect(stringifyArg(node)).toBe('{"name":"root","self":"[Circular]"}')
  })

  test("getters and toJSON are never run", () => {
    let reads = 0
    const hostile = {
      get boom() {
        reads += 1
        throw new Error("getter exploded")
      },
    }
    expect(stringifyArg(hostile)).toBe('{"boom":"[Getter]"}')
    expect(stringifyArg({ toJSON: () => { throw new Error("nope") } })).toBe('{"toJSON":"[Function toJSON]"}')
    expect(reads).toBe(0)
  })

  test("work is bounded for objects with very many keys", () => {
    const wide = Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`k${i}`, { nested: [i, i, i] }]))
    const started = performance.now()
    const text = stringifyArg(wide)
    expect(performance.now() - started).toBeLessThan(200)
    expect(text.length).toBeLessThan(2100)
  })

  test("shared references are not mistaken for cycles", () => {
    const shared = { id: 1 }
    expect(stringifyArg({ a: shared, b: shared })).toBe('{"a":{"id":1},"b":{"id":1}}')
  })

  test("huge arrays and long output are cut", () => {
    const text = stringifyArg(Array.from({ length: 500 }, (_, i) => i))
    expect(text).toContain('"…400 more"')
    expect(stringifyArg("y".repeat(5000)).length).toBeLessThan(2100)
  })

  test("deeply nested objects are summarised", () => {
    let nested: Record<string, unknown> = { leaf: true }
    for (let i = 0; i < 10; i++) nested = { child: nested }
    expect(stringifyArg(nested)).toContain('"[Object]"')
  })
})
