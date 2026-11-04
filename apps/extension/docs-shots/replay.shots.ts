import { test } from "@playwright/test"
import { type Harness, launch, openToolbarPopup, reviewFrame, shot } from "./harness"

// One armed tab, photographed as it goes: the second picture captures what the first armed.
test.describe.configure({ mode: "serial" })

let h: Harness

test.beforeAll(async () => {
  h = await launch()
})

test.afterAll(async () => {
  await h.context.close()
})

test("popup: replay armed", async () => {
  // Arming is taken only from the real toolbar popup, not from popup.html in a tab.
  const popup = await openToolbarPopup(h)
  await popup.getByRole("button", { name: "Arm replay" }).click()
  await popup.getByRole("button", { name: "Capture last ~60s" }).waitFor()
  // Only the Replay part: the real popup can't be resized to fit a whole picture.
  await shot(popup.locator("section", { has: popup.getByRole("button", { name: "Disarm" }) }), "recordings/replay-popup.png")
  await popup.close()
})

test("review: replay", async () => {
  const pay = h.shop.getByRole("button", { name: "Pay $48.00" })
  await pay.click()
  await h.shop.waitForTimeout(1500)
  await pay.click()
  // Two of the screenshots taken every 5 seconds, for the strip under the player.
  await h.shop.waitForTimeout(10_500)
  const popup = await openToolbarPopup(h)
  await popup.getByRole("button", { name: "Capture last ~60s" }).click()
  const review = await reviewFrame(h)
  await review.locator(".rr-player").waitFor({ timeout: 15_000 })
  await review.getByLabel("Title").fill("Pay does nothing after the second click")
  await h.shop.mouse.move(8, 8)
  await h.shop.waitForTimeout(800)
  await shot(h.shop, "recordings/replay-review.png")
})
