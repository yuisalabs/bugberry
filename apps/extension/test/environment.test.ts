import { describe, expect, test } from "bun:test"
import { environmentFrom } from "../lib/environment"

const mac = {
  language: "id-ID",
  timeZone: "Asia/Jakarta",
  pixelRatio: 2,
  connection: { effectiveType: "4g", downlink: 10, rtt: 38 },
  uaData: {
    platform: "macOS",
    platformVersion: "15.2.0",
    fullVersionList: [
      { brand: "Not A(Brand", version: "8.0.0.0" },
      { brand: "Chromium", version: "131.0.6778.86" },
      { brand: "Google Chrome", version: "131.0.6778.86" },
    ],
  },
}

describe("environmentFrom", () => {
  test("builds the full browser and OS versions, language, time zone, screen and connection", () => {
    expect(environmentFrom(mac)).toEqual({
      language: "id-ID",
      timeZone: "Asia/Jakarta",
      pixelRatio: 2,
      connection: { effectiveType: "4g", downlinkMbps: 10, rttMs: 38 },
      browserVersion: "Chrome 131.0.6778.86",
      osVersion: "macOS 15.2",
    })
  })

  test("Windows 13 and up is Windows 11, below is Windows 10; Edge is named as Edge", () => {
    const windows = (platformVersion: string) =>
      environmentFrom({
        uaData: {
          platform: "Windows",
          platformVersion,
          fullVersionList: [
            { brand: "Chromium", version: "131.0.0.1" },
            { brand: "Microsoft Edge", version: "131.0.2903.70" },
          ],
        },
      })
    expect(windows("15.0.0")).toEqual({ browserVersion: "Edge 131.0.2903.70", osVersion: "Windows 11" })
    expect(windows("10.0.0")?.osVersion).toBe("Windows 10")
  })

  test("other systems read as platform and version; Chromium alone is Chromium", () => {
    const linux = environmentFrom({
      uaData: { platform: "Linux", platformVersion: "6.8.0", fullVersionList: [{ brand: "Chromium", version: "130.0.1" }] },
    })
    expect(linux).toEqual({ browserVersion: "Chromium 130.0.1", osVersion: "Linux 6.8.0" })
  })

  test("junk from the page is dropped", () => {
    expect(
      environmentFrom({
        language: 5,
        timeZone: "x".repeat(500),
        pixelRatio: 900,
        connection: { effectiveType: "4g", downlink: -3, rtt: "fast" },
        uaData: "nope",
      }),
    ).toEqual({ timeZone: "x".repeat(100), connection: { effectiveType: "4g" } })
    expect(environmentFrom(null)).toBeUndefined()
    expect(environmentFrom({})).toBeUndefined()
  })
})
