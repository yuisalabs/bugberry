import { describe, expect, test } from "bun:test"
import { createServer } from "node:net"
import { launchBrowser, PortUnavailableError } from "../src/browser"
import type { RecorderOptions } from "../src/options"

const options = (port: number): RecorderOptions => ({ server: "https://bugs.kantor.test", port, headless: true, profileDir: "/tmp/profile" })

/** A launcher that must never be reached: these tests stop before Chromium starts. */
const noLaunch = {
  executablePath: () => "/chromium",
  launchPersistentContext: async () => {
    throw new Error("launched")
  },
}

describe("launchBrowser", () => {
  test("port in use names the port and both configs", async () => {
    const taken = createServer()
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve))
    const port = (taken.address() as { port: number }).port
    try {
      const failure = await launchBrowser(options(port), "/ext", { chromium: noLaunch, exists: () => true }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(PortUnavailableError)
      const message = (failure as Error).message
      for (const part of [String(port), "reserved by Windows", "--port", "bugberry-browser", "--cdp-endpoint"]) expect(message).toContain(part)
    } finally {
      taken.close()
    }
  })

  test("missing Chromium gives the install command", async () => {
    const failure = await launchBrowser(options(0), "/ext", { chromium: noLaunch, exists: (path) => path !== "/chromium" }).catch(
      (error: unknown) => error,
    )
    expect((failure as Error).message).toContain("npx playwright@1.64.1 install chromium")
  })

  test("a missing extension build is named", async () => {
    const failure = await launchBrowser(options(0), "/ext", { chromium: noLaunch, exists: (path) => path === "/chromium" }).catch(
      (error: unknown) => error,
    )
    expect((failure as Error).message).toContain("/ext")
  })
})
