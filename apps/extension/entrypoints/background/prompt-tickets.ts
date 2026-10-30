import { browser } from "wxt/browser"
import type { PromptTicket, PromptTickets } from "../../lib/prompts/prompt-opener"

const PROMPT_TICKETS_KEY = "promptTickets"

// Session storage: a ticket outlives a sleeping worker, never the browser session.
const readTickets = async () =>
  ((await browser.storage.session.get(PROMPT_TICKETS_KEY))[PROMPT_TICKETS_KEY] ?? {}) as Record<string, PromptTicket>
export const promptTickets: PromptTickets = {
  get: async (token) => (await readTickets())[token] ?? null,
  put: async (token, ticket) => {
    const now = Date.now()
    const kept = Object.fromEntries(Object.entries(await readTickets()).filter(([, entry]) => entry.expiresAt > now))
    await browser.storage.session.set({ [PROMPT_TICKETS_KEY]: { ...kept, [token]: ticket } })
  },
  delete: async (token) => {
    const { [token]: _gone, ...rest } = await readTickets()
    await browser.storage.session.set({ [PROMPT_TICKETS_KEY]: rest })
  },
}
