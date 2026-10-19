import { describe, expect, test } from "bun:test"
import type { CaptureEvent } from "../src/events"
import { type ConsoleLike, installConsoleHook } from "../src/hooks/console"

const PAGE_STACK = ["Error", "    at x (chrome-extension://abc/capture.js:1:1)", "    at add (https://shop.test/cart.js:88:3)"].join("\n")

function fakeConsole() {
  const calls: Array<{ level: string; args: unknown[]; self: unknown }> = []
  const target = {} as ConsoleLike
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    target[level] = function (this: unknown, ...args: unknown[]) {
      calls.push({ level, args, self: this })
    }
  }
  return { target, calls }
}

describe("installConsoleHook", () => {
  test("records each level and still calls the original with the same this and args", () => {
    const { target, calls } = fakeConsole()
    const events: CaptureEvent[] = []
    installConsoleHook(target, (event) => events.push(event), () => 1000)
    const payload = { id: 7 }
    target.warn("careful", payload)
    expect(calls).toEqual([{ level: "warn", args: ["careful", payload], self: target }])
    expect(events).toEqual([{ kind: "console", t: 1000, level: "warn", args: ["careful", '{"id":7}'] }])
  })

  test("says which line of the page called it", () => {
    const { target } = fakeConsole()
    const events: CaptureEvent[] = []
    installConsoleHook(target, (event) => events.push(event), () => 1, () => PAGE_STACK)
    target.log("added")
    expect(events[0]).toMatchObject({ kind: "console", args: ["added"], source: "cart.js:88" })
  })

  test("keeps at most 20 arguments per call and says how many were left out", () => {
    const { target, calls } = fakeConsole()
    const events: CaptureEvent[] = []
    installConsoleHook(target, (event) => events.push(event), () => 1)
    const many = Array.from({ length: 1000 }, (_, index) => index)
    target.log(...many)
    expect(calls[0]?.args).toHaveLength(1000)
    const args = events[0]?.kind === "console" ? events[0].args : []
    expect(args).toHaveLength(21)
    expect(args.slice(0, 2)).toEqual(["0", "1"])
    expect(args[20]).toBe("…[980 more arguments]")
  })

  test("a level that cannot be replaced undoes the levels already replaced", () => {
    const { target } = fakeConsole()
    const originals = { ...target }
    Object.defineProperty(target, "warn", { value: target.warn, writable: false })
    expect(() => installConsoleHook(target, () => {}, () => 1)).toThrow()
    expect(target.log).toBe(originals.log)
    expect(target.info).toBe(originals.info)
  })

  test("uninstall leaves a wrapper the page added later in place", () => {
    const { target } = fakeConsole()
    const uninstall = installConsoleHook(target, () => {}, () => 1)
    const ours = target.log
    const pageWrapper = (...args: unknown[]) => ours(...args)
    target.log = pageWrapper
    uninstall()
    expect(target.log).toBe(pageWrapper)
  })

  test("keeps the stack of an Error argument", () => {
    const { target } = fakeConsole()
    const events: CaptureEvent[] = []
    installConsoleHook(target, (event) => events.push(event), () => 1)
    target.error("failed", new Error("boom"))
    const [event] = events
    expect(event?.kind === "console" && event.args).toEqual(["failed", "Error: boom"])
    expect(event?.kind === "console" && event.stack).toContain("boom")
  })

  test("hostile arguments never break the page's console call", () => {
    const { target, calls } = fakeConsole()
    installConsoleHook(target, () => {
      throw new Error("recorder failure")
    }, () => 1)
    const hostile = {
      get explode() {
        throw new Error("getter")
      },
    }
    expect(() => target.log(hostile)).not.toThrow()
    expect(calls).toHaveLength(1)
  })

  test("uninstall restores the original functions", () => {
    const { target } = fakeConsole()
    const original = target.log
    const uninstall = installConsoleHook(target, () => {}, () => 1)
    expect(target.log).not.toBe(original)
    uninstall()
    expect(target.log).toBe(original)
  })
})
