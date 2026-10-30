import type { CaptureResult } from "../capture/capture-flow"

export interface BadgeAction {
  /** `null` gives the tab back to the global badge text (REC while recording). */
  setBadgeText(details: { tabId: number; text: string | null }): Promise<void>
  setTitle(details: { tabId: number; title: string }): Promise<void>
}

const DEFAULT_TITLE = "BugBerry"

/**
 * Failures from a shortcut or a background stop have no popup to show them, so they go on the tab's
 * badge as "!" with the message as the icon title. The next success on that tab clears it again.
 */
export function createFailureFlag(action: BadgeAction) {
  return async <T extends CaptureResult>(tabId: number, result: T): Promise<T> => {
    // A second "record" while recording is refused on purpose, and a cancel is the reporter's choice.
    if (!result.ok && (result.code === "already-recording" || result.code === "cancelled")) return result
    try {
      if (result.ok) {
        await action.setBadgeText({ tabId, text: null })
        await action.setTitle({ tabId, title: DEFAULT_TITLE })
      } else {
        await action.setBadgeText({ tabId, text: "!" })
        await action.setTitle({ tabId, title: result.error })
      }
    } catch {
      // The tab may be gone.
    }
    return result
  }
}
