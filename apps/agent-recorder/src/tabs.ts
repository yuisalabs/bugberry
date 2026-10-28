/** What the recorder uses of a Playwright page; a plain object in tests. */
export interface PageLike {
  url(): string
  isClosed(): boolean
  goto(url: string): Promise<unknown>
  reload(): Promise<unknown>
  bringToFront(): Promise<void>
}

/** What the recorder uses of a Playwright browser context. */
export interface ContextLike<P extends PageLike> {
  pages(): P[]
  on(event: "page", listener: (page: P) => void): void
  newPage(): Promise<P>
}

/** The extension's own pages (the recorder's automation page) are not the agent's tabs. */
const isAgentTab = (page: PageLike) => !page.url().startsWith("chrome-extension://")

/** The agent's tabs in the order its browser tool numbers them. */
export function agentTabs<P extends PageLike>(context: ContextLike<P>): P[] {
  return context.pages().filter((page) => !page.isClosed() && isAgentTab(page))
}

export interface TabWatcher {
  /** Tabs opened since the last reset that are still open, with the index the agent's browser tool gives them. */
  opened(): Array<{ index: number; url: string }>
  reset(): void
  /** What to tell the agent when it opened another tab, or null. */
  warning(): string | null
}

/**
 * Notices the tabs the agent opens while recording: the extension records one tab, so whatever happens in another is
 * neither in the video nor in the logs, and the agent must be told to go back.
 */
export function createTabWatcher<P extends PageLike>(context: ContextLike<P>, recorded: () => P | null): TabWatcher {
  let opened: P[] = []
  context.on("page", (page) => {
    if (page !== recorded()) opened.push(page)
  })
  const stillOpen = () => {
    const tabs = agentTabs(context)
    return opened.filter((page) => page !== recorded() && tabs.includes(page) && isAgentTab(page))
  }
  return {
    opened: () => {
      const tabs = agentTabs(context)
      return stillOpen().map((page) => ({ index: tabs.indexOf(page), url: page.url() }))
    },
    reset: () => {
      opened = []
    },
    warning: () => {
      const other = stillOpen()[0]
      const current = recorded()
      if (!other || !current) return null
      return `You opened another tab (${other.url()}). It is not recorded. Go back to tab ${agentTabs(context).indexOf(current)} to keep recording.`
    },
  }
}

/**
 * The tab to record: the one the last recording used, navigated to `url`; Chromium's first blank tab on the first
 * recording; a new tab when the agent closed the old one.
 */
export async function recordedPageFor<P extends PageLike>(context: ContextLike<P>, previous: P | null, url: string): Promise<P> {
  const page = previous && !previous.isClosed() ? previous : (previous === null ? agentTabs(context)[0] : undefined) ?? (await context.newPage())
  await page.goto(url)
  return page
}

/**
 * The extension's id for the recorded tab: the one in front showing its page. The recorded tab was just brought to
 * front, so another tab on the same address never wins; tabs are compared whole, hash included.
 */
export function pickRecordedTab(tabs: Array<{ id?: number; url?: string; active?: boolean }>, pageUrl: string): number | null {
  return tabs.find((tab) => tab.active && tab.url === pageUrl && tab.id !== undefined)?.id ?? null
}
