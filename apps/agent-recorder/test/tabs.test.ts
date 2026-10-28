import { describe, expect, test } from "bun:test"
import { createTabWatcher, pickRecordedTab, recordedPageFor, type ContextLike, type PageLike } from "../src/tabs"

class FakePage implements PageLike {
  closed = false
  visited: string[] = []
  constructor(private address: string) {}
  url() {
    return this.address
  }
  isClosed() {
    return this.closed
  }
  async goto(url: string) {
    this.address = url
    this.visited.push(url)
    return null
  }
  async reload() {}
  async bringToFront() {}
}

function fakeContext(...initial: FakePage[]) {
  const list = [...initial]
  const listeners: Array<(page: FakePage) => void> = []
  const context: ContextLike<FakePage> & { open(url: string): FakePage; close(page: FakePage): void } = {
    pages: () => list.filter((page) => !page.closed),
    on: (_event, listener) => void listeners.push(listener),
    newPage: async () => context.open("about:blank"),
    open(url) {
      const page = new FakePage(url)
      list.push(page)
      for (const listener of listeners) listener(page)
      return page
    },
    close(page) {
      page.closed = true
    },
  }
  return context
}

describe("createTabWatcher", () => {
  test("watcher ignores extension pages and the recorded tab", () => {
    const recorded = new FakePage("https://shop.test/checkout")
    const context = fakeContext(recorded)
    const watcher = createTabWatcher(context, () => recorded)
    context.open("chrome-extension://abc/automation.html")
    expect(watcher.opened()).toEqual([])
    expect(watcher.warning()).toBeNull()
  })

  test("watcher warns with the recorded tab's index and the new tab's URL", () => {
    const recorded = new FakePage("https://shop.test/checkout")
    const context = fakeContext(recorded)
    const watcher = createTabWatcher(context, () => recorded)
    context.open("https://shop.test/two")
    expect(watcher.opened()).toEqual([{ index: 1, url: "https://shop.test/two" }])
    expect(watcher.warning()).toBe("You opened another tab (https://shop.test/two). It is not recorded. Go back to tab 0 to keep recording.")
  })

  test("reset forgets the tabs opened before", () => {
    const recorded = new FakePage("https://shop.test/checkout")
    const context = fakeContext(recorded)
    const watcher = createTabWatcher(context, () => recorded)
    context.open("https://shop.test/two")
    watcher.reset()
    expect(watcher.warning()).toBeNull()
  })
})

describe("recordedPageFor", () => {
  test("first recording uses the blank tab Chromium opened with", async () => {
    const blank = new FakePage("about:blank")
    const context = fakeContext(blank)
    expect(await recordedPageFor(context, null, "https://shop.test/checkout")).toBe(blank)
    expect(blank.visited).toEqual(["https://shop.test/checkout"])
  })

  test("re-recording navigates the same tab", async () => {
    const recorded = new FakePage("https://shop.test/checkout")
    const context = fakeContext(recorded)
    context.open("https://shop.test/two")
    expect(await recordedPageFor(context, recorded, "https://shop.test/cart")).toBe(recorded)
    expect(recorded.url()).toBe("https://shop.test/cart")
  })

  test("re-record opens a new tab when the old one is gone", async () => {
    const recorded = new FakePage("https://shop.test/checkout")
    const context = fakeContext(recorded, new FakePage("https://shop.test/two"))
    context.close(recorded)
    const page = await recordedPageFor(context, recorded, "https://shop.test/cart")
    expect(page).not.toBe(recorded)
    expect(page.url()).toBe("https://shop.test/cart")
    expect(context.pages().indexOf(page)).toBe(1)
  })
})

describe("pickRecordedTab", () => {
  const url = "https://shop.test/#/checkout"

  test("the active tab showing the page, not another tab with the same address", () => {
    const tabs = [
      { id: 1, url, active: false },
      { id: 2, url, active: true },
    ]
    expect(pickRecordedTab(tabs, url)).toBe(2)
  })

  test("hash-routed pages are found", () => {
    expect(pickRecordedTab([{ id: 5, url: "https://shop.test/#/checkout", active: true }], url)).toBe(5)
  })

  test("an active tab on another page is not it", () => {
    expect(pickRecordedTab([{ id: 5, url: "https://shop.test/other", active: true }], url)).toBeNull()
  })
})
