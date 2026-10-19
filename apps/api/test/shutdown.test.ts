import { describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import { installShutdown } from "../src/lib/shutdown"

const quiet = { info: () => {}, error: () => {} }

describe("installShutdown", () => {
  test("SIGTERM stops the server once, then exits 0", async () => {
    const signals = new EventEmitter()
    const stop = mock(async () => {})
    const exit = mock((_code: number) => {})
    installShutdown(signals, stop, exit, quiet)

    signals.emit("SIGTERM")
    signals.emit("SIGINT")
    await Bun.sleep(0)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  test("a failing stop still exits, with code 1", async () => {
    const signals = new EventEmitter()
    const exit = mock((_code: number) => {})
    installShutdown(
      signals,
      async () => {
        throw new Error("db close failed")
      },
      exit,
      quiet,
    )
    signals.emit("SIGINT")
    await Bun.sleep(0)
    expect(exit).toHaveBeenCalledWith(1)
  })
})
