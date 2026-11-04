import { BRIDGE_HELLO, BRIDGE_OPEN_POPUP, BRIDGE_POPUP, BRIDGE_STATUS, BRIDGE_USE_SERVER } from "@bugberry/shared"
import type { BridgeHelloRequest, BridgeOpenPopupRequest, BridgeUseServerRequest } from "../shared/messages"
import type { Settings } from "./settings"
import type { ReportDraft } from "../shared/types"

export interface BridgeDeps {
  isBugBerryServer(origin: string): Promise<boolean>
  currentServer(): Promise<string | null>
  /** Asks over the dashboard's tab (or in a tab of its own); only a click there changes the server. */
  openConfirm(origin: string, tabId: number | null): Promise<void>
  /** Opens the toolbar popup (chrome.action.openPopup, Chrome 127+). */
  openPopup(): Promise<void>
  version(): string
}

/**
 * What a web page may learn from, or ask of, the extension. Pages that are not BugBerry servers get
 * nothing; a BugBerry dashboard learns only whether the extension already sends to it.
 */
export function createBridge(deps: BridgeDeps) {
  const verdicts = new Map<string, Promise<boolean>>()
  const isBugBerry = (origin: string) => {
    let verdict = verdicts.get(origin)
    if (!verdict) {
      verdict = deps.isBugBerryServer(origin).catch(() => false)
      verdicts.set(origin, verdict)
    }
    return verdict
  }

  return {
    async hello(origin: string): Promise<{ active: boolean; version: string } | null> {
      if (!(await isBugBerry(origin))) return null
      return { active: (await deps.currentServer()) === origin, version: deps.version() }
    },
    /** Only the server the extension sends to may open the popup, so a report never goes elsewhere unnoticed. */
    async openPopup(origin: string): Promise<boolean> {
      if (!(await isBugBerry(origin)) || (await deps.currentServer()) !== origin) return false
      try {
        await deps.openPopup()
        return true
      } catch {
        return false
      }
    },
    async useServer(origin: string, tabId: number | null = null): Promise<boolean> {
      if (!(await isBugBerry(origin))) return false
      await deps.openConfirm(origin, tabId)
      return true
    },
  }
}

/** The lines the confirmation page shows under its question. */
export function confirmNotes(
  drafts: ReportDraft[],
  newServer: string,
  currentServer: string | null,
  currentLabel: string,
): string[] {
  const notes: string[] = []
  if (currentServer && currentServer !== newServer) notes.push(`Right now reports go to ${currentLabel}.`)
  const unsent = drafts.filter((draft) => draft.status !== "recording")
  if (unsent.length === 1) notes.push("You have 1 unsent report. It will be sent to the new server.")
  if (unsent.length > 1) notes.push(`You have ${unsent.length} unsent reports. They will be sent to the new server.`)
  // A session without a server was made on the one active before this switch.
  const interrupted = unsent.some((draft) => draft.session && (draft.session.serverUrl ?? currentServer) !== newServer)
  if (interrupted) notes.push("An interrupted upload will start again on the new server.")
  return notes
}

/**
 * The page origin of a bridge message, taken from what the browser says about the sender and never from
 * the message: only this extension's content script in a tab's top frame counts.
 */
export function bridgeSenderOrigin(
  sender: { id?: string; tab?: unknown; frameId?: number; origin?: string; url?: string },
  extensionId: string,
): string | null {
  if (sender.id !== extensionId || !sender.tab || sender.frameId !== 0) return null
  let origin = sender.origin
  if (!origin && sender.url) {
    try {
      origin = new URL(sender.url).origin
    } catch {
      return null
    }
  }
  return origin && origin !== "null" ? origin : null
}

/**
 * Which request a page message is. A server switch or the popup counts only right after a click on the
 * page, so a page cannot keep raising either by itself.
 */
export function pageRequest(data: unknown, userActive: boolean): "hello" | "use-server" | "open-popup" | null {
  const type = (data as { type?: unknown } | null)?.type
  if (type === BRIDGE_HELLO) return "hello"
  if (type === BRIDGE_USE_SERVER && userActive) return "use-server"
  if (type === BRIDGE_OPEN_POPUP && userActive) return "open-popup"
  return null
}

export interface PageBridgeDeps {
  window: {
    addEventListener(type: "message", listener: (event: MessageEvent) => void): void
    removeEventListener(type: "message", listener: (event: MessageEvent) => void): void
    postMessage(message: unknown, targetOrigin: string): void
  }
  origin: string
  userActive(): boolean
  /** False once the extension was reloaded or removed and this script is left behind in the page. */
  alive(): boolean
  send(message: BridgeHelloRequest | BridgeOpenPopupRequest | BridgeUseServerRequest): Promise<unknown>
}

/**
 * The bridge content script: passes a page's requests to the background and posts the answers back.
 * Chrome keeps the old script running in open tabs when the extension reloads, and sending from it throws
 * at once, so once the extension is gone it stops listening; the new script arrives with the next page load.
 */
export function installPageBridge(deps: PageBridgeDeps): void {
  const { window: page, origin } = deps
  const onMessage = (event: MessageEvent) => {
    if (event.source !== page || event.origin !== origin) return
    const request = pageRequest(event.data, deps.userActive())
    if (request === null) return
    if (!deps.alive()) {
      page.removeEventListener("message", onMessage)
      return
    }
    if (request === "hello") {
      deps
        .send({ type: "bugberry:bridge-hello" })
        .then((reply: unknown) => {
          const { active, version } = (reply ?? {}) as { active?: unknown; version?: unknown }
          if (typeof active !== "boolean") return
          const status = { type: BRIDGE_STATUS, active, version: typeof version === "string" ? version : null }
          page.postMessage(status, origin)
        })
        .catch(() => {})
    } else if (request === "open-popup") {
      const answer = (opened: boolean) => page.postMessage({ type: BRIDGE_POPUP, opened }, origin)
      deps
        .send({ type: "bugberry:bridge-open-popup" })
        .then((reply: unknown) => answer(reply === true))
        .catch(() => answer(false))
    } else {
      deps.send({ type: "bugberry:bridge-use-server" }).catch(() => {})
    }
  }
  page.addEventListener("message", onMessage)
}

/**
 * Saves a new server. Uploads begun before drafts remembered their server belong to the previous one,
 * so they are marked as such (and start again on the new server) instead of resuming against it.
 */
export async function switchServer(
  serverUrl: string,
  previousServer: string | null,
  store: { list(): Promise<ReportDraft[]>; put(draft: ReportDraft): Promise<void> },
  save: (settings: Settings) => Promise<void>,
): Promise<void> {
  for (const draft of await store.list()) {
    if (!draft.session || draft.session.serverUrl) continue
    await store.put({ ...draft, session: previousServer ? { ...draft.session, serverUrl: previousServer } : null })
  }
  await save({ serverUrl })
}
