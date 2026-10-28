import { describe, expect, test } from "bun:test"
import { BUGBERRY_CLOUD_ORIGIN } from "@bugberry/shared"
import { DEFAULT_PORT, parseOptions } from "../src/options"

const windows = { platform: "win32" as const, home: "C:\\Users\\ana", localAppData: "C:\\Users\\ana\\AppData\\Local" }

describe("parseOptions", () => {
  test("defaults: cloud server, DEFAULT_PORT, headed", () => {
    expect(parseOptions([], windows)).toMatchObject({ server: BUGBERRY_CLOUD_ORIGIN, port: DEFAULT_PORT, headless: false })
  })

  test("the default port is outside the ranges Windows reserved on the owner's machine", () => {
    for (const [start, end] of [[9008, 9107], [9250, 9449]] as const) {
      expect(DEFAULT_PORT < start || DEFAULT_PORT > end).toBe(true)
    }
  })

  test("--server keeps only the origin", () => {
    expect(parseOptions(["--server", "https://bugs.kantor.test/app/r/1?x=1"], windows).server).toBe("https://bugs.kantor.test")
    expect(parseOptions(["--server=http://localhost:3999/"], windows).server).toBe("http://localhost:3999")
  })

  test("--server must be http(s)", () => {
    expect(() => parseOptions(["--server", "ftp://bugs.kantor.test"], windows)).toThrow("--server")
    expect(() => parseOptions(["--server", "not a url"], windows)).toThrow("--server")
  })

  test("--port outside 1024–65535 is rejected", () => {
    expect(parseOptions(["--port", "9600"], windows).port).toBe(9600)
    for (const port of ["80", "70000", "abc", "9600.5"]) {
      expect(() => parseOptions(["--port", port], windows)).toThrow("--port")
    }
  })

  test("--headless", () => {
    expect(parseOptions(["--headless"], windows).headless).toBe(true)
  })

  test("--profile moves the browser profile, for tests that must not touch the real one", () => {
    expect(parseOptions(["--profile", "C:\\tmp\\p"], windows).profileDir).toBe("C:\\tmp\\p")
  })

  test("profile folder per platform", () => {
    expect(parseOptions([], windows).profileDir).toBe("C:\\Users\\ana\\AppData\\Local\\BugBerry\\recorder\\profile")
    expect(parseOptions([], { platform: "darwin", home: "/Users/ana" }).profileDir).toBe(
      "/Users/ana/Library/Application Support/BugBerry/recorder/profile",
    )
    expect(parseOptions([], { platform: "linux", home: "/home/ana" }).profileDir).toBe("/home/ana/.local/share/bugberry/recorder/profile")
    expect(parseOptions([], { platform: "linux", home: "/home/ana", xdgDataHome: "/data" }).profileDir).toBe("/data/bugberry/recorder/profile")
  })
})
