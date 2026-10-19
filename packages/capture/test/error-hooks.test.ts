import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import type { CaptureEvent } from "../src/events"
import { type ErrorHost, installErrorHooks } from "../src/hooks/errors"

let win: Window
let events: CaptureEvent[]
let uninstall: () => void

beforeEach(() => {
  win = new Window({ url: "https://app.kantor.test/" })
  events = []
  uninstall = installErrorHooks(win as unknown as ErrorHost, (event) => events.push(event), () => 500)
})

afterEach(async () => {
  uninstall()
  await win.happyDOM.close()
})

describe("installErrorHooks", () => {
  test("records uncaught errors with their source and stack", () => {
    const error = new Error("boom")
    win.dispatchEvent(
      new win.ErrorEvent("error", { message: "Uncaught Error: boom", filename: "https://app.kantor.test/app.js", lineno: 3, colno: 9, error }),
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: "error",
      t: 500,
      message: "Uncaught Error: boom",
      source: "https://app.kantor.test/app.js:3:9",
    })
    expect(events[0]?.kind === "error" && events[0].stack).toContain("boom")
  })

  test("records unhandled promise rejections, with Error or plain reasons", () => {
    for (const reason of [new Error("nope"), { code: 42 }]) {
      const event = new win.Event("unhandledrejection")
      Object.defineProperty(event, "reason", { value: reason })
      win.dispatchEvent(event)
    }
    expect(events.map((event) => event.kind === "error" && event.message)).toEqual([
      "Unhandled rejection: nope",
      'Unhandled rejection: {"code":42}',
    ])
  })

  test("a rejection with a stack says where it came from", () => {
    const reason = new Error("nope")
    reason.stack = ["Error: nope", "    at load (https://app.kantor.test/js/data.js:41:7)"].join("\n")
    const event = new win.Event("unhandledrejection")
    Object.defineProperty(event, "reason", { value: reason })
    win.dispatchEvent(event)
    expect(events[0]).toMatchObject({ source: "data.js:41" })
  })

  test("uninstall stops recording", () => {
    uninstall()
    win.dispatchEvent(new win.ErrorEvent("error", { message: "late" }))
    expect(events).toHaveLength(0)
  })
})
