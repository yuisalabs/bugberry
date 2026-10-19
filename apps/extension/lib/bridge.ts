import { BRIDGE_HELLO, BRIDGE_OPEN_POPUP, BRIDGE_USE_SERVER } from "@bugberry/shared"
import type { Settings } from "./settings"
import type { ReportDraft } from "./types"

export interface BridgeDeps {
  isBugBerryServer(origin: string): Promise<boolean>
  currentServer(): Promise<string | null>
  /** Opens the extension's own confirmation page; only a click there changes the server. */
  openConfirm(origin: string): Promise<void>
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
    async useServer(origin: string): Promise<boolean> {
      if (!(await isBugBerry(origin))) return false
      await deps.openConfirm(origin)
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
 * The page origin of a bridge message, taken from what Chrome says about the sender and never from
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

export interface ConfirmTab {
  id: number
  url: string
  windowId: number
}

export interface ConfirmTabs {
  /** The confirmation page's URL, without a query. */
  pageUrl: string
  find(): Promise<ConfirmTab | null>
  create(url: string): Promise<void>
  focus(tab: ConfirmTab): Promise<void>
}

/**
 * Opens the confirmation page, one at a time. An open prompt is only brought forward again: it is never
 * pointed at another server, so a click meant for one server cannot confirm a different one.
 */
export function createConfirmOpener(tabs: ConfirmTabs): (origin: string) => Promise<void> {
  let queue: Promise<void> = Promise.resolve()
  return (origin) => {
    const run = async () => {
      const open = await tabs.find()
      if (!open) return tabs.create(`${tabs.pageUrl}?server=${encodeURIComponent(origin)}`)
      if (new URL(open.url).searchParams.get("server") === origin) await tabs.focus(open)
    }
    // Requests run one after another, so two at once cannot both find no tab and open two.
    const next = queue.then(run, run)
    queue = next.catch(() => {})
    return next
  }
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
