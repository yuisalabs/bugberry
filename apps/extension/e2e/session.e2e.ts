import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium, expect, test } from "@playwright/test"

const extensionPath = fileURLToPath(new URL("../.output/chrome-mv3", import.meta.url))
const statePath = fileURLToPath(new URL("./.state.json", import.meta.url))

interface State {
  serverUrl: string
  token: string
  demoUrl: string
  sessionCookie: { name: string; value: string }
}

test("extension pages reach the API with the dashboard cookie", async () => {
  const state = JSON.parse(readFileSync(statePath, "utf8")) as State
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  const extensionId = new URL(worker.url()).host

  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  const me = (from: { evaluate: typeof page.evaluate }) =>
    from.evaluate(async (serverUrl) => {
      const response = await fetch(`${serverUrl}/api/me`, { credentials: "include" })
      return { status: response.status, body: response.ok ? ((await response.json()) as { email: string }) : null }
    }, state.serverUrl)

  expect((await me(page)).status).toBe(401)

  await context.addCookies([{ ...state.sessionCookie, url: state.serverUrl }])
  const signedIn = await me(page)
  expect(signedIn.status).toBe(200)
  expect(signedIn.body?.email).toBe("e2e@kantor.test")

  const fromWorker = await me(worker)
  expect(fromWorker.status).toBe(200)
  await context.close()
})

declare const chrome: {
  storage: { local: { set(items: Record<string, unknown>): Promise<void>; get(key: string): Promise<Record<string, unknown>> } }
}

test("a BugBerry dashboard points the extension at itself", async () => {
  const state = JSON.parse(readFileSync(statePath, "utf8")) as State
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  const extensionId = new URL(worker.url()).host
  await context.addCookies([{ ...state.sessionCookie, url: state.serverUrl }])

  const extensionPage = await context.newPage()
  await extensionPage.goto(`chrome-extension://${extensionId}/options.html`)
  await extensionPage.evaluate(() => chrome.storage.local.set({ serverUrl: "https://elsewhere.example" }))
  const storedServer = () => extensionPage.evaluate(async () => (await chrome.storage.local.get("serverUrl")).serverUrl)

  // A page that is not a BugBerry server cannot even open the confirmation.
  const demo = await context.newPage()
  await demo.goto(state.demoUrl)
  await demo.evaluate(() => window.postMessage({ type: "bugberry:use-server" }, location.origin))
  await demo.waitForTimeout(2000)
  expect(context.pages().some((page) => page.url().includes("/confirm-server.html"))).toBe(false)

  const dashboard = await context.newPage()
  await dashboard.goto(`${state.serverUrl}/app`)
  const confirmOpened = context.waitForEvent("page", (page) => page.url().includes("/confirm-server.html"))
  await dashboard.getByRole("button", { name: "Use the extension with this server" }).click()
  const confirm = await confirmOpened
  const host = new URL(state.serverUrl).host
  await expect(confirm.getByRole("heading", { name: `Send your BugBerry reports to ${host}?` })).toBeVisible()
  expect(await storedServer()).toBe("https://elsewhere.example")
  await confirm.getByRole("button", { name: "Use this server" }).click()
  await expect(confirm.getByText(`Done. Reports now go to ${host}.`)).toBeVisible()
  expect(await storedServer()).toBe(state.serverUrl)

  await dashboard.bringToFront()
  await dashboard.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(dashboard.getByRole("region", { name: "Browser extension" }).getByText(/^Installed, v/)).toBeVisible()
  await context.close()
})
