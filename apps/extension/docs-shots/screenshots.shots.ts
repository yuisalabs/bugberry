import { test } from "@playwright/test"
import { type Harness, launch, openPopup, shot } from "./harness"

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
