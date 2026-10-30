import { describe, expect, test } from "bun:test"
import { storeBuildLeaks } from "../../lib/platform/store-build-check"

describe("storeBuildLeaks", () => {
  test("a clean store build has none", () => {
    expect(storeBuildLeaks([{ path: "chrome-mv3/background.js", text: 'chrome.runtime.onMessage.addListener(() => "bugberry:record-start")' }])).toEqual([])
  })

  test("the automation page is a leak", () => {
    expect(storeBuildLeaks([{ path: "chrome-mv3/automation.html", text: "<html></html>" }])).toEqual(["chrome-mv3/automation.html"])
  })

  test("the automation stop handler in a script is a leak", () => {
    const files = [{ path: "firefox-mv3/background.js", text: 'if (m.type === "bugberry:automation-stop") stop()' }]
    expect(storeBuildLeaks(files)).toEqual(["firefox-mv3/background.js"])
  })
})
