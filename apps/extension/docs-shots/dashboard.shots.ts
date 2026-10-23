import { chromium, expect, type Frame, type Page, test } from "@playwright/test"
import { dashboardPage, fileScreenshotReport, type Harness, launch, openPopup, reviewFrame, send, shopTabId, shot } from "./harness"

// The dashboard as a team sees it after a few reports: each picture builds on the reports filed first.
test.describe.configure({ mode: "serial" })

let h: Harness
let reportId = ""

test.beforeAll(async () => {
  h = await launch()
  await fileScreenshotReport(h, {
    title: "Coupon field accepts expired codes",
    description: "SPRING10 expired last week but still takes 10% off.",
    priority: "Low",
  })
  await fileScreenshotReport(h, {
    title: "Cart total doesn't update after removing an item",
    description: "Removing the cable keeps the total at $48.00 until a reload.",
    priority: "Medium",
  })
  reportId = await fileScreenshotReport(h, {
    title: "Pay button fails at checkout",
    description: "Clicking Pay does nothing. Expected the order confirmation.",
    priority: "High",
  })
})

test.afterAll(async () => {
  await h.context.close()
})

test("report list", async () => {
  const page = await dashboardPage(h, "/app", { width: 1440, height: 620 })
  await expect(page.getByText("Pay button fails at checkout")).toBeVisible()
  await page.waitForTimeout(1000)
  await shot(page, "dashboard/reports.png")
  await page.close()
})

test("report details and a comment", async () => {
  const page = await dashboardPage(h, `/app/r/${reportId}`, { width: 1600, height: 1000 })
  await page.getByRole("tab", { name: /^Details/ }).click()
  await page.getByPlaceholder("Comment or @ to mention").fill("Reproduced on Chrome 156: the 500 comes from POST /api/pay, see the Network tab.")
  await page.locator('section[aria-label="Comments"] button[type=submit]').first().click()
  await expect(page.getByText("see the Network tab.").first()).toBeVisible()
  await page.mouse.move(4, 4)
  await page.waitForTimeout(1000)
  await shot(page, "dashboard/details.png")
  await page.close()
})

test("who can see a report", async () => {
  const page = await dashboardPage(h, `/app/r/${reportId}`, { width: 1600, height: 1000 })
  await page.getByRole("button", { name: "Share settings" }).click()
  await page.waitForTimeout(800)
  const popover = await page.getByText("Who can open this link").locator("xpath=ancestor::*[@role='dialog'][1]").boundingBox()
  if (!popover) throw new Error("No share settings")
  await shot(page, "workspaces-and-access/share.png", {
    clip: { x: popover.x - 24, y: 0, width: Math.min(1600 - (popover.x - 24), popover.width + 48), height: popover.y + popover.height + 24 },
  })
  await page.close()
})

test("workspace menu", async () => {
  const page = await dashboardPage(h, "/app", { width: 1440, height: 620 })
  await page.locator("header").getByRole("button", { name: /Demo/ }).first().click()
  await page.waitForTimeout(800)
  await shot(page, "workspaces-and-access/workspace-menu.png", { clip: { x: 0, y: 0, width: 720, height: 460 } })
  await page.close()
})

test("members", async () => {
  const page = await dashboardPage(h, "/app/settings/members", { width: 1440, height: 720 })
  await page.waitForTimeout(800)
  await shot(page, "workspaces-and-access/members.png")
  await page.close()
})

test("projects and URL patterns", async () => {
  const page = await dashboardPage(h, "/app/settings/projects", { width: 1440, height: 740 })
  await page.getByRole("textbox").last().fill(new URL("/shop", h.state.demoUrl).href)
  await page.waitForTimeout(800)
  await shot(page, "workspaces-and-access/projects.png")
  await page.close()
})

test("integrations", async () => {
  const page = await dashboardPage(h, "/app/settings/integrations", { width: 1440, height: 800 })
  await page.waitForTimeout(800)
  await shot(page, "trackers/integrations.png")
  await page.close()
})

test("AI agents", async () => {
  const page = await dashboardPage(h, "/app/settings/ai", { width: 1440, height: 860 })
  await page.waitForTimeout(800)
  await shot(page, "ai-agents/mcp.png")
  await page.close()
})

test("sign-in page", async () => {
  // Signed out: a browser of its own, without the dashboard's cookie.
  const browser = await chromium.launch({ channel: "chromium" })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" })
  await page.goto(`${h.state.serverUrl}/login`)
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(800)
  await shot(page, "self-host/sign-in.png")
  await browser.close()
})

test("use the extension with this server", async () => {
  // The extension sends somewhere else, so the dashboard offers to point it here.
  const options = await h.context.newPage()
  await options.goto(`chrome-extension://${h.extensionId}/options.html`)
  await options.evaluate(() =>
    (globalThis as unknown as { chrome: { storage: { local: { set(v: object): Promise<void> } } } }).chrome.storage.local.set({
      serverUrl: "https://elsewhere.example",
    }),
  )
  await options.close()
  // At the window's own size: the confirmation checks nothing covers it, which an emulated viewport upsets.
  const page = await h.context.newPage()
  await page.goto(`${h.state.serverUrl}/app`)
  await page.waitForLoadState("networkidle")
  await page.getByRole("button", { name: "Account menu" }).click({ timeout: 10_000 })
  await page.waitForTimeout(600)
  const width = await page.evaluate(() => document.documentElement.clientWidth)
  await shot(page, "self-host/account-menu.png", { clip: { x: width - 400, y: 0, width: 400, height: 460 } })
  const opened = h.context.waitForEvent("page", { predicate: (p) => p.url().includes("/confirm-server.html"), timeout: 10_000 }).catch(() => null)
  await page.getByRole("menuitem", { name: /Browser extension/ }).click()
  const embedded = await confirmServer(page, await opened)
  // Over the dashboard, Chrome's visibility check (IntersectionObserver v2) never passes under automation, so
  // the prompt warns that something covers it. Its own way out, a tab of its own, asks the same question.
  const tab = h.context.waitForEvent("page", { predicate: (p) => p.url().includes("/confirm-server.html"), timeout: 10_000 })
  await embedded.getByRole("link", { name: "Open in a tab" }).or(embedded.getByRole("button", { name: "Open in a tab" })).click()
  const confirm = await tab
  const cdp = await h.context.newCDPSession(confirm)
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 620, deviceScaleFactor: 2, mobile: false })
  const use = confirm.getByRole("button", { name: "Use this server" })
  await expect(use).toBeEnabled()
  await confirm.waitForTimeout(800)
  // The card sits in the middle of the 900 x 620 page, with its shadow.
  await shot(confirm, "self-host/use-this-server.png", { clip: { x: 200, y: 135, width: 500, height: 350 } })
  await use.click()
  await expect(confirm.getByText(/Reports now go to/)).toBeVisible()
  await confirm.close()
  await page.close()
})

/** The confirmation opens over the dashboard (a frame) or, where it can't, as a page of its own. */
async function confirmServer(page: Page, opened: Page | null): Promise<Frame> {
  if (opened) return opened.mainFrame()
  await expect.poll(() => page.frames().some((f) => f.url().includes("/confirm-server.html")), { timeout: 10_000 }).toBe(true)
  return page.frames().find((f) => f.url().includes("/confirm-server.html"))!
}

test("unsent drafts in the popup menu", async () => {
  // A screenshot kept as a draft: closed without sending.
  const popup = await openPopup(h)
  const tabId = await shopTabId(h, popup)
  await h.shop.bringToFront()
  expect(await send(popup, { type: "bugberry:screenshot", tabId, mode: "visible" })).toMatchObject({ ok: true })
  await popup.close()
  const review = await reviewFrame(h)
  await review.getByRole("button", { name: "Close" }).click()
  await review.getByRole("button", { name: "Keep" }).click()
  const menu = await openPopup(h)
  await menu.getByRole("button", { name: "More" }).click()
  await menu.getByRole("menuitem", { name: /Unsent drafts/ }).waitFor()
  await menu.waitForTimeout(500)
  await shot(menu, "review-and-send/popup-menu.png")
  await menu.close()
})
