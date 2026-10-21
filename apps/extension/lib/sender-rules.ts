interface Sender {
  id?: string
  url?: string
  tab?: { id?: number }
}

/**
 * One of this extension's own pages (bar, drawing layer, review), not a content script or another extension.
 * `extensionOrigin` is `runtime.getURL("")`: Firefox gives every install its own moz-extension:// origin.
 */
export function fromExtensionPage(sender: Sender, extensionId: string, extensionOrigin: string): boolean {
  return sender.id === extensionId && typeof sender.url === "string" && sender.url.startsWith(extensionOrigin)
}

/** The toolbar popup itself: no site can embed it (it isn't web accessible), and it has no tab. */
export function fromPopup(sender: Sender, extensionId: string, extensionOrigin: string): boolean {
  if (!fromExtensionPage(sender, extensionId, extensionOrigin) || sender.tab !== undefined) return false
  return sender.url?.split(/[?#]/)[0] === `${extensionOrigin}popup.html`
}

/**
 * The bar and the drawing layer, inside the tab being recorded. The same pages embedded by another site (they
 * are web accessible) sit in another tab, so they can't stop the recording or turn the microphone on.
 */
export function fromRecordedTab(sender: Sender, extensionId: string, extensionOrigin: string, recordedTabId: number | null): boolean {
  return fromExtensionPage(sender, extensionId, extensionOrigin) && recordedTabId !== null && sender.tab?.id === recordedTabId
}

/** A bar request for the running recording: the recorded tab's own frame, naming that recording. */
export function ofThisRecording(
  sender: Sender,
  extensionId: string,
  extensionOrigin: string,
  state: { tabId: number; draftId: string } | null,
  session: string,
): boolean {
  return state !== null && fromRecordedTab(sender, extensionId, extensionOrigin, state.tabId) && session === state.draftId
}
