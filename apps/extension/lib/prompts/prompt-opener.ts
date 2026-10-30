import type { PromptPage } from "../shared/messages"

const ANSWER_MS = 2000
/** A prompt nobody answered in this long is forgotten. */
export const TICKET_TTL_MS = 10 * 60 * 1000

/** What a prompt asks. Only the background hands it out, by token. */
export interface PromptTicket {
  page: PromptPage
  /** confirm-server: the server to switch to. */
  server?: string
  /** The tab whose page shows the prompt; null for a prompt in a tab of its own. */
  tabId: number | null
  expiresAt: number
}

export interface PromptTickets {
  get(token: string): Promise<PromptTicket | null>
  put(token: string, ticket: PromptTicket): Promise<void>
  delete(token: string): Promise<void>
}

/**
 * Opens a prompt, such as allowing the microphone or switching servers, over the page the reporter is on, so they stay
 * where they were. When that page can't show it (a new tab, chrome://, the Web Store, a PDF, or no tab at
 * all), the prompt opens in a tab of its own.
 */
export function createPromptOpener(deps: {
  tickets: PromptTickets
  newToken(): string
  now(): number
  /** Rejects when no content script answers. */
  sendToTab(tabId: number, message: unknown): Promise<unknown>
  openTab(url: string): Promise<void>
  /** The prompt page's URL, without a query. */
  pageUrl(page: PromptPage): string
  /** False where an embedded prompt can't tell whether something covers it (Firefox): always a tab. */
  overPage: boolean
  timeoutMs?: number
}): (ask: { page: PromptPage; server?: string }, tabId: number | null) => Promise<void> {
  return async (ask, tabId) => {
    const expiresAt = deps.now() + TICKET_TTL_MS
    if (deps.overPage && tabId !== null) {
      const token = deps.newToken()
      await deps.tickets.put(token, { ...ask, tabId, expiresAt })
      let timer: ReturnType<typeof setTimeout> | undefined
      const answer = await Promise.race([
        deps.sendToTab(tabId, { type: "bugberry:ui-prompt", page: ask.page, token }).catch(() => null),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), deps.timeoutMs ?? ANSWER_MS)
        }),
      ])
      clearTimeout(timer)
      if ((answer as { ok?: unknown } | null)?.ok === true) return
      // A page that answers late can't use this ticket: the tab gets one of its own.
      await deps.tickets.delete(token)
    }
    const token = deps.newToken()
    await deps.tickets.put(token, { ...ask, tabId: null, expiresAt })
    await deps.openTab(`${deps.pageUrl(ask.page)}?prompt=${encodeURIComponent(token)}`)
  }
}

/**
 * The ticket a prompt page may read: unexpired, and for a prompt over a page, asked from inside that tab
 * (another site can embed the page, but not in that tab).
 */
export async function ticketFor(
  tickets: PromptTickets,
  token: string,
  senderTabId: number | undefined,
  now: number,
): Promise<PromptTicket | null> {
  const ticket = await tickets.get(token)
  if (!ticket) return null
  if (ticket.expiresAt <= now) {
    await tickets.delete(token)
    return null
  }
  if (ticket.tabId !== null && ticket.tabId !== senderTabId) return null
  return ticket
}
