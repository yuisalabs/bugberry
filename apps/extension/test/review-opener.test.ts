import { describe, expect, mock, test } from "bun:test"
import { createReviewOpener } from "../lib/review-opener"

function setup(sendToTab: (tabId: number, message: unknown) => Promise<unknown>) {
  const openTab = mock(async (_url: string) => {})
  const order: string[] = []
  const focusTab = mock(async (tabId: number) => void order.push(`focus ${tabId}`))
  const open = createReviewOpener({
    sendToTab: (tabId, message) => {
      order.push(`send ${tabId}`)
      return sendToTab(tabId, message)
    },
    openTab,
    focusTab,
    reviewUrl: (id) => `chrome-extension://x/review.html?draft=${id}`,
    timeoutMs: 20,
  })
  return { open, openTab, order }
}

describe("openReview", () => {
  test("over the page when the page layer answers", async () => {
    const sent: unknown[] = []
    const { open, openTab } = setup(async (tabId, message) => {
      sent.push([tabId, message])
      return { ok: true }
    })
    await open("d1", 7)
    expect(sent).toEqual([[7, { type: "bugberry:ui-review", draftId: "d1" }]])
    expect(openTab).not.toHaveBeenCalled()
  })

  test("in a tab when the page can't show it (closed tab, chrome:// page, PDF)", async () => {
    const { open, openTab } = setup(() => Promise.reject(new Error("Receiving end does not exist")))
    await open("d1", 7)
    expect(openTab).toHaveBeenCalledWith("chrome-extension://x/review.html?draft=d1")
  })

  test("in a tab when the page doesn't answer in time, or answers something else", async () => {
    const silent = setup(() => new Promise(() => {}))
    await silent.open("d1", 7)
    expect(silent.openTab).toHaveBeenCalledTimes(1)
    const odd = setup(async () => undefined)
    await odd.open("d1", 7)
    expect(odd.openTab).toHaveBeenCalledTimes(1)
  })
})

test("the recorded tab comes to the front first: the reporter may be in another tab or app", async () => {
  const { open, order } = setup(async () => ({ ok: true }))
  await open("d1", 7)
  expect(order).toEqual(["focus 7", "send 7"])
})

test("when it falls back to a tab, a modal that shows up late is taken off the page", async () => {
  const sent: unknown[] = []
  const { open, openTab } = setup(async (_tabId, message) => {
    sent.push(message)
    return new Promise(() => {})
  })
  await open("d1", 7)
  expect(openTab).toHaveBeenCalledTimes(1)
  expect(sent).toEqual([{ type: "bugberry:ui-review", draftId: "d1" }, { type: "bugberry:ui-review-close" }])
})
