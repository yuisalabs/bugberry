import { type Frame, test } from "@playwright/test"
import { type Harness, launch, openPopup, openToolbarPopup, shot, startRecording } from "./harness"

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
