import type { ArmedTab } from "./armed-state"

export const ARMED_COLOR = "#2563eb"
export const DEGRADED_COLOR = "#d97706"

/** null text gives the tab back to the global badge, so a paused tab shows REC like every other tab while recording. */
export function badgeFor(tab: ArmedTab | null): { text: string | null; color: string } {
  if (!tab || tab.suspended) return { text: null, color: ARMED_COLOR }
  return { text: `${tab.windowMs / 1000}s`, color: tab.degraded ? DEGRADED_COLOR : ARMED_COLOR }
}

export function createReplayBadge(action: {
  setBadgeText(details: { tabId: number; text: string | null }): Promise<void>
  setBadgeBackgroundColor(details: { tabId: number; color: string }): Promise<void>
}): (tabId: number, tab: ArmedTab | null) => Promise<void> {
  return async (tabId, tab) => {
    const { text, color } = badgeFor(tab)
    try {
      await action.setBadgeText({ tabId, text })
      if (text !== null) await action.setBadgeBackgroundColor({ tabId, color })
    } catch {
      // The tab may be gone.
    }
  }
}
