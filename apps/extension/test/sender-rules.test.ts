import { describe, expect, test } from "bun:test"
import { fromAutomationPage, fromExtensionPage, fromPopup, fromRecordedTab, ofThisRecording } from "../lib/sender-rules"

const ID = "okfoeiknimknnemlonocaimclfnahiop"
const ORIGIN = `chrome-extension://${ID}/`

describe("who may drive a recording", () => {
  test("only the toolbar popup", () => {
    const popup = { id: ID, url: `${ORIGIN}popup.html` }
    expect(fromPopup(popup, ID, ORIGIN)).toBe(true)
    // The popup has no tab; an extension page inside a tab is something else (or embedded by a site).
    expect(fromPopup({ ...popup, tab: { id: 3 } }, ID, ORIGIN)).toBe(false)
    expect(fromPopup({ id: ID, url: `${ORIGIN}recorder-bar.html` }, ID, ORIGIN)).toBe(false)
    expect(fromPopup({ id: ID, url: `${ORIGIN}popup.html2` }, ID, ORIGIN)).toBe(false)
    expect(fromPopup({ id: ID, url: `${ORIGIN}popup.html?x=1` }, ID, ORIGIN)).toBe(true)
    expect(fromPopup({ id: "otherextensionid", url: "chrome-extension://otherextensionid/popup.html" }, ID, ORIGIN)).toBe(false)
  })

  test("only the extension's own pages, not its content scripts or other extensions", () => {
    expect(fromExtensionPage({ id: ID, url: `chrome-extension://${ID}/recorder-bar.html?session=d1` }, ID, ORIGIN)).toBe(true)
    expect(fromExtensionPage({ id: ID, url: "https://shop.test/checkout" }, ID, ORIGIN)).toBe(false)
    expect(fromExtensionPage({ id: "otherextensionid", url: "chrome-extension://otherextensionid/x.html" }, ID, ORIGIN)).toBe(false)
    expect(fromExtensionPage({ id: ID }, ID, ORIGIN)).toBe(false)
  })

  test("a Firefox page counts by its moz-extension origin", () => {
    const FX_ID = "yuisalabs@gmail.com"
    const page = { id: FX_ID, url: "moz-extension://3f2a9c1e-0000-4000-8000-000000000001/recorder-bar.html" }
    expect(fromExtensionPage(page, FX_ID, "moz-extension://3f2a9c1e-0000-4000-8000-000000000001/")).toBe(true)
    expect(fromExtensionPage(page, FX_ID, "moz-extension://99999999-0000-4000-8000-000000000002/")).toBe(false)
  })

  test("the bar and the drawing layer only count inside the recorded tab", () => {
    const bar = { id: ID, url: `chrome-extension://${ID}/recorder-bar.html`, tab: { id: 7 } }
    expect(fromRecordedTab(bar, ID, ORIGIN, 7)).toBe(true)
    // The same page embedded by another site, in another tab, can't press Stop or turn on the microphone.
    expect(fromRecordedTab({ ...bar, tab: { id: 9 } }, ID, ORIGIN, 7)).toBe(false)
    expect(fromRecordedTab(bar, ID, ORIGIN, null)).toBe(false)
    expect(fromRecordedTab({ ...bar, url: "https://evil.test/" }, ID, ORIGIN, 7)).toBe(false)
  })
})

test("a bar request must name the running recording: a page in the recorded tab can't embed its own bar", () => {
  const bar = { id: ID, url: `chrome-extension://${ID}/recorder-bar.html?session=d1`, tab: { id: 7 } }
  expect(ofThisRecording(bar, ID, ORIGIN, { tabId: 7, draftId: "d1" }, "d1")).toBe(true)
  expect(ofThisRecording(bar, ID, ORIGIN, { tabId: 7, draftId: "d1" }, "guess")).toBe(false)
  expect(ofThisRecording(bar, ID, ORIGIN, null, "d1")).toBe(false)
})

describe("the agent recorder's automation path", () => {
  const page = { id: ID, url: `${ORIGIN}automation.html`, tab: { id: 4 } }

  test("only its automation page, and only in the recorder build", () => {
    expect(fromAutomationPage(page, ID, ORIGIN, true)).toBe(true)
    expect(fromAutomationPage(page, ID, ORIGIN, false)).toBe(false)
  })

  test("never a content script, another extension page, or a look-alike address", () => {
    expect(fromAutomationPage({ ...page, url: "https://shop.test/automation.html" }, ID, ORIGIN, true)).toBe(false)
    // Web-accessible pages can be framed by any site: they must not reach it either.
    expect(fromAutomationPage({ ...page, url: `${ORIGIN}recorder-bar.html` }, ID, ORIGIN, true)).toBe(false)
    expect(fromAutomationPage({ ...page, url: `${ORIGIN}automation.html2` }, ID, ORIGIN, true)).toBe(false)
    expect(fromAutomationPage({ ...page, id: "otherextensionid" }, ID, ORIGIN, true)).toBe(false)
  })
})
