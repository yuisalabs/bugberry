const ANSWER_MS = 1000

/**
 * Opens the review: over the page when its page layer answers, else in a tab of its own (the tab was
 * closed, or it is a page extensions can't script: a new tab, chrome://, the Web Store, a PDF).
 */
export function createReviewOpener(deps: {
  /** Rejects when no content script answers. */
  sendToTab(tabId: number, message: unknown): Promise<unknown>
  openTab(url: string): Promise<void>
  /** Brings the tab (and its window) to the front: the reporter may be in another tab or app. */
  focusTab(tabId: number): Promise<void>
  reviewUrl(draftId: string): string
  timeoutMs?: number
}): (draftId: string, tabId: number) => Promise<void> {
  return async (draftId, tabId) => {
    await deps.focusTab(tabId).catch(() => {})
    let timer: ReturnType<typeof setTimeout> | undefined
    const answer = await Promise.race([
      deps.sendToTab(tabId, { type: "bugberry:ui-review", draftId }).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deps.timeoutMs ?? ANSWER_MS)
      }),
    ])
    clearTimeout(timer)
    if ((answer as { ok?: unknown } | null)?.ok === true) return
    // A page that answers after all would show the modal too: it is taken off before the tab opens.
    void deps.sendToTab(tabId, { type: "bugberry:ui-review-close" }).catch(() => {})
    await deps.openTab(deps.reviewUrl(draftId))
  }
}
