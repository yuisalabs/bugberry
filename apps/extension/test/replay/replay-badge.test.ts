import { describe, expect, mock, test } from "bun:test"
import { ARMED_COLOR, badgeFor, createReplayBadge, DEGRADED_COLOR } from "../../lib/replay/replay-badge"

const armed = { windowMs: 60_000 as const, since: 0, degraded: false, suspended: false }

describe("the replay badge", () => {
  test("an armed tab shows its window in blue; a full buffer turns it amber", () => {
    expect(badgeFor(armed)).toEqual({ text: "60s", color: ARMED_COLOR })
    expect(ARMED_COLOR).toBe("#2563eb")
    expect(badgeFor({ ...armed, degraded: true })).toEqual({ text: "60s", color: DEGRADED_COLOR })
    expect(DEGRADED_COLOR).toBe("#d97706")
  })

  test("not armed or paused gives the tab back to the global badge (REC while recording)", () => {
    expect(badgeFor(null).text).toBeNull()
    expect(badgeFor({ ...armed, suspended: true }).text).toBeNull()
  })

  test("writes the text and colour for that tab only", async () => {
    const action = { setBadgeText: mock(async () => {}), setBadgeBackgroundColor: mock(async () => {}) }
    await createReplayBadge(action)(3, armed)
    expect(action.setBadgeText).toHaveBeenCalledWith({ tabId: 3, text: "60s" })
    expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 3, color: ARMED_COLOR })
    await createReplayBadge(action)(3, null)
    expect(action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 3, text: null })
  })

  test("a closed tab is not an error", async () => {
    const action = { setBadgeText: mock(async () => Promise.reject(new Error("No tab with id: 3"))), setBadgeBackgroundColor: mock(async () => {}) }
    await expect(createReplayBadge(action)(3, armed)).resolves.toBeUndefined()
  })
})
