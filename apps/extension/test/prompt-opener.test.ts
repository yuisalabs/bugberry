import { describe, expect, mock, test } from "bun:test"
import { isPageUiMessage, isPopupPromptRequest, isPromptTicketRequest, isReviewAnotherRequest } from "../lib/messages"
import { createPromptOpener, type PromptTicket, type PromptTickets, TICKET_TTL_MS, ticketFor } from "../lib/prompt-opener"

function memoryTickets() {
  const saved = new Map<string, PromptTicket>()
  const tickets: PromptTickets = {
    get: async (token) => saved.get(token) ?? null,
    put: async (token, ticket) => void saved.set(token, ticket),
    delete: async (token) => void saved.delete(token),
  }
  return { saved, tickets }
}

function setup(sendToTab: (tabId: number, message: unknown) => Promise<unknown>, overPage = true) {
  const { saved, tickets } = memoryTickets()
  const openTab = mock(async (_url: string) => {})
  let next = 0
  const open = createPromptOpener({
    tickets,
    newToken: () => `t${++next}`,
    now: () => 1000,
    sendToTab,
    openTab,
    pageUrl: (page) => `chrome-extension://x/${page}.html`,
    overPage,
    timeoutMs: 20,
  })
  return { open, openTab, saved }
}

describe("openPrompt", () => {
  test("over the page the reporter is on, with a ticket tied to that tab", async () => {
    const sent: unknown[] = []
    const { open, openTab, saved } = setup(async (tabId, message) => {
      sent.push([tabId, message])
      return { ok: true }
    })
    await open({ page: "confirm-server", server: "https://bugberry.kantor.com" }, 7)
    expect(sent).toEqual([[7, { type: "bugberry:ui-prompt", page: "confirm-server", token: "t1" }]])
    expect(saved.get("t1")).toEqual({ page: "confirm-server", server: "https://bugberry.kantor.com", tabId: 7, expiresAt: 1000 + TICKET_TTL_MS })
    expect(openTab).not.toHaveBeenCalled()
  })

  test("in a tab when the page can't show it; the unused ticket is dropped", async () => {
    const { open, openTab, saved } = setup(() => Promise.reject(new Error("Receiving end does not exist")))
    await open({ page: "microphone" }, 7)
    expect(openTab).toHaveBeenCalledWith("chrome-extension://x/microphone.html?prompt=t2")
    expect([...saved.keys()]).toEqual(["t2"])
    expect(saved.get("t2")?.tabId).toBeNull()
  })

  test("in a tab with no tab to show it over, or where an embedded prompt can't be trusted (Firefox)", async () => {
    const send = mock(async () => ({ ok: true }))
    const none = setup(send)
    await none.open({ page: "microphone" }, null)
    expect(none.openTab).toHaveBeenCalledTimes(1)
    const firefox = setup(send, false)
    await firefox.open({ page: "microphone" }, 7)
    expect(firefox.openTab).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })
})

describe("ticketFor", () => {
  const ticket = (tabId: number | null, expiresAt = 5000): PromptTicket => ({ page: "confirm-server", server: "https://a.test", tabId, expiresAt })

  test("only from inside the tab it was shown in: a site embedding the page elsewhere gets nothing", async () => {
    const { tickets } = memoryTickets()
    await tickets.put("t", ticket(7))
    expect(await ticketFor(tickets, "t", 7, 1000)).toEqual(ticket(7))
    expect(await ticketFor(tickets, "t", 8, 1000)).toBeNull()
    expect(await ticketFor(tickets, "t", undefined, 1000)).toBeNull()
    expect(await ticketFor(tickets, "unknown", 7, 1000)).toBeNull()
  })

  test("a prompt in its own tab reads its ticket from any tab; an expired one is gone", async () => {
    const { tickets, saved } = memoryTickets()
    await tickets.put("t", ticket(null))
    expect(await ticketFor(tickets, "t", 3, 1000)).not.toBeNull()
    expect(await ticketFor(tickets, "t", 3, 5000)).toBeNull()
    expect(saved.has("t")).toBe(false)
  })
})

describe("prompt messages", () => {
  test("the page layer shows only the known prompt pages", () => {
    expect(isPageUiMessage({ type: "bugberry:ui-prompt", page: "microphone", token: "t" })).toBe(true)
    expect(isPageUiMessage({ type: "bugberry:ui-prompt", page: "options", token: "t" })).toBe(true)
    expect(isPageUiMessage({ type: "bugberry:ui-prompt", page: "review", token: "t" })).toBe(false)
    expect(isPageUiMessage({ type: "bugberry:ui-prompt", page: "microphone" })).toBe(false)
  })

  test("ticket, microphone and Record another requests", () => {
    expect(isPromptTicketRequest({ type: "bugberry:prompt-ticket", token: "t", action: "read" })).toBe(true)
    expect(isPromptTicketRequest({ type: "bugberry:prompt-ticket", token: "t", action: "switch" })).toBe(false)
    expect(isPopupPromptRequest({ type: "bugberry:popup-prompt", page: "microphone", tabId: null })).toBe(true)
    expect(isPopupPromptRequest({ type: "bugberry:popup-prompt", page: "options", tabId: 7 })).toBe(true)
    expect(isPopupPromptRequest({ type: "bugberry:popup-prompt", page: "confirm-server", tabId: 7 })).toBe(false)
    expect(isPopupPromptRequest({ type: "bugberry:popup-prompt", page: "microphone", tabId: "7" })).toBe(false)
    expect(isReviewAnotherRequest({ type: "bugberry:review-another", captureType: "video", tabId: 7 })).toBe(true)
    expect(isReviewAnotherRequest({ type: "bugberry:review-another", captureType: "gif", tabId: 7 })).toBe(false)
  })
})
