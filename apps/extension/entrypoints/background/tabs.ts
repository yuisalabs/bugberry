import { type Browser, browser } from "wxt/browser"
import type { ActiveTab } from "../../lib/capture/capture-flow"

export function toActiveTab(tab: Browser.tabs.Tab | undefined): ActiveTab | null {
  if (tab?.id === undefined || tab.windowId === undefined) return null
  return {
    id: tab.id,
    windowId: tab.windowId,
    active: tab.active,
    url: tab.url,
    title: tab.title,
    width: tab.width,
    height: tab.height,
  }
}

/**
 * Runs in the page's MAIN world: must be self-contained. During a recording `keep` leaves out events from
 * before the take and from its pauses before the 1000-event cut, so they don't push out the ones kept.
 */
function readCaptureSession(keep: { since: number; pauses: Array<{ start: number; end: number }> } | null) {
  const key = Symbol.for("bugberry.capture.session")
  const session = (window as unknown as Record<symbol, { snapshot(): unknown[]; incomplete: readonly string[] } | undefined>)[key]
  const kept = (event: unknown) => {
    const t = (event as { t?: unknown }).t
    if (!keep || typeof t !== "number") return true
    return t >= keep.since && !keep.pauses.some((pause) => t >= pause.start && t < pause.end)
  }
  // 1000 = BUFFER_MAX_EVENTS; this function runs in the page and cannot import it.
  return session
    ? {
        status: "ok",
        events: session.snapshot().filter(kept).slice(-1000),
        incomplete: [...session.incomplete],
        documentId: (session as { documentId?: unknown }).documentId,
      }
    : { status: "missing" }
}

/** Runs in the page's MAIN world: must be self-contained. The extension checks every field it returns. */
async function readEnvironment() {
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; rtt?: number }
    userAgentData?: { getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>> }
  }
  const uaData = await nav.userAgentData?.getHighEntropyValues(["fullVersionList", "platformVersion"]).catch(() => undefined)
  return {
    language: nav.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pixelRatio: window.devicePixelRatio,
    connection: nav.connection
      ? { effectiveType: nav.connection.effectiveType, downlink: nav.connection.downlink, rtt: nav.connection.rtt }
      : undefined,
    uaData,
  }
}

export const readPageCapture = async (tabId: number, keep?: { since: number; pauses: Array<{ start: number; end: number }> }) => {
  const [injection] = await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: readCaptureSession,
    // An open pause has no end yet: JSON can't carry Infinity, so it is sent as "until now".
    args: [keep ? { since: keep.since, pauses: keep.pauses.map((pause) => ({ start: pause.start, end: Math.min(pause.end, Date.now()) })) } : null],
  })
  return injection?.result
}
export const readPageEnvironment = async (tabId: number) => {
  const [injection] = await browser.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readEnvironment })
  return injection?.result
}
