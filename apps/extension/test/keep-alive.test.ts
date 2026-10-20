import { expect, mock, test } from "bun:test"
import { KEEP_ALIVE_MS, keepBackgroundAwake } from "../lib/keep-alive"

test("pings the background on an interval until stopped", () => {
  let tick: (() => void) | undefined
  const cancel = mock()
  const send = mock(async () => {})
  const stop = keepBackgroundAwake(send, (run, ms) => {
    expect(ms).toBe(KEEP_ALIVE_MS)
    tick = run
    return cancel
  })
  tick?.()
  tick?.()
  expect(send).toHaveBeenCalledTimes(2)
  stop()
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(KEEP_ALIVE_MS).toBeLessThan(30_000)
})
