import { BRIDGE_HELLO, BRIDGE_OPEN_POPUP, BRIDGE_POPUP, BRIDGE_STATUS, BRIDGE_USE_SERVER } from "@bugberry/shared"

/** The slice of `window` the bridge needs; tests pass a fake. */
export interface BridgeWindow {
  location: { origin: string }
  postMessage(message: unknown, targetOrigin: string): void
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void
}

export type ExtensionAnswer = { installed: false } | { installed: true; active: boolean; version: string | null }

/**
 * Asks the BugBerry extension (through its content script) whether it sends reports to this server.
 * No answer in time means it is not installed; it never answers pages that are not BugBerry servers.
 */
export function askExtension(target: BridgeWindow, timeoutMs = 800): Promise<ExtensionAnswer> {
  return new Promise((resolve) => {
    const finish = (answer: ExtensionAnswer) => {
      clearTimeout(timer)
      target.removeEventListener("message", onMessage)
      resolve(answer)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== target) return
      const data = event.data as { type?: unknown; active?: unknown; version?: unknown } | null
      if (data?.type !== BRIDGE_STATUS || typeof data.active !== "boolean") return
      finish({ installed: true, active: data.active, version: typeof data.version === "string" ? data.version : null })
    }
    const timer = setTimeout(() => finish({ installed: false }), timeoutMs)
    target.addEventListener("message", onMessage)
    target.postMessage({ type: BRIDGE_HELLO }, target.location.origin)
  })
}

/**
 * Asks the extension to open its toolbar popup ("New report"). It does so only for the server it sends
 * to, right after a click; false means it did not (not installed, another server, or an old Chrome).
 */
export function openExtensionPopup(target: BridgeWindow, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (opened: boolean) => {
      clearTimeout(timer)
      target.removeEventListener("message", onMessage)
      resolve(opened)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== target) return
      const data = event.data as { type?: unknown; opened?: unknown } | null
      if (data?.type === BRIDGE_POPUP) finish(data.opened === true)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    target.addEventListener("message", onMessage)
    target.postMessage({ type: BRIDGE_OPEN_POPUP }, target.location.origin)
  })
}

/** The extension then opens its own confirmation page; nothing changes until the person confirms there. */
export function useServerInExtension(target: BridgeWindow): void {
  target.postMessage({ type: BRIDGE_USE_SERVER }, target.location.origin)
}
