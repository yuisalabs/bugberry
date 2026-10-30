import { describe, expect, test } from "bun:test"
import { createFailureFlag } from "../../lib/platform/badge"

function fakeAction() {
  const calls: Array<{ method: string; details: Record<string, unknown> }> = []
  return {
    calls,
    action: {
      setBadgeText: async (details: { tabId: number; text: string | null }) => void calls.push({ method: "text", details }),
      setTitle: async (details: { tabId: number; title: string }) => void calls.push({ method: "title", details }),
    },
  }
}

describe("createFailureFlag", () => {
  test("marks a failure with ! and its message, then clears it after the next success on that tab", async () => {
    const { calls, action } = fakeAction()
    const flag = createFailureFlag(action)
    await flag(7, { ok: false, error: "This tab can't be recorded" })
    expect(calls).toEqual([
      { method: "text", details: { tabId: 7, text: "!" } },
      { method: "title", details: { tabId: 7, title: "This tab can't be recorded" } },
    ])

    calls.length = 0
    await flag(7, { ok: true, draftId: "d1" })
    // null hands the tab back to the global badge (REC while recording), "" would hide it.
    expect(calls).toEqual([
      { method: "text", details: { tabId: 7, text: null } },
      { method: "title", details: { tabId: 7, title: "BugBerry" } },
    ])
  })

  test("a refused second recording is not a failure to flag", async () => {
    const { calls, action } = fakeAction()
    await createFailureFlag(action)(7, { ok: false, error: "Already recording", code: "already-recording" })
    expect(calls).toEqual([])
  })

  test("a cancelled share picker is not a failure to flag", async () => {
    const { calls, action } = fakeAction()
    await createFailureFlag(action)(7, { ok: false, error: "Cancelled", code: "cancelled" })
    expect(calls).toEqual([])
  })
})
