import { capturable } from "./capture-flow"

/**
 * After an install, update or reload, adds the capture scripts to the web pages already open: Chrome gives tabs open
 * from before only the scripts of the next page load, so until then their reports would come without console, network
 * or actions. What happened before this point is not recovered. A page that kept a session from an older version
 * keeps it (startCapture returns the one it finds).
 */
export async function reinjectCapture(deps: {
  tabs(): Promise<Array<{ id?: number; url?: string }>>
  inject(tabId: number): Promise<void>
}): Promise<void> {
  for (const tab of await deps.tabs()) {
    if (tab.id !== undefined && capturable(tab.url)) await deps.inject(tab.id).catch(() => {})
  }
}

/** Runs in the page's MAIN world: must be self-contained. Whether the capture script is recording this page. */
export function captureRunning(): boolean {
  return Boolean((globalThis as unknown as Record<symbol, unknown>)[Symbol.for("bugberry.capture.session")])
}
