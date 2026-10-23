import { expect, test } from "@playwright/test"
import { type Harness, launch, openPopup, reviewFrame, send, shopTabId, shot } from "./harness"

let h: Harness

test.beforeAll(async () => {
  h = await launch()
})

test.afterAll(async () => {
  await h.context.close()
})

test("popup: screenshot", async () => {
  const popup = await openPopup(h, { captureKind: "screenshot", screenshotMode: "visible" })
  await shot(popup, "screenshots/popup.png")
  await popup.close()
})

test("select area", async () => {
  const popup = await openPopup(h)
  const tabId = await shopTabId(h, popup)
  // Answers only once an area is picked: not awaited.
  void send(popup, { type: "bugberry:screenshot", tabId, mode: "area" }).catch(() => {})
  await h.shop.bringToFront()
  await h.shop.locator("[data-bugberry-area]").waitFor({ state: "attached" })
  await h.shop.mouse.move(380, 220)
  await h.shop.mouse.down()
  await h.shop.mouse.move(900, 520, { steps: 12 })
  await shot(h.shop, "screenshots/select-area.png")
  await h.shop.keyboard.press("Escape")
  await h.shop.mouse.up()
  await popup.close()
})

test("review with a mark", async () => {
  await h.shop.bringToFront()
  await h.shop.getByRole("button", { name: "Pay $48.00" }).click()
  await h.shop.waitForTimeout(500)
  // Where the Pay button sits, as a share of the viewport: the same place on the screenshot.
  const pay = await h.shop.getByRole("button", { name: "Pay $48.00" }).boundingBox()
  const viewport = await h.shop.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  if (!pay) throw new Error("No Pay button")
  // The visible area is of the tab in front: the shop, not this popup page.
  const popup = await openPopup(h)
  const tabId = await shopTabId(h, popup)
  await h.shop.bringToFront()
  const answer = await send(popup, { type: "bugberry:screenshot", tabId, mode: "visible" })
  expect(answer).toMatchObject({ ok: true })
  await popup.close()
  const review = await reviewFrame(h)
  await review.getByRole("radio", { name: "Box" }).click()
  const canvas = await review.locator("canvas").first().boundingBox()
  if (!canvas) throw new Error("No annotation canvas")
  const at = (x: number, y: number) => ({ x: canvas.x + (x / viewport.width) * canvas.width, y: canvas.y + (y / viewport.height) * canvas.height })
  const from = at(pay.x - 14, pay.y - 14)
  const to = at(pay.x + pay.width + 14, pay.y + pay.height + 14)
  await h.shop.mouse.move(from.x, from.y)
  await h.shop.mouse.down()
  await h.shop.mouse.move(to.x, to.y, { steps: 8 })
  await h.shop.mouse.up()
  await h.shop.mouse.move(viewport.width - 4, viewport.height - 4)
  await shot(h.shop, "screenshots/review-markup.png")
  // Closed as a draft, so the next pictures start clean.
  await review.getByRole("button", { name: "Close" }).click()
  await review.getByRole("button", { name: "Keep" }).click()
})
