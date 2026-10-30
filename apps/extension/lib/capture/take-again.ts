import type { ActiveTab, CaptureResult } from "./capture-flow"
import type { ScreenshotMode } from "./capture-prefs"
import type { ReportDraft } from "../shared/types"

export interface TakeAgainDeps {
  getDraft(id: string): Promise<ReportDraft | null>
  getTab(tabId: number): Promise<ActiveTab | null>
  deleteDraft(id: string): Promise<void>
  /** Takes the review off the page, so the next capture doesn't show it. */
  hideReview(tabId: number): Promise<void>
  showReview(draftId: string, tabId: number): Promise<void>
  screenshot(tab: ActiveTab, mode: ScreenshotMode): Promise<CaptureResult>
  record(tab: ActiveTab): Promise<CaptureResult>
}

/**
 * "Record again" and "Retake": the same kind of capture on the draft's tab. The old draft is deleted only
 * once the new capture started; if it can't (another recording runs, the picker was cancelled), the old
 * review comes back, so nothing is lost.
 */
export function createTakeAgain(deps: TakeAgainDeps): (draftId: string) => Promise<CaptureResult> {
  return async (draftId) => {
    const draft = await deps.getDraft(draftId)
    if (!draft) return { ok: false, error: "This report is gone" }
    if (draft.tabId === undefined) return { ok: false, error: "The page this came from isn't known. Start again from the BugBerry icon." }
    const tab = await deps.getTab(draft.tabId)
    if (!tab) return { ok: false, error: "The page this came from was closed." }
    await deps.hideReview(tab.id)
    const result = draft.captureType === "screenshot" ? await deps.screenshot(tab, draft.screenshotMode ?? "visible") : await deps.record(tab)
    if (result.ok) await deps.deleteDraft(draftId)
    else await deps.showReview(draftId, tab.id)
    return result
  }
}
