import { describe, expect, mock, test } from "bun:test"
import { watchRecording } from "../../lib/recording/recording-watch"

const noChanges = { addListener: () => {} }

describe("watchRecording", () => {
  test("reads the recording state from session storage", async () => {
    const onChange = mock()
    watchRecording({ get: async () => ({ recording: { pausedAt: 5 } }) }, noChanges, onChange)
    await Bun.sleep(1)
    expect(onChange).toHaveBeenCalledWith(true, true, true)
  })

  test("follows later changes in the session area only", () => {
    const onChange = mock()
    let listener: ((changes: Record<string, { newValue?: unknown }>, area: string) => void) | undefined
    watchRecording({ get: async () => ({}) }, { addListener: (added) => void (listener = added) }, onChange)
    listener?.({ recording: { newValue: { pausedAt: null } } }, "local")
    expect(onChange).not.toHaveBeenCalledWith(true, false, false)
    listener?.({ recording: { newValue: { pausedAt: null } } }, "session")
    expect(onChange).toHaveBeenCalledWith(true, false, false)
  })

  test("without session storage it always flushes", async () => {
    const missing = mock()
    watchRecording(undefined, noChanges, missing)
    expect(missing).toHaveBeenCalledWith(true, true, false)

    const refused = mock()
    watchRecording({ get: async () => Promise.reject(new Error("not allowed")) }, noChanges, refused)
    await Bun.sleep(1)
    expect(refused).toHaveBeenCalledWith(true, true, false)
  })
})
