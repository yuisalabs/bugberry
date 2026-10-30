import { describe, expect, test } from "bun:test"
import { deviceInfoFrom } from "../../lib/capture/device"

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
const EDGE_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0"
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"

describe("deviceInfoFrom", () => {
  test.each([
    [CHROME_WINDOWS, "Chrome 141", "Windows"],
    [EDGE_MAC, "Edge 141", "macOS"],
    [CHROME_ANDROID, "Chrome 141", "Android 15"],
    ["curl/8.0", "Unknown browser", "Unknown OS"],
  ])("%s", (userAgent, browser, os) => {
    expect(deviceInfoFrom(userAgent, { width: 1440, height: 900 })).toEqual({ browser, os, viewport: "1440x900" })
  })

  test("reports an unknown viewport when the size is missing", () => {
    expect(deviceInfoFrom(CHROME_WINDOWS, {}).viewport).toBe("unknown")
  })
})
