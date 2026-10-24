import { expect, type Frame, test } from "@playwright/test"
import { type Harness, launch, openPopup, openToolbarPopup, shot, startRecording, stopRecording } from "./harness"

// One recording, photographed as it goes: each test picks up where the last one left off.
test.describe.configure({ mode: "serial" })

let h: Harness
let bar: Frame

test.beforeAll(async () => {
  h = await launch()
})

test.afterAll(async () => {
  await h.context.close()
})

test("popup: record", async () => {
  const popup = await openPopup(h, { captureKind: "record", recordSource: "tab", mic: false, countdown: true })
  await shot(popup, "recordings/popup.png")
  await popup.close()
})

test("recording bar", async () => {
  bar = await startRecording(h)
  const pay = h.shop.getByRole("button", { name: "Pay $48.00" })
  await pay.click()
  await pay.click()
  await h.shop.waitForTimeout(3000)
  const frame = await (await bar.frameElement()).boundingBox()
  if (!frame) throw new Error("No Recording Bar")
  const width = 800
  const height = 160
  const x = Math.max(0, frame.x + frame.width / 2 - width / 2)
  const y = Math.max(0, frame.y + frame.height / 2 - height / 2)
  await shot(h.shop, "recordings/recording-bar.png", { clip: { x, y, width, height } })
})

test("draw", async () => {
  await bar.getByRole("button", { name: "Draw" }).click()
  const pay = await h.shop.getByRole("button", { name: "Pay $48.00" }).boundingBox()
  if (!pay) throw new Error("No Pay button")
  // A note first: it stays. Then the arrow, which fades after 3 seconds, right before the picture.
  await bar.getByLabel("Note").click()
  await h.shop.mouse.click(pay.x - 260, pay.y + pay.height + 60)
  const draw = h.shop.frames().find((frame) => frame.url().includes("/draw.html"))
  if (!draw) throw new Error("No drawing layer")
  const note = draw.getByRole("textbox", { name: "Note" })
  await note.fill("Pay does nothing, no error shown")
  await note.press("Enter")
  await draw.getByText("Pay does nothing, no error shown").waitFor()
  await bar.getByLabel("Arrow").click()
  await h.shop.mouse.move(pay.x - 140, pay.y + pay.height + 50)
  await h.shop.mouse.down()
  await h.shop.mouse.move(pay.x + 20, pay.y + pay.height / 2 + 6, { steps: 10 })
  await h.shop.mouse.up()
  await h.shop.mouse.move(8, 8)
  await shot(h.shop, "recordings/draw.png")
  await bar.getByRole("button", { name: "Draw" }).click()
})

test("popup while recording", async () => {
  // The popup only shows a recording's controls to the real toolbar popup, not to popup.html in a tab.
  const popup = await openToolbarPopup(h)
  await popup.getByText("REC", { exact: true }).waitFor()
  await popup.waitForTimeout(1000)
  await shot(popup, "recordings/popup-recording.png")
  await popup.close()
})

let reportId = ""

test("review", async () => {
  const review = await stopRecording(h, bar)
  await review.getByLabel("Title").fill("Pay button fails at checkout")
  await review.getByRole("textbox", { name: "What went wrong?" }).fill("Clicking Pay does nothing. Expected the order confirmation.")
  await review.getByRole("button", { name: /Priority$/ }).click()
  await review.getByRole("option", { name: "High" }).click()
  await h.shop.mouse.move(8, 8)
  await h.shop.waitForTimeout(500)
  await shot(h.shop, "review-and-send/review.png")
  await review.getByRole("button", { name: "Create report" }).click()
  await expect(review.getByText("Report created")).toBeVisible({ timeout: 30_000 })
  await h.shop.waitForTimeout(800)
  await shot(h.shop, "review-and-send/sent.png")
  reportId = (await review.getByRole("link", { name: "Open report" }).getAttribute("href"))?.split("/").at(-1) ?? ""
  expect(reportId).not.toBe("")
})

test("dashboard report", async () => {
  const page = await h.context.newPage()
  // Wider than the window, so the video and the DevTools-like panel sit side by side; at the window's 2×.
  const cdp = await h.context.newCDPSession(page)
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false })
  await page.goto(`${h.state.serverUrl}/app/r/${reportId}`)
  await page.getByText("Payment failed: card_declined").first().waitFor({ timeout: 30_000 })
  // The video's first frame, not a blank player.
  await expect.poll(() => page.locator("video").first().evaluate((video: HTMLVideoElement) => video.readyState), { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
  await page.getByRole("tab", { name: /^Console/ }).click()
  await page.waitForTimeout(1000)
  await shot(page, "dashboard/report.png")
  await page.close()
})

test("camera bubble", async () => {
  // The review of the last recording is still over the shop: Done takes it away (and its own frame with it).
  const review = h.shop.frames().find((frame) => frame.url().includes("/review.html"))
  await review?.getByRole("button", { name: "Done" }).click({ timeout: 10_000, noWaitAfter: true }).catch(() => {})
  await expect.poll(() => h.shop.frames().some((frame) => frame.url().includes("/review.html")), { timeout: 15_000 }).toBe(false)
  // A recording of its own, so the other pictures show no bubble.
  const recording = await startRecording(h, { deviceId: null, shape: "circle" })
  const find = () => h.shop.frames().find((frame) => frame.url().includes("/camera-bubble.html"))
  await expect.poll(() => find() !== undefined, { timeout: 15_000 }).toBe(true)
  const bubble = find()!
  await expect
    .poll(() => bubble.locator("video").evaluate((video: HTMLVideoElement) => video.readyState), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2)
  // The handle shows while the pointer is over the bubble.
  const box = await (await bubble.frameElement()).boundingBox()
  if (!box) throw new Error("No camera bubble")
  await h.shop.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await h.shop.waitForTimeout(500)
  const height = 360
  await shot(h.shop, "recordings/camera.png", { clip: { x: 0, y: Math.max(0, box.y + box.height + 24 - height), width: 640, height } })
  await h.shop.mouse.move(8, 8)
  await recording.getByRole("button", { name: "Discard" }).click()
  await recording.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
  await expect.poll(() => find() !== undefined, { timeout: 15_000 }).toBe(false)
})
