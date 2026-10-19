import { describe, expect, test } from "bun:test"
import { fromExtensionPage, fromRecordedTab, ofThisRecording } from "../lib/sender-rules"

const ID = "okfoeiknimknnemlonocaimclfnahiop"

describe("who may drive a recording", () => {
  test("only the extension's own pages, not its content scripts or other extensions", () => {
    expect(fromExtensionPage({ id: ID, url: `chrome-extension://${ID}/recorder-bar.html?session=d1` }, ID)).toBe(true)
    expect(fromExtensionPage({ id: ID, url: "https://shop.test/checkout" }, ID)).toBe(false)
    expect(fromExtensionPage({ id: "otherextensionid", url: "chrome-extension://otherextensionid/x.html" }, ID)).toBe(false)
    expect(fromExtensionPage({ id: ID }, ID)).toBe(false)
  })

  test("the bar and the drawing layer only count inside the recorded tab", () => {
    const bar = { id: ID, url: `chrome-extension://${ID}/recorder-bar.html`, tab: { id: 7 } }
    expect(fromRecordedTab(bar, ID, 7)).toBe(true)
    // The same page embedded by another site, in another tab, can't press Stop or turn on the microphone.
    expect(fromRecordedTab({ ...bar, tab: { id: 9 } }, ID, 7)).toBe(false)
    expect(fromRecordedTab(bar, ID, null)).toBe(false)
    expect(fromRecordedTab({ ...bar, url: "https://evil.test/" }, ID, 7)).toBe(false)
  })
})

test("a bar request must name the running recording: a page in the recorded tab can't embed its own bar", () => {
  const bar = { id: ID, url: `chrome-extension://${ID}/recorder-bar.html?session=d1`, tab: { id: 7 } }
  expect(ofThisRecording(bar, ID, { tabId: 7, draftId: "d1" }, "d1")).toBe(true)
  expect(ofThisRecording(bar, ID, { tabId: 7, draftId: "d1" }, "guess")).toBe(false)
  expect(ofThisRecording(bar, ID, null, "d1")).toBe(false)
})
