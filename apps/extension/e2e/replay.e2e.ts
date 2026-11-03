import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { type BrowserContext, chromium, expect, type Page, test, type Worker } from "@playwright/test"

declare const chrome: {
  tabs: { query(filter: { url: string }): Promise<Array<{ id?: number }>> }
  action: { openPopup(): Promise<void>; getBadgeText(details: { tabId: number }): Promise<string> }
}

const extensionPath = fileURLToPath(new URL("../.output/chrome-mv3", import.meta.url))
const statePath = fileURLToPath(new URL("./.state.json", import.meta.url))

/**
 * Runs `script` in the toolbar popup itself: replay requests are only taken from it, not from popup.html opened in a
 * tab. Playwright doesn't wrap an extension's popup, so it is reached through its CDP target.
 */
async function inPopup(context: BrowserContext, worker: Worker, page: Page, script: string): Promise<unknown> {
  await worker.evaluate(() => chrome.action.openPopup())
  const cdp = await context.newCDPSession(page)
  let target: { targetId: string } | undefined
  await expect
    .poll(async () => {
      const { targetInfos } = (await cdp.send("Target.getTargets")) as { targetInfos: Array<{ targetId: string; url: string }> }
      target = targetInfos.find((info) => info.url.includes("/popup.html"))
      return Boolean(target)
    })
    .toBe(true)
  const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId: target?.targetId ?? "", flatten: false })) as { sessionId: string }
  type Reply = { result?: { result?: { value?: unknown }; exceptionDetails?: unknown } } | "closed"
  const answer = new Promise<Reply>((resolve) => {
    cdp.on("Target.receivedMessageFromTarget", (event: { message: string }) => {
      const message = JSON.parse(event.message) as { id?: number }
      if (message.id === 1) resolve(message as Reply)
    })
    // Capture closes the popup as the review opens, before the script can answer.
    cdp.on("Target.detachedFromTarget", (event: { sessionId: string }) => {
      if (event.sessionId === sessionId) resolve("closed")
    })
  })
  await cdp.send("Target.sendMessageToTarget", {
    sessionId,
    message: JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: `(async () => { ${POPUP_HELPERS}; ${script} })()`, awaitPromise: true, returnByValue: true } }),
  })
  const reply = await answer
  if (reply === "closed") {
    await cdp.detach()
    return undefined
  }
  // A popup still open makes the next openPopup() fail.
  await cdp.send("Target.closeTarget", { targetId: target?.targetId ?? "" }).catch(() => undefined)
  await expect
    .poll(async () => ((await cdp.send("Target.getTargets")) as { targetInfos: Array<{ url: string }> }).targetInfos.some((info) => info.url.includes("/popup.html")))
    .toBe(false)
  await cdp.detach()
  if (reply.result?.result === undefined || reply.result.exceptionDetails) throw new Error(`The popup script failed: ${JSON.stringify(reply)}`)
  return reply.result.result.value
}

/** `button(name)` waits up to 5 s for a button with that exact text. */
const POPUP_HELPERS = `
  const button = async (name, pressed) => {
    for (let i = 0; i < 50; i++) {
      const found = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === name && (pressed === undefined || b.getAttribute("aria-pressed") === String(pressed)))
      if (found) return found
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error("No button " + name + " in: " + document.body.innerText)
  }`

test("a replay is armed, survives a reload, is captured, sent, and plays in the dashboard", async () => {
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
  await context.addCookies([{ ...state.sessionCookie, url: state.serverUrl }])
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))

  const demo = await context.newPage()
  await demo.goto(state.demoUrl)
  await demo.bringToFront()
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0]?.id ?? -1, state.demoUrl)
  const badge = () => worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)

  await inPopup(
    context,
    worker,
    demo,
    `(await button("30s")).click(); await button("30s", true); (await button("Arm replay")).click(); await button("Capture last ~30s")`,
  )
  await expect.poll(badge).toBe("30s")

  // A reload starts the recorder again, empty, and the badge comes back.
  await demo.reload()
  await expect.poll(badge, { timeout: 5_000 }).toBe("30s")

  await demo.bringToFront()
  await demo.getByRole("button", { name: "Bayar" }).click()
  await demo.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", "<p id='declined'>Card declined</p>")
  })
  // One frame every 5 seconds while the page is visible.
  await demo.waitForTimeout(6_500)

  await inPopup(context, worker, demo, `(await button("Capture last ~30s")).click()`)

  await expect.poll(() => demo.frames().some((frame) => frame.url().includes("/review.html")), { timeout: 15_000 }).toBe(true)
  const review = demo.frames().find((frame) => frame.url().includes("/review.html"))
  if (!review) throw new Error("The review did not open over the page")
  await expect(review.getByText("Replay", { exact: true })).toBeVisible()
  await expect(review.locator(".rr-player")).toBeVisible({ timeout: 15_000 })
  await expect(review.getByRole("listitem", { name: /^Screenshot at / }).first()).toBeVisible()
  await review.getByLabel("Title").fill("Card declined on Pay")
  await review.getByRole("button", { name: "Create report" }).click()
  await expect(review.getByText("Report created")).toBeVisible({ timeout: 30_000 })
  // The tab stays armed after a capture.
  expect(await badge()).toBe("30s")

  const reportUrl = await review.getByRole("link", { name: "Open report" }).getAttribute("href")
  const reportId = reportUrl?.split("/").at(-1)
  const response = await fetch(`${state.serverUrl}/api/reports/${reportId}`, { headers: { authorization: `Bearer ${state.token}` } })
  const report = (await response.json()) as { uploadStatus: string; captureType: string; durationMs: number; thumbnailUrl: string | null }
  expect(report).toMatchObject({ uploadStatus: "ready", captureType: "replay" })
  // Captured after the reload: a few seconds, not the time since arming.
  expect(report.durationMs).toBeGreaterThan(3_000)
  expect(report.durationMs).toBeLessThan(30_000)
  expect(report.thumbnailUrl).not.toBeNull()

  // The dashboard plays it with rrweb, with the frames under it.
  const dashboard = await context.newPage()
  await dashboard.goto(reportUrl ?? "")
  await expect(dashboard.locator(".rr-player")).toBeVisible({ timeout: 20_000 })
  await expect(dashboard.getByRole("listitem", { name: /^Screenshot at / }).first()).toBeVisible()
  await expect(dashboard.getByRole("link", { name: "Download replay" })).toBeVisible()

  await context.close()
})
