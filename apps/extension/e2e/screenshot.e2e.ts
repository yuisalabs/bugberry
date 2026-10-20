import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium, expect, test } from "@playwright/test"

declare const chrome: {
  tabs: { query(filter: { url: string }): Promise<Array<{ id?: number }>> }
  runtime: { sendMessage(message: unknown): Promise<unknown> }
}

const extensionPath = fileURLToPath(new URL("../.output/chrome-mv3", import.meta.url))
const statePath = fileURLToPath(new URL("./.state.json", import.meta.url))

test("a screenshot report travels from the extension to the server", async () => {
  const state = JSON.parse(readFileSync(statePath, "utf8")) as {
    serverUrl: string
    token: string
    demoUrl: string
    sessionCookie: { name: string; value: string }
  }
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  const extensionId = new URL(worker.url()).host

  // Signed out, the popup asks for a sign-in; with the dashboard's cookie it is ready, with no token anywhere.
  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/popup.html`)
  await expect(options.getByText("Sign in to BugBerry")).toBeVisible()
  await context.addCookies([{ ...state.sessionCookie, url: state.serverUrl }])
  await options.reload()
  await options.getByRole("button", { name: "More" }).click()
  await expect(options.getByText(/Signed in as E2E/)).toBeVisible()

  const demo = await context.newPage()
  await demo.goto(state.demoUrl)
  await demo.getByRole("button", { name: "Bayar" }).click()
  await demo.waitForTimeout(500)
  await demo.bringToFront()

  const result = await options.evaluate(async (demoUrl) => {
    const [tab] = await chrome.tabs.query({ url: `${demoUrl}*` })
    return chrome.runtime.sendMessage({ type: "bugberry:screenshot", tabId: tab?.id })
  }, state.demoUrl)
  expect(result).toMatchObject({ ok: true })

  // The review opens over the page, in an extension iframe inside a closed shadow root: found by its URL.
  await expect.poll(() => demo.frames().some((frame) => frame.url().includes("/review.html")), { timeout: 10_000 }).toBe(true)
  const review = demo.frames().find((frame) => frame.url().includes("/review.html"))
  if (!review) throw new Error("The review did not open over the page")
  await review.getByLabel("Title").fill("Pay button fails")
  // The project the page URL matches is chosen. By role: react-aria also labels a hidden native select for autofill.
  await expect(review.getByRole("button", { name: /Project$/ })).toHaveText("Demo")
  await review.getByRole("button", { name: "Create report" }).click()
  await expect(review.getByText("Report created")).toBeVisible({ timeout: 30_000 })

  const reportUrl = await review.getByRole("link", { name: "Open report" }).getAttribute("href")
  const reportId = reportUrl?.split("/").at(-1)
  const response = await fetch(`${state.serverUrl}/api/reports/${reportId}`, {
    headers: { authorization: `Bearer ${state.token}` },
  })
  const report = (await response.json()) as {
    uploadStatus: string
    title: string
    pageUrl: string
    shareSlug: string
    debuggerSummary: { errors: number; failedRequests: number; actions: number; incomplete: string[] }
  }
  expect(report).toMatchObject({ uploadStatus: "ready", title: "Pay button fails", pageUrl: state.demoUrl })
  expect(report.debuggerSummary.errors).toBeGreaterThanOrEqual(1)
  expect(report.debuggerSummary.failedRequests).toBeGreaterThanOrEqual(1)
  expect(report.debuggerSummary.actions).toBeGreaterThanOrEqual(1)
  expect(report.debuggerSummary.incomplete).toEqual([])

  // The editor made a JPEG thumbnail; the card link serves it (a screenshot without one would fall back to its PNG).
  const list = (await (
    await fetch(`${state.serverUrl}/api/reports`, { headers: { authorization: `Bearer ${state.token}` } })
  ).json()) as { items: Array<{ id: string; thumbnailUrl: string | null }> }
  const thumbnailUrl = list.items.find((item) => item.id === reportId)?.thumbnailUrl
  expect(thumbnailUrl).toBeTruthy()
  const thumbnail = await fetch(new URL(thumbnailUrl ?? "", state.serverUrl))
  expect(thumbnail.status).toBe(200)
  expect(thumbnail.headers.get("content-type")).toBe("image/jpeg")

  // The dashboard's share page shows the same report, decoded from debugger.json.gz, to someone signed out.
  await context.clearCookies()
  const share = await context.newPage()
  await share.goto(`${state.serverUrl}/s/${report.shareSlug}`)
  await expect(share).toHaveURL(/\/login\?next=/)

  await fetch(`${state.serverUrl}/api/reports/${reportId}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json" },
    body: JSON.stringify({ visibility: "public" }),
  })
  await share.goto(`${state.serverUrl}/s/${report.shareSlug}`)
  await expect(share.getByRole("heading", { name: "Pay button fails" })).toBeVisible()
  const screenshot = share.getByRole("img", { name: "Report screenshot" })
  await expect(screenshot).toBeVisible()
  await expect.poll(() => screenshot.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  // The flagged box lists the failed request first (5xx), then the console.error.
  const flagged = share.getByRole("region", { name: "BugBerry flagged" })
  await expect(flagged.getByText("BugBerry flagged 2 issues")).toBeVisible()
  await expect(flagged.getByRole("listitem").first()).toContainText("GET /api/price → 500")
  await share.getByRole("tab", { name: /Console/ }).click()
  await expect(share.getByText("checkout failed", { exact: true })).toBeVisible()
  await expect(share.getByRole("tabpanel").getByText("demo.js:2")).toBeVisible()
  await share.getByRole("tab", { name: /Network/ }).click()
  const scriptRow = share.getByRole("row").filter({ has: share.getByRole("button", { name: /^demo\.js/ }) })
  await expect(scriptRow.getByRole("cell", { name: "script", exact: true }).first()).toBeVisible()
  await expect(share.getByRole("button", { name: /^logo\.png/ })).toBeVisible()
  await share.getByRole("button", { name: /^price/ }).click()
  await expect(share.getByRole("tabpanel").getByText("GET /api/price", { exact: true })).toBeVisible()
  await expect(share.getByRole("tabpanel").getByText("500 Internal Server Error")).toBeVisible()

  await share.getByRole("button", { name: "Close request" }).click()
  await share.getByRole("tab", { name: /Info/ }).click()
  await expect(share.getByText(/timezone/)).toBeVisible()

  await context.close()
})
