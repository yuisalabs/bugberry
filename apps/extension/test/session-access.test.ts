import { describe, expect, mock, test } from "bun:test"
import { openSessionToContentScripts } from "../lib/session-access"

describe("openSessionToContentScripts", () => {
  test("opens session storage to content scripts where the browser can", () => {
    const setAccessLevel = mock(async () => {})
    openSessionToContentScripts({ setAccessLevel })
    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
  })

  test("Firefox has no setAccessLevel: nothing throws, so the rest of the background still starts", () => {
    expect(() => openSessionToContentScripts({})).not.toThrow()
    expect(() => openSessionToContentScripts(undefined)).not.toThrow()
  })

  test("a refusal is swallowed", async () => {
    openSessionToContentScripts({ setAccessLevel: () => Promise.reject(new Error("no")) })
    await Bun.sleep(1)
  })
})
