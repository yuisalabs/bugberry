import { describe, expect, test } from "bun:test"
import { SDK_GLOBAL_KEY, type SdkHost } from "../src/hooks/sdk"
import { MAX_ARG_CHARS, MAX_METADATA_CHARS } from "../src/limits"
import { boundMetadata, NO_METADATA, readMetadata } from "../src/metadata"

const hostWith = (metadata: unknown): SdkHost => ({ [SDK_GLOBAL_KEY]: { v: 1, metadata, queue: [], push() {} } }) as SdkHost

describe("readMetadata", () => {
  test("no SDK, or no callback, is not an error", () => {
    expect(readMetadata({})).toEqual(NO_METADATA)
    expect(readMetadata(hostWith(null))).toEqual(NO_METADATA)
  })
  test("returns the callback's object", () => {
    expect(readMetadata(hostWith(() => ({ userId: "u1", flags: { newCheckout: true } })))).toEqual({
      fields: { userId: "u1", flags: { newCheckout: true } }, error: null, droppedKeys: 0,
    })
  })
  test("a throw is reported, cut to 500 chars", () => {
    const snapshot = readMetadata(hostWith(() => { throw new Error("x".repeat(600)) }))
    expect(snapshot.fields).toBeNull()
    expect(snapshot.error?.startsWith("callback threw: xxx")).toBe(true)
    expect(snapshot.error!.length).toBeLessThanOrEqual("callback threw: ".length + 500)
  })
  test("a non-object result is reported by type", () => {
    expect(readMetadata(hostWith(() => [1, 2])).error).toBe("callback returned array, not an object")
    expect(readMetadata(hostWith(() => "s")).error).toBe("callback returned string, not an object")
    expect(readMetadata(hostWith(() => null)).error).toBe("callback returned null, not an object")
    expect(readMetadata(hostWith("not a function")).error).toBe("metadata is not a function")
  })
  test("a Promise, a Map or a class instance is reported by its type, not shown as empty fields", () => {
    class Store { user = "u1" }
    expect(readMetadata(hostWith(async () => ({ userId: "u1" }))).error).toBe("callback returned Promise, not a plain object")
    expect(readMetadata(hostWith(() => new Map([["a", 1]]))).error).toBe("callback returned Map, not a plain object")
    expect(readMetadata(hostWith(() => new Store())).error).toBe("callback returned Store, not a plain object")
    expect(readMetadata(hostWith(() => Object.create(null))).error).toBeNull()
  })
  test("a getter that throws during sanitizing is a thrown callback", () => {
    const value = { get boom(): string { throw new Error("getter") } }
    expect(readMetadata(hostWith(() => value)).error).toBe("callback threw: getter")
  })
  test("a Proxy that throws on enumeration is a thrown callback", () => {
    const hostile = new Proxy({}, { ownKeys() { throw new Error("no keys") } })
    expect(readMetadata(hostWith(() => hostile)).error).toBe("callback threw: no keys")
  })
})

describe("boundMetadata", () => {
  test("redacts sensitive keys at any depth and caps long strings", () => {
    const { fields } = boundMetadata({ user: { token: "abc", name: "x".repeat(MAX_ARG_CHARS + 10) } })
    const user = fields.user as Record<string, string>
    expect(user.token).toBe("[redacted]")
    expect(user.name).toContain("…[truncated 10 chars]")
  })
  test("stops at depth 8 and marks cycles", () => {
    const deep: Record<string, unknown> = {}
    let cursor = deep
    for (let n = 0; n < 10; n++) { cursor.next = {}; cursor = cursor.next as Record<string, unknown> }
    const loop: Record<string, unknown> = { a: 1 }
    loop.self = loop
    expect(JSON.stringify(boundMetadata(deep).fields)).toContain('"[Object]"')
    expect((boundMetadata(loop).fields.self as string)).toBe("[Circular]")
  })
  test("functions, symbols, dates and class instances follow the console-argument rules", () => {
    class Cart { items = 2 }
    const { fields } = boundMetadata({ fn: () => 1, when: new Date(0), cart: new Cart(), sym: Symbol("s") })
    expect(fields).toEqual({ fn: "[Function fn]", when: "1970-01-01T00:00:00.000Z", cart: { items: 2 } })
  })
  test("over 10 KB, whole top-level keys are kept in order and the rest counted", () => {
    const big = "y".repeat(1500)
    const value: Record<string, unknown> = {}
    for (let n = 0; n < 10; n++) value[`k${n}`] = big
    const { fields, droppedKeys } = boundMetadata(value)
    expect(JSON.stringify(fields).length).toBeLessThanOrEqual(MAX_METADATA_CHARS)
    expect(Object.keys(fields)).toEqual(["k0", "k1", "k2", "k3", "k4", "k5"])
    expect(droppedKeys).toBe(4)
  })
  test("the top level keeps every key that fits, with no cut marker", () => {
    const value = Object.fromEntries(Array.from({ length: 300 }, (_, n) => [`k${n}`, n]))
    const { fields, droppedKeys } = boundMetadata(value)
    expect(Object.keys(fields)).toHaveLength(300)
    expect("…" in fields).toBe(false)
    expect(droppedKeys).toBe(0)
  })
  test("keys past the 10 KB budget are counted without being read", () => {
    let reads = 0
    const value: Record<string, unknown> = {}
    for (let n = 0; n < 6; n++) value[`k${n}`] = "x".repeat(2000)
    Object.defineProperty(value, "late", { enumerable: true, get: () => { reads += 1; return 1 } })
    const { fields, droppedKeys } = boundMetadata(value)
    expect(Object.keys(fields)).toEqual(["k0", "k1", "k2", "k3", "k4"])
    expect(droppedKeys).toBe(2)
    expect(reads).toBe(0)
  })
  test("a whole store under one key stops being walked once it is past the budget", () => {
    let reads = 0
    const store: Record<string, unknown> = {}
    for (let a = 0; a < 200; a++) {
      const slice: Record<string, unknown> = {}
      for (let b = 0; b < 200; b++) Object.defineProperty(slice, `f${b}`, { enumerable: true, get: () => { reads += 1; return "y".repeat(100) } })
      store[`s${a}`] = slice
    }
    const { fields, droppedKeys } = boundMetadata({ userId: "u1", store })
    expect(fields).toEqual({ userId: "u1" })
    expect(droppedKeys).toBe(1)
    expect(reads).toBeLessThan(500)
  })
  test("huge nested arrays and objects are cut while walking, not after", () => {
    const { fields } = boundMetadata({ list: Array.from({ length: 5000 }, (_, n) => n) })
    expect((fields.list as unknown[]).length).toBeLessThanOrEqual(101)
  })
})
