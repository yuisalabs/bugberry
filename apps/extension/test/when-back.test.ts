import { expect, test } from "bun:test"
import { whenBack } from "../lib/when-back"

function fakes() {
  const win = new EventTarget()
  const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" as DocumentVisibilityState })
  return { win, doc }
}

test("back to the review: its window gets focus, or its tab shows again", () => {
  const { win, doc } = fakes()
  let calls = 0
  whenBack(win, doc, () => calls++)
  win.dispatchEvent(new Event("focus"))
  expect(calls).toBe(1)
  doc.visibilityState = "visible"
  doc.dispatchEvent(new Event("visibilitychange"))
  expect(calls).toBe(2)
})

test("a tab going into the background isn't coming back", () => {
  const { win, doc } = fakes()
  let calls = 0
  whenBack(win, doc, () => calls++)
  doc.dispatchEvent(new Event("visibilitychange"))
  expect(calls).toBe(0)
})

test("stopping removes both listeners", () => {
  const { win, doc } = fakes()
  let calls = 0
  const stop = whenBack(win, doc, () => calls++)
  stop()
  win.dispatchEvent(new Event("focus"))
  doc.visibilityState = "visible"
  doc.dispatchEvent(new Event("visibilitychange"))
  expect(calls).toBe(0)
})
