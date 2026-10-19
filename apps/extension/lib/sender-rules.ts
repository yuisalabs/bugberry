interface Sender {
  id?: string
  url?: string
  tab?: { id?: number }
}

/** One of this extension's own pages (bar, drawing layer, review), not a content script or another extension. */
export function fromExtensionPage(sender: Sender, extensionId: string): boolean {
  return sender.id === extensionId && typeof sender.url === "string" && sender.url.startsWith(`chrome-extension://${extensionId}/`)
}

/**
 * The bar and the drawing layer, inside the tab being recorded. The same pages embedded by another site (they
 * are web accessible) sit in another tab, so they can't stop the recording or turn the microphone on.
 */
export function fromRecordedTab(sender: Sender, extensionId: string, recordedTabId: number | null): boolean {
  return fromExtensionPage(sender, extensionId) && recordedTabId !== null && sender.tab?.id === recordedTabId
}

/** A bar request for the running recording: the recorded tab's own frame, naming that recording. */
export function ofThisRecording(
  sender: Sender,
  extensionId: string,
  state: { tabId: number; draftId: string } | null,
  session: string,
): boolean {
  return state !== null && fromRecordedTab(sender, extensionId, state.tabId) && session === state.draftId
}
